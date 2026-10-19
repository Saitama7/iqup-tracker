import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { localSupabase } from '../../../scripts/local-supabase'
import { phoneToEmail } from '../../../supabase/functions/_shared/phone'
import type { Database } from '../../../src/lib/supabase/types.gen'

// #73 fixtures: own groups, pupils, payments and marks, so the specs never touch the seed's rows.

export const service = () => {
  const env = localSupabase()
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export const teacherId = async (like: string): Promise<string> => {
  const { data, error } = await service()
    .from('teachers')
    .select('id')
    .like('full_name', like)
    .single()
  if (error) throw error
  return data.id
}

type GroupType = Database['public']['Enums']['group_type']

/** ВТ/ЧТ 19:00 from `start`, lessons generated up to the end of October. */
export async function makeGroup(
  name: string,
  teacher: string,
  start = '2026-09-01',
  type: GroupType = 'mini',
) {
  const db = service()
  const { data: subject } = await db.from('subjects').select('id').eq('name', 'Математика').single()
  const { data, error } = await db.rpc('create_group', {
    p_name: name,
    p_subject_id: subject?.id ?? '',
    p_grade: 11,
    p_group_type: type,
    p_teacher_id: teacher,
    p_weekdays: [2, 4],
    p_start_time: '19:00',
    p_start_date: start,
    p_room: '2',
    p_until: '2026-10-31',
  })
  if (error) throw error
  return data[0]?.group_id ?? ''
}

/** A pupil with an enrollment, a subscription and, optionally, a payment of `paid` som. */
export async function makeEnrollment(
  fullName: string,
  groupId: string,
  start: string,
  paid = 0,
  type: GroupType = 'mini',
) {
  const db = service()
  const { data: student, error: se } = await db
    .from('students')
    .insert({ full_name: fullName, grade: 11 })
    .select('id')
    .single()
  if (se) throw se
  const { data: tariff } = await db
    .from('tariffs')
    .select('id, lessons_in_package, package_price')
    .eq('group_type', type)
    .lte('valid_from', start)
    .order('valid_from', { ascending: false })
    .limit(1)
    .single()
  const { data: enrollment, error: ee } = await db
    .from('enrollments')
    .insert({ student_id: student.id, group_id: groupId, start_date: start })
    .select('id')
    .single()
  if (ee) throw ee
  const { data: sub, error } = await db
    .from('subscriptions')
    .insert({
      enrollment_id: enrollment.id,
      tariff_id: tariff?.id ?? '',
      lessons_total: tariff?.lessons_in_package ?? 12,
      price_full: tariff?.package_price ?? 0,
      price_final: tariff?.package_price ?? 0,
      started_at: start,
    })
    .select('id')
    .single()
  if (error) throw error
  if (paid > 0) {
    const { error: pe } = await db.from('payments').insert({
      subscription_id: sub.id,
      amount: paid,
      method: 'cash',
      paid_at: `${start}T10:00:00Z`,
    })
    if (pe) throw pe
  }
  return { studentId: student.id, enrollmentId: enrollment.id, subscriptionId: sub.id }
}

/** Holds the group's first `count` lessons with one mark each for the pupil. */
export async function holdLessons(
  groupId: string,
  studentId: string,
  count: number,
  status: Database['public']['Enums']['attendance_status'],
) {
  const db = service()
  const { data: lessons } = await db
    .from('lessons')
    .select('id')
    .eq('group_id', groupId)
    .order('lesson_date')
    .limit(count)
  for (const l of lessons ?? []) {
    const { error } = await db.rpc('confirm_lesson', {
      p_lesson_id: l.id,
      p_marks: [{ student_id: studentId, status }],
    })
    if (error) throw error
  }
}

// Payments are immutable (И41): removed as superuser with triggers off.
function deletePayments(subIds: string[]) {
  execFileSync(
    'psql',
    [
      localSupabase().dbUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'set session_replication_role = replica',
      '-c',
      `delete from public.payments where subscription_id in (${subIds.map((id) => `'${id}'::uuid`).join(', ')})`,
    ],
    { stdio: 'ignore' },
  )
}

export async function cleanup(groupNames: string[], studentNames: string[]) {
  const db = service()
  const { data: students } = await db.from('students').select('id').in('full_name', studentNames)
  const { data: groups } = await db.from('groups').select('id').in('name', groupNames)
  const studentIds = (students ?? []).map((s) => s.id)
  const groupIds = (groups ?? []).map((g) => g.id)
  const byStudent =
    studentIds.length > 0
      ? await db.from('enrollments').select('id').in('student_id', studentIds)
      : null
  const byGroup =
    groupIds.length > 0 ? await db.from('enrollments').select('id').in('group_id', groupIds) : null
  const enrollmentIds = [
    ...new Set([...(byStudent?.data ?? []), ...(byGroup?.data ?? [])].map((e) => e.id)),
  ]
  const { data: lessons } = await db.from('lessons').select('id').in('group_id', groupIds)
  const lessonIds = (lessons ?? []).map((l) => l.id)
  if (lessonIds.length > 0) await db.from('attendance').delete().in('lesson_id', lessonIds)
  if (enrollmentIds.length > 0) {
    const { data: subs } = await db
      .from('subscriptions')
      .select('id')
      .in('enrollment_id', enrollmentIds)
    const subIds = (subs ?? []).map((s) => s.id)
    if (subIds.length > 0) {
      deletePayments(subIds)
      await db.from('subscriptions').delete().in('id', subIds)
    }
    await db.from('enrollments').delete().in('id', enrollmentIds)
  }
  if (lessonIds.length > 0) await db.from('lessons').delete().in('id', lessonIds)
  await db.from('schedule_rules').delete().in('group_id', groupIds)
  await db.from('groups').delete().in('id', groupIds)
  await db.from('students').delete().in('id', studentIds)
}

/** A client signed in as the admin (Каныкей) — for RPCs that check `is_admin()`. */
export async function asAdmin() {
  const env = localSupabase()
  const db = createClient<Database>(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await db.auth.signInWithPassword({
    email: phoneToEmail('0552775771'),
    password: 'iqup-demo',
  })
  if (error) throw error
  return db
}
