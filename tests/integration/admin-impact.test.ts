// #94: the payroll previews of the admin actions equal the real before/after difference of
// v_payroll_preview.base_amount, per teacher and month: lesson_edit_payroll_impact (update_lesson),
// group_payroll_impact (delete_group), student_payroll_impact (delete_student).
// Every test works on its own fixture (teachers, group, students, lessons in Dec 2025 – Jan 2026), so
// the seed sums (38 160 / 47 546) never move; the fixture is removed afterwards.
// Needs the local stack: `supabase start && supabase db reset && pnpm seed:users`.
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/supabase/types.gen'
import { phoneToEmail } from '../../supabase/functions/_shared/phone'
import { localSupabase } from '../../scripts/local-supabase'

const env = localSupabase()
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient<Database>(env.apiUrl, env.serviceRoleKey, opts)
const admin = createClient<Database>(env.apiUrl, env.anonKey, opts)

function ok<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error instanceof Error ? error : new Error(JSON.stringify(error))
  if (data === null || data === undefined) throw new Error('no data')
  return data
}
function done({ error }: { error: unknown }): void {
  if (error) throw error instanceof Error ? error : new Error(JSON.stringify(error))
}

interface Fixture {
  teachers: [string, string]
  group: string
  students: [string, string]
  lessons: Record<string, string> // by date
}

const MONTHS = ['2025-12-01', '2026-01-01']
const created: Fixture[] = []

/** Group of teacher[0]: Mon/Wed lessons; held on 2025-12-01, 12-03, 12-08 and 2026-01-05. */
async function makeFixture(): Promise<Fixture> {
  const tag = randomUUID().slice(0, 8)
  const subject = ok(
    await service.from('subjects').select('id').eq('name', 'Математика').single(),
  ).id
  const teachers = [randomUUID(), randomUUID()] as [string, string]
  const students = [randomUUID(), randomUUID()] as [string, string]
  const group = randomUUID()
  const f: Fixture = { teachers, group, students, lessons: {} }
  created.push(f)

  for (const [i, id] of teachers.entries()) {
    done(
      await service.from('teachers').insert({
        id,
        full_name: `Импакт ${tag} ${i}`,
        phone: `996009${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
      }),
    )
    done(
      await service
        .from('teacher_rates')
        .insert({ teacher_id: id, percent: i === 0 ? 40 : 55, valid_from: '2025-01-01' }),
    )
  }
  done(
    await service.from('groups').insert({
      id: group,
      name: `импакт ${tag}`,
      subject_id: subject,
      grade: 8,
      group_type: 'group',
      teacher_id: teachers[0],
      start_date: '2025-12-01',
      status: 'active',
    }),
  )
  done(
    await service.from('schedule_rules').insert(
      [1, 3].map((weekday) => ({
        group_id: group,
        weekday,
        start_time: '15:00',
        valid_from: '2025-12-01',
      })),
    ),
  )
  done(
    await service.from('students').insert([
      { id: students[0], full_name: `Импакт ${tag} А` },
      { id: students[1], full_name: `Импакт ${tag} Б` },
    ]),
  )
  ok(await admin.rpc('generate_lessons', { p_group_id: group, p_until: '2026-01-31' }))
  for (const s of students) {
    ok(
      await admin.rpc('enroll_student', {
        p_student_id: s,
        p_group_id: group,
        p_start_date: '2025-12-01',
      }),
    )
  }
  const rows = ok(await admin.from('lessons').select('id, lesson_date').eq('group_id', group))
  for (const l of rows) f.lessons[l.lesson_date] = l.id
  for (const [date, a, b] of [
    ['2025-12-01', 'present', 'present'],
    ['2025-12-03', 'present', 'absent_burned'],
    ['2025-12-08', 'present', 'present'],
    ['2026-01-05', 'present', 'present'],
  ] as const) {
    const id = f.lessons[date]
    if (!id) throw new Error(`no lesson on ${date}`)
    done(
      await admin.rpc('confirm_lesson', {
        p_lesson_id: id,
        p_marks: [
          { student_id: students[0], status: a },
          { student_id: students[1], status: b },
        ],
      }),
    )
  }
  return f
}

type Totals = Map<string, number> // `${teacher}|${month}` → base_amount

async function totals(teachers: string[]): Promise<Totals> {
  const rows = ok(
    await admin
      .from('v_payroll_preview')
      .select('teacher_id, month, base_amount')
      .in('teacher_id', teachers),
  )
  return new Map(rows.map((r) => [`${r.teacher_id}|${r.month}`, r.base_amount ?? 0]))
}

function delta(before: Totals, after: Totals): Map<string, number> {
  const out = new Map<string, number>()
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const d = (after.get(key) ?? 0) - (before.get(key) ?? 0)
    if (d !== 0) out.set(key, d)
  }
  return out
}

function asMap(rows: { teacher_id: string; month: string; amount: number }[]) {
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.amount !== 0)
      out.set(`${r.teacher_id}|${r.month}`, (out.get(`${r.teacher_id}|${r.month}`) ?? 0) + r.amount)
  }
  return out
}

/** The delete previews report the amount lost (positive); the view delta is negative. */
function negate(m: Map<string, number>) {
  return new Map([...m].map(([k, v]) => [k, -v] as const))
}

const sorted = (m: Map<string, number>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b))

async function seedSums() {
  const rows = ok(await admin.from('v_payroll_preview').select('month, base_amount'))
  const sum = (m: string) =>
    rows.filter((r) => r.month === m).reduce((s, r) => s + (r.base_amount ?? 0), 0)
  return [sum('2025-09-01'), sum('2025-10-01')]
}

let seedBefore: number[] = []

beforeAll(async () => {
  const { error } = await admin.auth.signInWithPassword({
    email: phoneToEmail('0555 775 772'), // Алишка, admin
    password: 'iqup-demo',
  })
  if (error) throw error
  seedBefore = await seedSums()
})

afterAll(async () => {
  for (const f of created) {
    await admin.rpc('delete_group', { p_group_id: f.group, p_reason: 'cleanup of test fixture' })
    await service.from('students').delete().in('id', f.students)
    await service.from('teachers').delete().in('id', f.teachers)
  }
  expect(await seedSums()).toEqual(seedBefore)
})

describe('lesson_edit_payroll_impact ↔ update_lesson', () => {
  async function check(lessonId: string, newDate: string, newTeacher: string, teachers: string[]) {
    const cur = ok(
      await admin.from('lessons').select('planned_start, duration_min').eq('id', lessonId).single(),
    )
    const before = await totals(teachers)
    const preview = ok(
      await admin.rpc('lesson_edit_payroll_impact', {
        p_lesson_id: lessonId,
        p_date: newDate,
        p_teacher_id: newTeacher,
      }),
    )
    done(
      await admin.rpc('update_lesson', {
        p_lesson_id: lessonId,
        p_date: newDate,
        p_start: cur.planned_start,
        p_duration_min: cur.duration_min,
        p_teacher_id: newTeacher,
        p_substitute_teacher_id: null,
        p_reason: 'impact test',
      }),
    )
    const after = await totals(teachers)
    expect(sorted(asMap(preview))).toEqual(sorted(delta(before, after)))
    return preview
  }

  it('teacher change; month change; both; and back', async () => {
    const f = await makeFixture()
    const [t0, t1] = f.teachers
    const id = f.lessons['2025-12-03']

    const p1 = await check(id, '2025-12-03', t1, f.teachers) // other teacher, same month
    expect(p1.length).toBe(2)
    const p2 = await check(id, '2026-01-06', t1, f.teachers) // same teacher, other month
    expect(p2.length).toBe(2)
    const p3 = await check(id, '2025-12-09', t0, f.teachers) // other teacher and month
    expect(p3.length).toBe(2)
    const p4 = await check(id, '2025-12-03', t0, f.teachers) // same month and teacher
    expect(p4.length).toBe(1)
  })
})

describe('group_payroll_impact ↔ delete_group', () => {
  it('the previewed drop equals the v_payroll_preview delta', async () => {
    const f = await makeFixture()
    const before = await totals(f.teachers)
    const preview = ok(await admin.rpc('group_payroll_impact', { p_group_id: f.group }))
    expect(preview.length).toBeGreaterThan(0)
    expect(preview.every((r) => r.amount > 0)).toBe(true) // the amount LOST (positive)

    done(await admin.rpc('delete_group', { p_group_id: f.group, p_reason: 'impact test' }))
    const after = await totals(f.teachers)
    expect(sorted(asMap(preview))).toEqual(sorted(negate(delta(before, after))))
    for (const m of MONTHS) expect(after.get(`${f.teachers[0]}|${m}`) ?? 0).toBe(0)
  })
})

describe('student_payroll_impact ↔ delete_student', () => {
  it('the previewed drop equals the v_payroll_preview delta', async () => {
    const f = await makeFixture()
    const student = f.students[1]
    // «Ушёл» first (И57): the active enrollment with consumed marks blocks the delete
    const enrollment = ok(
      await admin
        .from('enrollments')
        .select('id')
        .eq('student_id', student)
        .eq('group_id', f.group)
        .single(),
    ).id
    done(
      await admin.rpc('withdraw_enrollment', {
        p_enrollment_id: enrollment,
        p_end_date: '2026-01-31',
      }),
    )

    const before = await totals(f.teachers)
    const preview = ok(await admin.rpc('student_payroll_impact', { p_student_id: student }))
    expect(preview.length).toBeGreaterThan(0)

    done(await admin.rpc('delete_student', { p_student_id: student, p_reason: 'impact test' }))
    const after = await totals(f.teachers)
    expect(sorted(asMap(preview))).toEqual(sorted(negate(delta(before, after))))
  })
})
