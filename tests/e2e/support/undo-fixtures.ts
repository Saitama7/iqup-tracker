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

const literal = (text: string) => `'${text.replaceAll("'", "''")}'`
const textArray = (items: string[]) => `array[${items.map(literal).join(', ')}]::text[]`

/**
 * Removes the fixtures' groups and pupils with everything hanging on them, in one transaction as
 * superuser, and throws if anything is left (#104). A1 / А3 run ensure_lessons for every running
 * group: with a second worker on the dashboard it used to refill a group's lessons between their
 * delete and the group's, the group delete failed on the FK unseen, and the group stayed for every
 * later spec (Гульзат's «Мои группы», «Сегодня», «Не подтверждено»). Now the schedule goes first and
 * the groups are locked — a concurrent ensure_lessons waits and then finds no group.
 * Payments are immutable (И41): only their delete runs with triggers off.
 */
export function wipeFixtures(groupNames: string[], studentNames: string[]) {
  const sql = `
begin;
create temp table w_groups on commit drop as
  select id from public.groups where name = any(${textArray(groupNames)});
create temp table w_students on commit drop as
  select id from public.students where full_name = any(${textArray(studentNames)});
delete from public.schedule_rules where group_id in (select id from w_groups);
select 1 from public.groups where id in (select id from w_groups) for update;
create temp table w_enrollments on commit drop as
  select id from public.enrollments
  where group_id in (select id from w_groups) or student_id in (select id from w_students);
create temp table w_subscriptions on commit drop as
  select id from public.subscriptions where enrollment_id in (select id from w_enrollments);
create temp table w_lessons on commit drop as
  select id from public.lessons where group_id in (select id from w_groups);
delete from public.trials
  where group_id in (select id from w_groups) or student_id in (select id from w_students)
     or enrollment_id in (select id from w_enrollments) or lesson_id in (select id from w_lessons);
delete from public.attendance
  where lesson_id in (select id from w_lessons) or student_id in (select id from w_students)
     or subscription_id in (select id from w_subscriptions);
set local session_replication_role = replica;
delete from public.payments where subscription_id in (select id from w_subscriptions);
set local session_replication_role = origin;
delete from public.subscriptions where id in (select id from w_subscriptions);
delete from public.enrollments where id in (select id from w_enrollments);
update public.lessons set makes_up_for_lesson_id = null
  where makes_up_for_lesson_id in (select id from w_lessons);
delete from public.lessons where group_id in (select id from w_groups);
delete from public.groups where id in (select id from w_groups);
update public.students set referred_by_student_id = null
  where referred_by_student_id in (select id from w_students);
delete from public.students where id in (select id from w_students);
commit;
`
  try {
    execFileSync('psql', [localSupabase().dbUrl, '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim()
    throw new Error(`wipeFixtures(${groupNames.join(', ')}) failed: ${stderr ?? String(err)}`)
  }
}

/** The specs' beforeEach / afterEach: `wipeFixtures`, awaitable. */
export function cleanup(groupNames: string[], studentNames: string[]): Promise<void> {
  wipeFixtures(groupNames, studentNames)
  return Promise.resolve()
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
