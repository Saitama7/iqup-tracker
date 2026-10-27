// Subscription price (#109, К11 / К12) for the TS ↔ SQL reconciliation tests, in May 2025 (before the
// seed's months — 38 160 / 51 146 do not move), a teacher of its own at 50 %:
//   P1 — individual group of 1,5-h lessons (Sat / Sun), bought 12 / 7 200 as on prod before К11
//        (own price) → 600 a lesson, 300 to the teacher; one lesson held;
//   P2 — a group, 20 / 7 400 own price (продлёнка «выставляется индивидуально»), paid 5 400, 12 held.
// The tests edit them with update_subscription and set them back first — reruns start the same.
// Idempotent: created once per database (supabase db reset clears it).
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/supabase/types.gen'
import { localSupabase } from '../../scripts/local-supabase'
import { admin, done, ok } from './afterschool-fixture'

const env = localSupabase()

export const PRICE_FIXTURE = {
  teacher: '00000000-0000-4000-a109-000000000001',
  individual: '00000000-0000-4000-b109-000000000001',
  group: '00000000-0000-4000-b109-000000000002',
  p1: '00000000-0000-4000-8109-000000000001',
  p2: '00000000-0000-4000-8109-000000000002',
} as const

type Admin = Awaited<ReturnType<typeof admin>>

/** The fixture student's only subscription. */
export async function priceFixtureSubscription(a: Admin, student: string) {
  return ok(
    await a
      .from('subscriptions')
      .select('id, lessons_total, price_full, enrollment:enrollments!inner(student_id)')
      .eq('enrollment.student_id', student)
      .single(),
  )
}

/** Puts the subscription back to `lessons` / `price` (update_subscription) when a run changed it. */
export async function resetPriceFixture(student: string, lessons: number, price: number) {
  const a = await admin()
  const sub = await priceFixtureSubscription(a, student)
  if (sub.lessons_total !== lessons || sub.price_full !== price) {
    done(
      await a.rpc('update_subscription', {
        p_id: sub.id,
        p_lessons: lessons,
        p_price: price,
        p_reason: 'интеграционный тест: исходное состояние',
      }),
    )
  }
  return sub.id
}

export async function ensurePriceFixture(): Promise<void> {
  const service = createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const exists = ok(await service.from('groups').select('id').eq('id', PRICE_FIXTURE.individual))
  if (exists.length > 0) return

  const subject = ok(
    await service.from('subjects').select('id').eq('name', 'Математика').single(),
  ).id
  done(
    await service
      .from('teachers')
      .insert({ id: PRICE_FIXTURE.teacher, full_name: 'Фикстура Цена', phone: '996000109001' }),
  )
  done(
    await service
      .from('teacher_rates')
      .insert({ teacher_id: PRICE_FIXTURE.teacher, percent: 50, valid_from: '2025-01-01' }),
  )
  done(
    await service.from('groups').insert([
      {
        id: PRICE_FIXTURE.individual,
        name: 'фикстура #109 · 1,5 ч',
        subject_id: subject,
        grade: 8,
        group_type: 'individual',
        teacher_id: PRICE_FIXTURE.teacher,
        start_date: '2025-05-03',
        status: 'active',
        lesson_duration_min: 90,
      },
      {
        id: PRICE_FIXTURE.group,
        name: 'фикстура #109',
        subject_id: subject,
        grade: 8,
        group_type: 'group',
        teacher_id: PRICE_FIXTURE.teacher,
        start_date: '2025-05-05',
        status: 'active',
      },
    ]),
  )
  done(
    await service.from('schedule_rules').insert([
      ...[6, 7].map((weekday) => ({
        group_id: PRICE_FIXTURE.individual,
        weekday,
        start_time: '10:00',
        valid_from: '2025-05-03',
        valid_to: '2025-05-31',
      })),
      ...[1, 2, 3, 4, 5].map((weekday) => ({
        group_id: PRICE_FIXTURE.group,
        weekday,
        start_time: '10:00',
        valid_from: '2025-05-05',
        valid_to: '2025-05-31',
      })),
    ]),
  )
  done(
    await service.from('students').insert([
      { id: PRICE_FIXTURE.p1, full_name: 'Фикстура Полтора' },
      { id: PRICE_FIXTURE.p2, full_name: 'Фикстура Двадцать' },
    ]),
  )

  const a = await admin()
  for (const [student, group, lessons, price, paid, held] of [
    [PRICE_FIXTURE.p1, PRICE_FIXTURE.individual, 12, 7200, 7200, 1],
    [PRICE_FIXTURE.p2, PRICE_FIXTURE.group, 20, 7400, 5400, 12],
  ] as const) {
    ok(await a.rpc('generate_lessons', { p_group_id: group, p_until: '2025-05-31' }))
    const row = ok(
      await a.rpc('enroll_student', {
        p_student_id: student,
        p_group_id: group,
        p_start_date: group === PRICE_FIXTURE.individual ? '2025-05-03' : '2025-05-05',
        p_lessons: lessons,
        p_price: price,
      }),
    ).at(0)
    if (!row) throw new Error('fixture: not enrolled')
    ok(
      await a.rpc('record_payment', {
        p_subscription_id: row.subscription_id,
        p_amount: paid,
        p_method: 'cash',
        p_paid_on: '2025-05-03',
      }),
    )
    const days = ok(
      await a
        .from('lessons')
        .select('id, lesson_date')
        .eq('group_id', group)
        .order('lesson_date')
        .limit(held),
    )
    for (const l of days) {
      done(
        await a.rpc('confirm_lesson', {
          p_lesson_id: l.id,
          p_marks: [{ student_id: student, status: 'present' }],
        }),
      )
    }
  }
}
