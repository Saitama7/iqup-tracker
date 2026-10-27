// After-school — a package of days (К13, #111) for the TS ↔ SQL reconciliation tests: a group of its
// own teacher (45 %) in October–November 2025, before the seed's months (the seed sums do not move).
//   F1 — ВТ/СР/ЧТ 3 ч, 12 days for 5 400, paid in full: 10 days present in October (202,5 a day),
//        1 more on 4 November (the November accrual 202,5 → 203); 11 of 12 used, 1 left.
//   F2 — ПН/ПТ 3 ч, the default 20 · 7 000, not paid: 3 October, 6 and 10 October present, the
//        plan then changed from 6 October to ПТ only (the Monday mark is deleted, К13).
// Idempotent: created once per database (supabase db reset clears it).
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/supabase/types.gen'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import { localSupabase } from '../../scripts/local-supabase'

const env = localSupabase()

export const FIXTURE = {
  teacher: '00000000-0000-4000-a082-000000000001',
  group: '00000000-0000-4000-b082-000000000001',
  f1: '00000000-0000-4000-c082-000000000001',
  f2: '00000000-0000-4000-c082-000000000002',
} as const

const ADMIN_PHONE = '0555 775 772' // Алишка

export async function admin() {
  const supabase = createClient<Database>(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await supabase.auth.signInWithPassword({
    email: phoneToEmail(ADMIN_PHONE),
    password: 'iqup-demo',
  })
  if (error) throw error
  return supabase
}

export function ok<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error instanceof Error ? error : new Error(JSON.stringify(error))
  if (data === null || data === undefined) throw new Error('fixture: no data')
  return data
}

/** A call returning nothing (insert without select, void RPC). */
export function done({ error }: { error: unknown }): void {
  if (error) throw error instanceof Error ? error : new Error(JSON.stringify(error))
}

export async function ensureAfterschoolFixture(): Promise<void> {
  const service = createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const exists = ok(await service.from('groups').select('id').eq('id', FIXTURE.group))
  if (exists.length > 0) return

  const subject = ok(
    await service.from('subjects').select('id').eq('name', 'Продлёнка').single(),
  ).id
  done(
    await service
      .from('teachers')
      .insert({ id: FIXTURE.teacher, full_name: 'Фикстура Продлёнка', phone: '996000082001' }),
  )
  done(
    await service
      .from('teacher_rates')
      .insert({ teacher_id: FIXTURE.teacher, percent: 45, valid_from: '2025-01-01' }),
  )
  done(
    await service.from('groups').insert({
      id: FIXTURE.group,
      name: 'фикстура #82',
      subject_id: subject,
      grade: 2,
      group_type: 'afterschool',
      teacher_id: FIXTURE.teacher,
      start_date: '2025-10-01',
      status: 'active',
    }),
  )
  done(
    await service.from('schedule_rules').insert(
      [1, 2, 3, 4, 5].map((weekday) => ({
        group_id: FIXTURE.group,
        weekday,
        start_time: '13:00',
        valid_from: '2025-10-01',
      })),
    ),
  )
  done(
    await service.from('students').insert([
      { id: FIXTURE.f1, full_name: 'Фикстура Один' },
      { id: FIXTURE.f2, full_name: 'Фикстура Два' },
    ]),
  )

  const a = await admin()
  ok(await a.rpc('generate_lessons', { p_group_id: FIXTURE.group, p_until: '2025-11-30' }))
  const enrolled = async (student: string, plan: number[], terms: object) => {
    const row = ok(
      await a.rpc('enroll_student', {
        p_student_id: student,
        p_group_id: FIXTURE.group,
        p_start_date: '2025-10-01',
        p_plan: plan,
        ...terms,
      }),
    ).at(0)
    if (!row) throw new Error('fixture: no enrollment')
    return row
  }
  const f1 = await enrolled(FIXTURE.f1, [0, 3, 3, 3, 0, 0, 0], { p_lessons: 12, p_price: 5400 })
  const f2 = await enrolled(FIXTURE.f2, [3, 0, 0, 0, 3, 0, 0], {})
  ok(
    await a.rpc('record_payment', {
      p_subscription_id: f1.subscription_id,
      p_amount: 5400,
      p_method: 'cash',
    }),
  )

  const lessons = ok(
    await a.from('lessons').select('id, lesson_date').eq('group_id', FIXTURE.group),
  )
  const confirm = async (d: string, student: string) => {
    const l = lessons.find((x) => x.lesson_date === d)
    if (!l) throw new Error(`no fixture lesson on ${d}`)
    done(
      await a.rpc('confirm_lesson', {
        p_lesson_id: l.id,
        p_marks: [{ student_id: student, status: 'present' }],
      }),
    )
  }
  for (const d of ['01', '02', '07', '08', '09', '14', '15', '16', '21', '22'])
    await confirm(`2025-10-${d}`, FIXTURE.f1)
  for (const d of ['03', '06', '10']) await confirm(`2025-10-${d}`, FIXTURE.f2)
  await confirm('2025-11-04', FIXTURE.f1)
  done(
    await a.rpc('set_afterschool_plan', {
      p_enrollment_id: f2.enrollment_id,
      p_valid_from: '2025-10-06',
      p_hours: [0, 0, 0, 0, 3, 0, 0],
      p_reason: 'фикстура: только ПТ',
    }),
  )
}
