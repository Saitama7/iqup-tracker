// У4 «Мои группы» (docs/design/Groups.dc.html), У5 «Группа» (GroupDetail.dc.html) and УД3 «Группы и
// ученики» (TeacherGroupsDesk.dc.html). Read-only for the teacher except «Доп. урок» (0010);
// «Оплата» comes from the real balance: debt (1–3 lessons yellow, 4+ red), «пора оплачивать», partial.
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Info, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { PageHeader, PageTitle } from '@/components/page'
import { BackButton } from '@/components/shell/back-button'
import { lessonState, lessonsWord, pluralRu } from '@/features/lessons/select'
import { displayPhone, groupLabel } from '@/features/students/model'
import { tariffFor } from '@/features/tariffs/current'
import { formatSom, GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import { cardClass, chipClass, numClass, tdClass, thClass } from '@/features/tariffs/parts'
import { useSession } from '@/lib/auth'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { lessonsQuery } from './api'
import { ExtraLessonDialog } from './group-dialogs'
import { currentRules, dayShort, lessonViews, scheduleLong, type LessonTone } from './model'
import { teacherGroupsQuery } from './teacher-api'
import {
  capacity,
  daysKey,
  groupBadges,
  groupsCaption,
  groupSummary,
  inMonth,
  memberCaption,
  memberDebtTone,
  memberRows,
  monthShort,
  scheduleDots,
  scheduleRange,
  type Badge,
  type GroupSummary,
  type MemberRow,
  type TeacherGroup,
  type TeacherGroupsSource,
} from './teacher-model'

interface Item {
  group: TeacherGroup
  summary: GroupSummary
  /** Earliest start time in effect today — list order (as on У4: 09:00, 11:00, 14:00, 15:00). */
  start: string
}

function useTeacherGroups() {
  const now = useNow()
  const today = bishkekDate(now)
  const { userId } = useSession()
  const query = useQuery(teacherGroupsQuery(userId, today))
  const items = useMemo((): Item[] => {
    const source = query.data
    if (!source) return []
    return source.groups
      .map((group) => ({
        group,
        summary: groupSummary(group, source, today, now),
        start:
          currentRules(group.schedule_rules, today)
            .map((r) => r.start_time)
            .sort()[0] ?? '99',
      }))
      .sort(
        (a, b) =>
          a.start.localeCompare(b.start) ||
          groupLabel(a.group).localeCompare(groupLabel(b.group), 'ru'),
      )
  }, [query.data, today, now])
  return { query, items, today, now }
}

export function TeacherGroupsPage({ groupId }: { groupId?: string }) {
  const isDesktop = useIsDesktop()
  const { query, items, today, now } = useTeacherGroups()

  let notice: string | null = null
  if (query.isPending) notice = 'Загружаем группы…'
  else if (query.isError) notice = 'Не удалось загрузить группы. Проверьте интернет — обновим сами.'
  else if (query.data === null) {
    notice = 'Вы ещё не привязаны к карточке учителя — обратитесь к администратору.'
  } else if (items.length === 0) notice = 'У вас пока нет групп.'

  const source = query.data ?? null
  const selected = groupId ? items.find((i) => i.group.id === groupId) : undefined

  if (isDesktop) {
    const current = selected ?? (groupId ? undefined : items[0])
    return (
      <section className="flex flex-col gap-[22px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeader
            eyebrow={items.length ? groupsCaption(items.map((i) => i.summary)) : undefined}
            title="Группы и ученики"
          />
          <p className="text-[13px] font-bold text-ink-muted">
            Состав и расписание меняет администратор
          </p>
        </div>
        {notice ? (
          <Notice>{notice}</Notice>
        ) : (
          <div className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-6">
            <nav aria-label="Мои группы" className="flex flex-col gap-2">
              {items.map((i) => (
                <DesktopGroupLink
                  key={i.group.id}
                  item={i}
                  today={today}
                  active={i.group.id === current?.group.id}
                />
              ))}
            </nav>
            {current && source ? (
              <DesktopDetail
                key={current.group.id}
                item={current}
                source={source}
                today={today}
                now={now}
              />
            ) : (
              <Notice>Группа не найдена</Notice>
            )}
          </div>
        )}
      </section>
    )
  }

  if (groupId) {
    if (selected && source) {
      return <MobileDetail item={selected} source={source} today={today} now={now} />
    }
    return (
      <section className="flex flex-col gap-4">
        <BackButton />
        <Notice>{notice ?? 'Группа не найдена'}</Notice>
      </section>
    )
  }

  return <MobileList items={items} notice={notice} today={today} />
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[18px] border border-dashed border-line-strong bg-card p-5 text-sm font-bold text-ink-muted">
      {children}
    </p>
  )
}

const BADGE: Record<Badge['tone'], string> = {
  neutral: 'bg-stone text-ink',
  debt: 'bg-burned-soft text-burned-deep',
  warn: 'bg-warn-soft text-warn-strong',
}

// ─── У4 · phone list ────────────────────────────────────────────────────────

function MobileList({
  items,
  notice,
  today,
}: {
  items: Item[]
  notice: string | null
  today: string
}) {
  const [filter, setFilter] = useState<string | null>(null)
  const keys = [
    ...new Set(items.map((i) => daysKey(i.group.schedule_rules, today)).filter(Boolean)),
  ].sort()
  const shown = filter
    ? items.filter((i) => daysKey(i.group.schedule_rules, today) === filter)
    : items

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        eyebrow={items.length ? groupsCaption(items.map((i) => i.summary)) : undefined}
        title="Мои группы"
      />
      {notice ? (
        <Notice>{notice}</Notice>
      ) : (
        <>
          {keys.length > 1 && (
            <div role="group" aria-label="Дни" className="flex flex-wrap gap-2">
              {[null, ...keys].map((k) => (
                <button
                  key={k ?? 'all'}
                  type="button"
                  aria-pressed={filter === k}
                  onClick={() => {
                    setFilter(k)
                  }}
                  className={cn(
                    'min-h-11 rounded-full px-3.5 text-[13px] whitespace-nowrap',
                    filter === k
                      ? 'bg-ink font-extrabold text-brand'
                      : 'border border-line bg-card font-bold text-ink-muted',
                  )}
                >
                  {k ?? 'Все'}
                </button>
              ))}
            </div>
          )}
          <ul aria-label="Мои группы" className="flex flex-col gap-2.5">
            {shown.map((i) => (
              <li key={i.group.id}>
                <GroupCard item={i} today={today} />
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-2 px-1 text-xs font-bold text-ink-muted">
            <Info className="size-4 shrink-0" aria-hidden />
            Состав групп и расписание меняет администратор
          </p>
        </>
      )}
    </section>
  )
}

function GroupCard({ item, today }: { item: Item; today: string }) {
  const { group, summary } = item
  const badges = groupBadges(summary, GROUP_TYPE_LABEL[group.group_type], inMonth(today))
  return (
    <Link
      to="/groups/$groupId"
      params={{ groupId: group.id }}
      className={cn(
        'flex flex-col gap-3 rounded-[20px] bg-card',
        summary.isNow ? 'border-2 border-brand p-[15px]' : 'border border-line p-4',
      )}
    >
      <span className="flex items-start justify-between gap-2.5">
        <span className="flex flex-col gap-[3px]">
          <span className="font-display text-base font-bold">{groupLabel(group)}</span>
          <span className="text-[13px] font-bold text-teal">
            {scheduleDots(group.schedule_rules, today)}
            {summary.isNow ? ' · сейчас' : ''}
          </span>
        </span>
        <span className="rounded-full bg-brand px-2.5 py-1.5 text-xs font-extrabold whitespace-nowrap">
          {capacity(summary)}
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {badges.map((b) => (
          <span
            key={b.text}
            className={cn(
              'rounded-lg px-2 py-1 text-xs font-bold whitespace-nowrap',
              BADGE[b.tone],
            )}
          >
            {b.text}
          </span>
        ))}
      </span>
    </Link>
  )
}

// ─── Shared detail state ────────────────────────────────────────────────────

/** Today's lesson to mark: the current one, else the first not held. */
function todayLesson(group: TeacherGroup, today: string, now: number) {
  const lessons = group.lessons
    .filter((l) => l.lesson_date === today && l.status !== 'cancelled')
    .sort((a, b) => a.planned_start.localeCompare(b.planned_start))
  return (
    lessons.find((l) => lessonState(l, now) === 'current') ??
    lessons.find((l) => l.status === 'planned') ??
    lessons[0] ??
    null
  )
}

function durationOf(group: TeacherGroup, source: TeacherGroupsSource, today: string) {
  return tariffFor(group.group_type, today, source.tariffs)?.lesson_duration_min ?? null
}

function MarkTodayLink({
  group,
  today,
  now,
  className,
}: {
  group: TeacherGroup
  today: string
  now: number
  className: string
}) {
  const lesson = todayLesson(group, today, now)
  if (!lesson) {
    return <span className={cn(className, 'bg-line text-ink-muted')}>Сегодня занятий нет</span>
  }
  return (
    <Link
      to="/lessons/$lessonId"
      params={{ lessonId: lesson.id }}
      className={cn(className, 'bg-ink text-brand')}
    >
      {lesson.status === 'held' ? 'Проведено сегодня' : 'Отметить сегодня'}
    </Link>
  )
}

/** «Занятия» tab: lessons of the month, each opens its attendance sheet. */
function MonthLessons({ group, today }: { group: TeacherGroup; today: string }) {
  const lessons = useQuery(lessonsQuery(group.id))
  const views = useMemo(
    () =>
      lessonViews(lessons.data ?? [], today, new Map()).filter(
        (v) => v.date.slice(0, 7) === today.slice(0, 7),
      ),
    [lessons.data, today],
  )
  if (lessons.isPending)
    return <div className={cn(cardClass, 'h-40 animate-pulse')} aria-label="Загрузка" />
  if (lessons.isError) return <Notice>Не удалось загрузить занятия.</Notice>
  if (views.length === 0) return <Notice>В этом месяце занятий нет.</Notice>
  return (
    <ul aria-label="Занятия группы" className={cn(cardClass, 'flex flex-col')}>
      {views.map((v) => {
        const inner = (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={cn('text-sm font-extrabold', v.tone === 'cancelled' && 'line-through')}
              >
                {v.when}
                {v.isExtra ? ' · доп. урок' : ''}
              </span>
              <span className={cn('text-xs font-bold', TONE_TEXT[v.tone])}>{v.status}</span>
            </span>
          </>
        )
        return (
          <li key={v.id} className="border-b border-line last:border-b-0">
            {v.tone === 'cancelled' ? (
              <div className="flex min-h-14 items-center gap-3 px-4 py-2.5 opacity-70">{inner}</div>
            ) : (
              <Link
                to="/lessons/$lessonId"
                params={{ lessonId: v.id }}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5"
              >
                {inner}
                <span className="text-xs font-extrabold whitespace-nowrap text-teal">
                  Открыть →
                </span>
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const TONE_TEXT: Record<LessonTone, string> = {
  planned: 'text-ink-muted',
  today: 'text-teal',
  unconfirmed: 'text-burned-strong',
  held: 'text-present-strong',
  late: 'text-warn',
  cancelled: 'text-ink-muted',
}

// ─── У5 · phone group ───────────────────────────────────────────────────────

const MEMBERS_SHOWN = 6
const STUDENTS = ['ученик', 'ученика', 'учеников'] as const

function MobileDetail({
  item,
  source,
  today,
  now,
}: {
  item: Item
  source: TeacherGroupsSource
  today: string
  now: number
}) {
  const { group, summary } = item
  const [tab, setTab] = useState<'students' | 'lessons'>('students')
  const [all, setAll] = useState(false)
  const [extra, setExtra] = useState(false)
  const members = memberRows(group, today)
  const shown = all ? members : members.slice(0, MEMBERS_SHOWN)
  const more = members.length - shown.length
  const schedule = [
    scheduleRange(group.schedule_rules, today, durationOf(group, source, today)),
    group.room ? `каб. ${group.room}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const stats: [string, string, boolean?][] = [
    [
      String(summary.held),
      `${pluralRu(summary.held, ['занятие', 'занятия', 'занятий'])} в ${monthShort(today)}`,
    ],
    [String(summary.studentLessons), 'ученико-уроков'],
    [formatSom(summary.accrued), 'начислено · предв.', true],
  ]

  return (
    <section className="flex flex-1 flex-col gap-3.5">
      <header className="-mx-5 -mt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))] flex flex-col gap-3 rounded-b-[28px] bg-ink px-5 pt-[max(1rem,calc(env(safe-area-inset-top)+0.75rem))] pb-4 text-paper">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <BackButton tone="ink" />
          <span className="rounded-full bg-brand px-3 py-1.5 text-xs font-extrabold whitespace-nowrap text-ink">
            {GROUP_TYPE_LABEL[group.group_type]} · {capacity(summary)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[22px] leading-[1.15] font-bold">{groupLabel(group)}</h1>
          <p className="text-[13px] font-bold text-brand">{schedule}</p>
        </div>
        <dl className="grid grid-cols-3 gap-2">
          {stats.map(([value, label, accent]) => (
            <div
              key={label}
              className="flex flex-col-reverse gap-px rounded-xl bg-paper/8 px-2.5 py-2"
            >
              <dt className="text-[11px] font-bold opacity-65">{label}</dt>
              <dd className={cn('font-display text-base font-bold', accent && 'text-brand')}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <div role="tablist" className="flex gap-2">
        {(
          [
            ['students', 'Ученики'],
            ['lessons', 'Занятия'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              setTab(value)
            }}
            className={cn(
              'min-h-11 flex-1 rounded-xl text-[13px]',
              tab === value
                ? 'bg-ink font-extrabold text-brand'
                : 'border border-line bg-card font-bold text-ink-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'students' ? (
        members.length === 0 ? (
          <Notice>В группе пока нет учеников.</Notice>
        ) : (
          <ul aria-label="Ученики" className="flex flex-col gap-2">
            {shown.map((m) => (
              <MemberCard key={m.studentId} m={m} />
            ))}
            {more > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setAll(true)
                  }}
                  className="min-h-11 w-full text-xs font-bold text-ink-muted"
                >
                  ещё {more} {pluralRu(more, STUDENTS)}
                </button>
              </li>
            )}
          </ul>
        )
      ) : (
        <MonthLessons group={group} today={today} />
      )}
      {/* «Пробные» under the roster — R2. */}

      <footer className="sticky bottom-0 -mx-5 mt-auto -mb-[max(1.5rem,env(safe-area-inset-bottom))] flex gap-2.5 border-t border-line bg-card px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => {
            setExtra(true)
          }}
          className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink text-sm font-extrabold"
        >
          <Plus className="size-[18px]" strokeWidth={2.5} aria-hidden />
          Доп. урок
        </button>
        <MarkTodayLink
          group={group}
          today={today}
          now={now}
          className="flex min-h-[52px] flex-[1.4] items-center justify-center rounded-2xl text-sm font-extrabold"
        />
      </footer>
      {extra && (
        <ExtraLesson
          group={group}
          today={today}
          onClose={() => {
            setExtra(false)
          }}
        />
      )}
    </section>
  )
}

function ExtraLesson({
  group,
  today,
  onClose,
}: {
  group: TeacherGroup
  today: string
  onClose: () => void
}) {
  const lessons = useQuery(lessonsQuery(group.id))
  return (
    <ExtraLessonDialog
      open
      onOpenChange={onClose}
      group={group}
      lessons={lessons.data ?? []}
      today={today}
      minDate={today}
    />
  )
}

const MEMBER_TONE = { soon: 'text-warn', partial: 'text-warn', ok: 'text-ink-muted' } as const

const memberTone = (m: MemberRow) =>
  m.pay === 'debt'
    ? memberDebtTone(m) === 'debt'
      ? 'text-burned-strong'
      : 'text-warn'
    : MEMBER_TONE[m.pay]

function MemberCard({ m }: { m: MemberRow }) {
  const b = m.balance
  return (
    <li
      aria-label={m.fullName}
      className="flex items-center gap-3 rounded-2xl border border-line bg-card px-3.5 py-3"
    >
      <span
        className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-brand font-display text-xs font-bold"
        aria-hidden
      >
        {m.initials}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-extrabold">{m.fullName}</span>
        <span className={cn('text-xs font-bold', memberTone(m))}>
          {memberCaption(m, displayPhone(m.parentPhone))}
        </span>
      </span>
      {b && (
        <span className="flex flex-col items-end gap-0.5">
          <span
            className={cn(
              'font-display text-sm font-bold whitespace-nowrap',
              m.debt > 0 && (memberDebtTone(m) === 'debt' ? 'text-burned-strong' : 'text-warn'),
            )}
          >
            {m.debt > 0 ? `−${m.debt}` : `${b.left} / ${b.total}`}
          </span>
          <span className="text-[11px] font-bold text-ink-muted">
            {m.debt > 0 ? 'в долг' : 'осталось'}
          </span>
        </span>
      )}
    </li>
  )
}

// ─── УД3 · desktop ──────────────────────────────────────────────────────────

function DesktopGroupLink({ item, today, active }: { item: Item; today: string; active: boolean }) {
  const { group, summary } = item
  return (
    <Link
      to="/groups/$groupId"
      params={{ groupId: group.id }}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-col gap-1 rounded-2xl px-4 py-3.5',
        active ? 'bg-ink text-paper' : 'border border-line bg-card text-ink',
      )}
    >
      <span className="text-[15px] font-extrabold">{groupLabel(group)}</span>
      <span className={cn('text-xs font-bold', active ? 'text-brand' : 'text-teal')}>
        {scheduleDots(group.schedule_rules, today)} · {capacity(summary, '/')}
      </span>
    </Link>
  )
}

function DesktopDetail({
  item,
  source,
  today,
  now,
}: {
  item: Item
  source: TeacherGroupsSource
  today: string
  now: number
}) {
  const { group, summary } = item
  const [tab, setTab] = useState<'students' | 'lessons'>('students')
  const [extra, setExtra] = useState(false)
  const members = memberRows(group, today)
  const tariff = tariffFor(group.group_type, today, source.tariffs)
  const caption = [
    GROUP_TYPE_LABEL[group.group_type],
    scheduleLong(currentRules(group.schedule_rules, today), tariff?.lesson_duration_min ?? null),
    group.room ? `каб. ${group.room}` : null,
    tariff
      ? `${formatSom(tariff.package_price)} сом / ${lessonsWord(tariff.lessons_in_package)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const kpi: [string, string, boolean?][] = [
    [inMonth(today), lessonsWord(summary.held)],
    ['Ученико-уроков', String(summary.studentLessons)],
    ['Начислено · предварительно', `${formatSom(summary.accrued)} сом`, true],
    [
      'Долги',
      summary.debtors ? `${summary.debtors} ${pluralRu(summary.debtors, STUDENTS)}` : 'нет',
    ],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className={cn(cardClass, 'flex flex-wrap items-center justify-between gap-4 px-6 py-5')}>
        <div className="flex flex-col gap-1">
          <PageTitle className="text-xl min-[900px]:text-xl">{groupLabel(group)}</PageTitle>
          <p className="text-[13px] font-bold text-ink-muted">{caption}</p>
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => {
              setExtra(true)
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-ink px-4 text-[13px] font-extrabold"
          >
            <Plus className="size-4" strokeWidth={2.5} aria-hidden />
            Доп. урок
          </button>
          <MarkTodayLink
            group={group}
            today={today}
            now={now}
            className="inline-flex min-h-11 items-center rounded-xl border-[1.5px] border-ink px-4 text-[13px] font-extrabold"
          />
          <button
            type="button"
            aria-pressed={tab === 'lessons'}
            onClick={() => {
              setTab(tab === 'lessons' ? 'students' : 'lessons')
            }}
            className="inline-flex min-h-11 items-center rounded-xl bg-ink px-4 text-[13px] font-extrabold text-brand"
          >
            {tab === 'lessons' ? 'Ученики группы' : 'Занятия группы'}
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-4 gap-3">
        {kpi.map(([label, value, accent]) => (
          <div
            key={label}
            className={cn(
              'flex flex-col-reverse gap-0.5 rounded-2xl px-4 py-3.5',
              accent ? 'bg-brand' : 'border border-line bg-card',
            )}
          >
            <dd
              className={cn(
                'font-display text-xl whitespace-nowrap',
                accent ? 'font-extrabold' : 'font-bold',
              )}
            >
              {value}
            </dd>
            <dt
              className={cn(
                'text-[11px] font-extrabold tracking-[0.06em] uppercase',
                accent ? 'opacity-70' : 'text-ink-muted',
              )}
            >
              {label}
            </dt>
          </div>
        ))}
      </dl>

      {tab === 'lessons' ? (
        <MonthLessons group={group} today={today} />
      ) : members.length === 0 ? (
        <Notice>В группе пока нет учеников.</Notice>
      ) : (
        <div className={cn(cardClass, 'overflow-x-auto')}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={thClass}>Ученик · родитель</th>
                <th className={thClass}>С даты</th>
                <th className={cn(thClass, 'text-right')}>Осталось</th>
                <th className={cn(thClass, 'text-right')}>Замор.</th>
                <th className={thClass}>Оплата</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <MemberTableRow key={m.studentId} m={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {extra && (
        <ExtraLesson
          group={group}
          today={today}
          onClose={() => {
            setExtra(false)
          }}
        />
      )}
    </div>
  )
}

function MemberTableRow({ m }: { m: MemberRow }) {
  const b = m.balance
  return (
    <tr className="[&:last-child>td]:border-b-0">
      <td className={tdClass}>
        <div className="font-extrabold whitespace-nowrap">{m.fullName}</div>
        <div className="text-[11px] font-bold whitespace-nowrap text-ink-muted">
          {displayPhone(m.parentPhone) ?? '—'}
        </div>
      </td>
      <td className={cn(tdClass, 'whitespace-nowrap')}>{dayShort(m.startDate)}</td>
      <td
        className={cn(
          tdClass,
          numClass,
          m.debt > 0 &&
            cn('font-extrabold', memberDebtTone(m) === 'debt' ? 'text-burned-strong' : 'text-warn'),
        )}
      >
        {b ? (m.debt > 0 ? `−${m.debt}` : `${b.left} / ${b.total}`) : '—'}
      </td>
      <td className={cn(tdClass, numClass)}>{b ? `${b.freezes} / ${b.freezeLimit}` : '—'}</td>
      <td className={tdClass}>
        {m.pay === 'debt' ? (
          <span
            className={cn(
              chipClass,
              memberDebtTone(m) === 'debt'
                ? 'bg-burned-soft text-burned-deep'
                : 'bg-warn-soft text-warn-strong',
            )}
          >
            {b ? `Долг ${m.debt} ур. · ${formatSom(m.debtSom)} сом` : 'Нет абонемента'}
          </span>
        ) : m.pay === 'soon' ? (
          <span className={cn(chipClass, 'bg-warn-soft text-warn-strong')}>Пора оплачивать</span>
        ) : m.pay === 'partial' ? (
          <span className={cn(chipClass, 'bg-warn-soft text-warn-strong')}>
            Частично · {m.paidLessons} ур
          </span>
        ) : (
          <span className="text-sm font-bold text-ink-muted">—</span>
        )}
      </td>
    </tr>
  )
}
