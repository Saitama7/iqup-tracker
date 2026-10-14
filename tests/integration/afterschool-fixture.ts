// After-school by hours (#82) for the TS ↔ SQL reconciliation tests: a group of its own teacher in
// October–November 2025 (before the seed's months — the seed sums 38 160 / 47 546 do not move).
//   F1 — October invoice paid in full, 1 present + 2 frozen → 6 h credit off November; November
//        invoiced, 2 days present;
//   F2 — October invoice unpaid, 2 days present, 1 frozen (a debt); November not invoiced, 2 days
//        present (the teacher is paid by the hour price on the date, the student owes them, И69).
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

async function admin() {
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

function ok<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error instanceof Error ? error : new Error(JSON.stringify(error))
  if (data === null || data === undefined) throw new Error('fixture: no data')
  return data
}

/** A call returning nothing (insert without select, void RPC). */
function done({ error }: { error: unknown }): void {
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
  for (const student of [FIXTURE.f1, FIXTURE.f2]) {
    ok(
      await a.rpc('enroll_student', {
        p_student_id: student,
        p_group_id: FIXTURE.group,
        p_start_date: '2025-10-01',
      }),
    )
  }
  const october = ok(
    await a
      .from('subscriptions')
      .select('id, price_final, enrollment:enrollments!inner(student_id)')
      .eq('enrollment.student_id', FIXTURE.f1)
      .eq('period_month', '2025-10-01')
      .single(),
  )
  ok(
    await a.rpc('record_payment', {
      p_subscription_id: october.id,
      p_amount: october.price_final,
      p_method: 'cash',
    }),
  )

  const lessons = ok(
    await a
      .from('lessons')
      .select('id, lesson_date')
      .eq('group_id', FIXTURE.group)
      .in('lesson_date', ['2025-10-01', '2025-10-02', '2025-10-03', '2025-11-03', '2025-11-04']),
  )
  const lesson = (d: string) => {
    const l = lessons.find((x) => x.lesson_date === d)
    if (!l) throw new Error(`no fixture lesson on ${d}`)
    return l.id
  }
  const confirm = async (d: string, f1: string, f2: string) => {
    done(
      await a.rpc('confirm_lesson', {
        p_lesson_id: lesson(d),
        p_marks: [
          { student_id: FIXTURE.f1, status: f1 },
          { student_id: FIXTURE.f2, status: f2 },
        ],
      }),
    )
  }
  await confirm('2025-10-01', 'present', 'present')
  await confirm('2025-10-02', 'absent_frozen', 'present')
  await confirm('2025-10-03', 'absent_frozen', 'absent_frozen')

  const f1Enrollment = ok(
    await a
      .from('enrollments')
      .select('id')
      .eq('student_id', FIXTURE.f1)
      .eq('group_id', FIXTURE.group)
      .single(),
  ).id
  ok(
    await a.rpc('issue_afterschool_invoice', {
      p_enrollment_id: f1Enrollment,
      p_month: '2025-11-01',
    }),
  )
  await confirm('2025-11-03', 'present', 'present')
  await confirm('2025-11-04', 'present', 'present')
}
