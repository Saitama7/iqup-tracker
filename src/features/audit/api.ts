// А10 data: v_audit_feed (0014, RLS — admin and accountant) a page of 50 at a time, newest first,
// keyset by (at, id) so rows written while the page is open never shift «Показать ещё»; then the
// names the page's rows point at (students, groups, lessons…) in one round of reads. The search box
// filters on the server (v_audit_feed.search, 0019); the chip counts are one RPC (audit_feed_counts).
import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { GROUP_TYPES, type GroupType } from '@/features/tariffs/current'
import { subjectName } from '@/features/subjects/api'
import { supabase } from '@/lib/supabase/client'
import type { AuditKind, AuditLookups, AuditRow } from './describe'
import { KINDS, likePattern, PAGE_SIZE, SYSTEM_ACTOR, type AuditFilters } from './model'

export const AUDIT_KEY = 'audit'
const POLL_MS = 60_000

const snapshot = z.record(z.string(), z.unknown()).nullable()

const rowSchema = z
  .object({
    id: z.uuid(),
    actor_id: z.uuid().nullable(),
    entity: z.string(),
    entity_id: z.uuid(),
    action: z.enum(['insert', 'update', 'delete']),
    before: snapshot,
    after: snapshot,
    reason: z.string().nullable(),
    at: z.string(),
    kind: z.enum(KINDS as [AuditKind, ...AuditKind[]]),
    marks: z.array(z.string()).nullable(),
  })
  .transform((r): AuditRow => ({
    id: r.id,
    actorId: r.actor_id,
    entity: r.entity,
    entityId: r.entity_id,
    action: r.action,
    before: r.before,
    after: r.after,
    reason: r.reason,
    at: r.at,
    kind: r.kind,
    marks: r.marks,
  }))

const FIELDS = 'id, actor_id, entity, entity_id, action, before, after, reason, at, kind, marks'

/** Where the next page starts: strictly older than the last row shown. */
export interface Cursor {
  at: string
  id: string
}

export interface AuditPage {
  rows: AuditRow[]
  lookups: Omit<AuditLookups, 'profiles'>
  next: Cursor | null
}

/** The feed with the kind / table / author / period / search filters. */
function feed(f: AuditFilters) {
  let query = supabase.from('v_audit_feed').select(FIELDS)
  if (f.kind) query = query.eq('kind', f.kind)
  if (f.entity) query = query.eq('entity', f.entity)
  if (f.actor === SYSTEM_ACTOR) query = query.is('actor_id', null)
  else if (f.actor) query = query.eq('actor_id', f.actor)
  if (f.since) query = query.gte('at', f.since)
  if (f.q) query = query.like('search', likePattern(f.q))
  return query
}

const ids = (values: Iterable<string | null | undefined>) => [
  ...new Set([...values].filter((v): v is string => typeof v === 'string')),
]

const field = (row: AuditRow, key: string) => {
  const v = (row.after ?? row.before)?.[key]
  return typeof v === 'string' ? v : null
}

const lessonSchema = z.object({
  id: z.uuid(),
  group_id: z.uuid(),
  lesson_date: z.string(),
  planned_start: z.string(),
})
const enrollmentSchema = z.object({ id: z.uuid(), student_id: z.uuid(), group_id: z.uuid() })
const subscriptionSchema = z.object({
  id: z.uuid(),
  lessons_total: z.number().int(),
  price_final: z.number().int(),
  enrollment: enrollmentSchema,
})
const named = z.object({ id: z.uuid(), full_name: z.string() })
const groupSchema = z.object({ id: z.uuid(), name: z.string(), subject: subjectName })
const tariffSchema = z.object({
  id: z.uuid(),
  group_type: z.enum(GROUP_TYPES as [GroupType, ...GroupType[]]),
  valid_from: z.string(),
  package_price: z.number().int(),
  lessons_in_package: z.number().int(),
})

async function select<T>(
  run: () => PromiseLike<{ data: unknown; error: Error | null }>,
  schema: z.ZodType<T>,
  skip: boolean,
): Promise<T[]> {
  if (skip) return []
  const { data, error } = await run()
  if (error) throw error
  return z.array(schema).parse(data)
}

/** Names behind the page's rows. Two steps: lessons / enrollments first, then who and which group. */
async function fetchLookups(rows: readonly AuditRow[]): Promise<AuditPage['lookups']> {
  const lessonIds = ids(
    rows
      .filter((r) => r.entity === 'attendance' || r.entity === 'trials')
      .map((r) => field(r, 'lesson_id')),
  )
  const enrollmentIds = ids(
    rows.filter((r) => r.entity === 'subscriptions').map((r) => field(r, 'enrollment_id')),
  )
  const subscriptionIds = ids(
    rows.filter((r) => r.entity === 'payments').map((r) => field(r, 'subscription_id')),
  )
  const [lessons, ownEnrollments, tariffs, subscriptions] = await Promise.all([
    select(
      () =>
        supabase
          .from('lessons')
          .select('id, group_id, lesson_date, planned_start')
          .in('id', lessonIds),
      lessonSchema,
      lessonIds.length === 0,
    ),
    select(
      () => supabase.from('enrollments').select('id, student_id, group_id').in('id', enrollmentIds),
      enrollmentSchema,
      enrollmentIds.length === 0,
    ),
    select(
      () =>
        supabase
          .from('tariffs')
          .select('id, group_type, valid_from, package_price, lessons_in_package'),
      tariffSchema,
      !rows.some((r) => r.entity === 'tariffs'),
    ),
    select(
      () =>
        supabase
          .from('subscriptions')
          .select(
            'id, lessons_total, price_final, enrollment:enrollments!inner(id, student_id, group_id)',
          )
          .in('id', subscriptionIds),
      subscriptionSchema,
      subscriptionIds.length === 0,
    ),
  ])
  const enrollments = [...ownEnrollments, ...subscriptions.map((s) => s.enrollment)]

  const studentIds = ids([
    ...rows
      .filter((r) => r.entity === 'attendance' || r.entity === 'enrollments')
      .map((r) => field(r, 'student_id')),
    ...enrollments.map((e) => e.student_id),
  ])
  const groupIds = ids([
    ...rows
      .filter((r) => r.entity === 'lessons' || r.entity === 'enrollments' || r.entity === 'trials')
      .map((r) => field(r, 'group_id')),
    ...rows.filter((r) => r.entity === 'groups').map((r) => r.entityId),
    ...lessons.map((l) => l.group_id),
    ...enrollments.map((e) => e.group_id),
  ])
  const teacherIds = ids([
    ...rows.filter((r) => r.entity === 'teacher_rates').map((r) => field(r, 'teacher_id')),
    ...rows.filter((r) => r.entity === 'lessons').map((r) => field(r, 'substitute_teacher_id')),
  ])
  const [students, groups, teachers] = await Promise.all([
    select(
      () => supabase.from('students').select('id, full_name').in('id', studentIds),
      named,
      studentIds.length === 0,
    ),
    select(
      () => supabase.from('groups').select('id, name, subject:subjects(name)').in('id', groupIds),
      groupSchema,
      groupIds.length === 0,
    ),
    select(
      () => supabase.from('teachers').select('id, full_name').in('id', teacherIds),
      named,
      teacherIds.length === 0,
    ),
  ])

  return {
    students: Object.fromEntries(students.map((s) => [s.id, s.full_name])),
    teachers: Object.fromEntries(teachers.map((t) => [t.id, t.full_name])),
    groups: Object.fromEntries(groups.map((g) => [g.id, { name: g.name, subject: g.subject }])),
    lessons: Object.fromEntries(
      lessons.map((l) => [
        l.id,
        { groupId: l.group_id, date: l.lesson_date, start: l.planned_start },
      ]),
    ),
    enrollments: Object.fromEntries(
      enrollments.map((e) => [e.id, { studentId: e.student_id, groupId: e.group_id }]),
    ),
    subscriptions: Object.fromEntries(
      subscriptions.map((s) => [
        s.id,
        { enrollmentId: s.enrollment.id, lessons: s.lessons_total, price: s.price_final },
      ]),
    ),
    tariffs: tariffs.map((t) => ({
      id: t.id,
      groupType: t.group_type,
      validFrom: t.valid_from,
      price: t.package_price,
      lessons: t.lessons_in_package,
    })),
  }
}

async function fetchPage(f: AuditFilters, cursor: Cursor | null): Promise<AuditPage> {
  let query = feed(f)
  if (cursor) {
    query = query.or(`at.lt."${cursor.at}",and(at.eq."${cursor.at}",id.lt.${cursor.id})`)
  }
  const { data, error } = await query
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE + 1)
  if (error) throw error
  const all = z.array(rowSchema).parse(data)
  const rows = all.slice(0, PAGE_SIZE)
  const last = rows.at(-1)
  return {
    rows,
    lookups: await fetchLookups(rows),
    next: all.length > PAGE_SIZE && last ? { at: last.at, id: last.id } : null,
  }
}

export const auditFeedQuery = (f: AuditFilters) =>
  infiniteQueryOptions({
    queryKey: [AUDIT_KEY, 'feed', f],
    queryFn: ({ pageParam }) => fetchPage(f, pageParam),
    initialPageParam: null as Cursor | null,
    getNextPageParam: (page) => page.next,
    // a new search / filter keeps the old rows on screen until the answer comes
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
  })

export type KindCounts = Record<AuditKind | 'all', number>

const countSchema = z.object({ kind: z.enum(KINDS as [AuditKind, ...AuditKind[]]), n: z.number() })

/** «Все · 214», «Правки задним числом · 6»… for the current table / author / period / search. */
export const auditCountsQuery = (f: Omit<AuditFilters, 'kind'>) =>
  queryOptions({
    queryKey: [AUDIT_KEY, 'counts', f],
    queryFn: async (): Promise<KindCounts> => {
      const system = f.actor === SYSTEM_ACTOR
      const { data, error } = await supabase.rpc('audit_feed_counts', {
        p_entity: f.entity ?? undefined,
        p_actor: f.actor && !system ? f.actor : undefined,
        p_system: system,
        p_since: f.since ?? undefined,
        p_q: f.q ?? undefined,
      })
      if (error) throw error
      const counts = Object.fromEntries([['all', 0], ...KINDS.map((k) => [k, 0])]) as KindCounts
      for (const { kind, n } of z.array(countSchema).parse(data)) {
        counts[kind] = n
        counts.all += n
      }
      return counts
    },
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
  })

const profileSchema = z.object({ id: z.uuid(), full_name: z.string() })

/** Authors: every profile (RLS: staff read all) — names in the rows and «Все пользователи ▾». */
export const auditActorsQuery = () =>
  queryOptions({
    queryKey: [AUDIT_KEY, 'actors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .order('full_name')
      if (error) throw error
      return z.array(profileSchema).parse(data)
    },
  })
