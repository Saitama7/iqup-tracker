// TS ↔ SQL reconciliation (issue #13): calcMonth() from src/features/payroll/calc.ts against
// v_payroll_preview (0011) on the seed, teacher by teacher and month by month.
// Needs the local stack: `supabase start && supabase db reset && pnpm seed:users`. Run with
// `pnpm test:integration`.
import { createClient } from '@supabase/supabase-js'
import { calcMonth, type PayLesson } from '../../src/features/payroll/calc'
import type { Database } from '../../src/lib/supabase/types.gen'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import { localSupabase } from '../../scripts/local-supabase'

const env = localSupabase()

async function signIn(phone: string) {
  const supabase = createClient<Database>(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await supabase.auth.signInWithPassword({
    email: phoneToEmail(phone),
    password: 'iqup-demo',
  })
  if (error) throw error
  return supabase
}

type Client = Awaited<ReturnType<typeof signIn>>

const GULZAT = '00000000-0000-4000-a000-000000000001'

async function viewRows(supabase: Client) {
  const { data, error } = await supabase
    .from('v_payroll_preview')
    .select('teacher_id, month, lessons_held, hours, student_lessons, base_amount')
  if (error) throw error
  return data
}

/** Every teacher's lessons with marks, grouped by teacher and month, plus rates and tariffs. */
async function source(supabase: Client) {
  const [lessons, rates, tariffs] = await Promise.all([
    supabase
      .from('lessons')
      .select(
        'id, group_id, lesson_date, duration_min, status, group:groups!inner(teacher_id, group_type), attendance(status)',
      ),
    supabase.from('teacher_rates').select('teacher_id, percent, valid_from'),
    supabase.from('tariffs').select('group_type, valid_from, lessons_in_package, package_price'),
  ])
  if (lessons.error) throw lessons.error
  if (rates.error) throw rates.error
  if (tariffs.error) throw tariffs.error

  const byKey = new Map<string, PayLesson[]>()
  for (const l of lessons.data) {
    const key = `${l.group.teacher_id}|${l.lesson_date.slice(0, 7)}-01`
    const list = byKey.get(key) ?? []
    list.push({ ...l, group_type: l.group.group_type })
    byKey.set(key, list)
  }
  return { byKey, rates: rates.data, tariffs: tariffs.data }
}

describe('v_payroll_preview ↔ calcMonth on the seed', () => {
  it('every teacher and month: the same lessons, hours, student-lessons and sum', async () => {
    const supabase = await signIn('0555 300 300') // Айгерим, accountant — sees everyone
    const rows = await viewRows(supabase)
    const { byKey, rates, tariffs } = await source(supabase)

    expect(rows.length).toBeGreaterThanOrEqual(5) // 5 teachers held lessons in September
    for (const row of rows) {
      const lessons = byKey.get(`${row.teacher_id}|${row.month}`) ?? []
      const teacherRates = rates.filter((r) => r.teacher_id === row.teacher_id)
      const ts = calcMonth(lessons, teacherRates, tariffs)
      expect({ teacher: row.teacher_id, month: row.month, ...pick(ts) }).toEqual({
        teacher: row.teacher_id,
        month: row.month,
        lessonsHeld: row.lessons_held,
        hours: row.hours,
        studentLessons: row.student_lessons,
        amount: row.base_amount,
      })
    }

    // Months the view has no row for have nothing held in TS either.
    const keys = new Set(rows.map((r) => `${r.teacher_id}|${r.month}`))
    for (const [key, lessons] of byKey) {
      if (keys.has(key)) continue
      const [teacher] = key.split('|')
      const teacherRates = rates.filter((r) => r.teacher_id === teacher)
      expect(calcMonth(lessons, teacherRates, tariffs).lessonsHeld).toBe(0)
    }
  })

  it('Гульзат, September 2026: 318 student-lessons × 266,67 × 45 % = 38 160', async () => {
    const supabase = await signIn('0555 123 456')
    const rows = await viewRows(supabase)
    expect(new Set(rows.map((r) => r.teacher_id))).toEqual(new Set([GULZAT]))
    const september = rows.find((r) => r.month === '2026-09-01')
    expect(september).toMatchObject({ lessons_held: 52, student_lessons: 318, base_amount: 38_160 })
  })
})

const pick = ({ lessonsHeld, hours, studentLessons, amount }: ReturnType<typeof calcMonth>) => ({
  lessonsHeld,
  hours,
  studentLessons,
  amount,
})
