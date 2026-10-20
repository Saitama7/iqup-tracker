// Subscription size (#101, И89) for the TS ↔ SQL reconciliation tests: a pair group of its own teacher
// in June 2025 (before the seed's months — the seed sums 38 160 / 47 546 do not move), tariff
// 3 600 / 12 of 2025-02-01 → 300 a lesson; both students bought 8 lessons = 2 400.
//   Z1 — paid 2 400 → 8 of 8; 6 present → 2 left, refund 2 × 300 = 600;
//   Z2 — paid 1 200 → 4 of 8; 6 present → debt 2 lessons, 600 сом.
// Teacher (45 %): 12 student-lessons × 2 400 / 8 × 45 % = 1 620 for June 2025.
// Idempotent: created once per database (supabase db reset clears it).
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/supabase/types.gen'
import { localSupabase } from '../../scripts/local-supabase'
import { admin, done, ok } from './afterschool-fixture'

const env = localSupabase()

export const SIZE_FIXTURE = {
  teacher: '00000000-0000-4000-a101-000000000001',
  group: '00000000-0000-4000-b101-000000000001',
  z1: '00000000-0000-4000-8101-000000000001',
  z2: '00000000-0000-4000-8101-000000000002',
} as const

const DAYS = ['2025-06-02', '2025-06-03', '2025-06-04', '2025-06-05', '2025-06-06', '2025-06-09']

export async function ensureSizeFixture(): Promise<void> {
  const service = createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const exists = ok(await service.from('groups').select('id').eq('id', SIZE_FIXTURE.group))
  if (exists.length > 0) return

  const subject = ok(
    await service.from('subjects').select('id').eq('name', 'Математика').single(),
  ).id
  done(
    await service
      .from('teachers')
      .insert({ id: SIZE_FIXTURE.teacher, full_name: 'Фикстура Размер', phone: '996000101001' }),
  )
  done(
    await service
      .from('teacher_rates')
      .insert({ teacher_id: SIZE_FIXTURE.teacher, percent: 45, valid_from: '2025-01-01' }),
  )
  done(
    await service.from('groups').insert({
      id: SIZE_FIXTURE.group,
      name: 'фикстура #101',
      subject_id: subject,
      grade: 8,
      group_type: 'pair',
      teacher_id: SIZE_FIXTURE.teacher,
      start_date: '2025-06-02',
      status: 'active',
    }),
  )
  done(
    await service.from('schedule_rules').insert(
      [1, 2, 3, 4, 5].map((weekday) => ({
        group_id: SIZE_FIXTURE.group,
        weekday,
        start_time: '10:00',
        valid_from: '2025-06-02',
      })),
    ),
  )
  done(
    await service.from('students').insert([
      { id: SIZE_FIXTURE.z1, full_name: 'Фикстура Восемь' },
      { id: SIZE_FIXTURE.z2, full_name: 'Фикстура Полвосьмого' },
    ]),
  )

  const a = await admin()
  ok(await a.rpc('generate_lessons', { p_group_id: SIZE_FIXTURE.group, p_until: '2025-06-30' }))
  for (const [student, paid] of [
    [SIZE_FIXTURE.z1, 2400],
    [SIZE_FIXTURE.z2, 1200],
  ] as const) {
    const rows = ok(
      await a.rpc('enroll_student', {
        p_student_id: student,
        p_group_id: SIZE_FIXTURE.group,
        p_start_date: '2025-06-02',
        p_lessons: 8,
      }),
    )
    const row = rows.at(0)
    if (!row) throw new Error('fixture: not enrolled')
    ok(
      await a.rpc('record_payment', {
        p_subscription_id: row.subscription_id,
        p_amount: paid,
        p_method: 'cash',
        p_paid_on: '2025-06-02',
      }),
    )
  }

  const lessons = ok(
    await a
      .from('lessons')
      .select('id, lesson_date')
      .eq('group_id', SIZE_FIXTURE.group)
      .in('lesson_date', DAYS),
  )
  for (const l of lessons) {
    done(
      await a.rpc('confirm_lesson', {
        p_lesson_id: l.id,
        p_marks: [
          { student_id: SIZE_FIXTURE.z1, status: 'present' },
          { student_id: SIZE_FIXTURE.z2, status: 'present' },
        ],
      }),
    )
  }
}
