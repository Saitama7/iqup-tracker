import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'
import { PageTitle } from '@/components/page'
import { BackButton } from '@/components/shell/back-button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fromAdminGroup, type GroupTab } from '@/features/lessons/return-to'
import { balancesQuery } from '@/features/payments/api'
import { studentsQuery } from '@/features/students/api'
import {
  currentSubscription,
  discountCaption,
  firstName,
  formatDayMonth,
  groupLabel,
  shortName,
  type Balance,
  type StudentsSource,
} from '@/features/students/model'
import { fillCaption } from '@/features/trials/model'
import { EnrollDialog, type EnrollStudent } from '@/features/subscriptions/enroll-dialog'
import {
  EnrollmentExitDialog,
  EnrollmentMenu,
  type ExitAction,
} from '@/features/subscriptions/enrollment-exit'
import { tariffFor } from '@/features/tariffs/current'
import { GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import { cardClass, numClass, tdClass, thClass } from '@/features/tariffs/parts'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { GROUPS_KEY, groupsQuery, lessonsQuery, type GroupsSource } from './api'
import { DeleteGroupDialog } from './delete-group-dialog'
import {
  ArchiveGroupDialog,
  CancelLessonDialog,
  EditGroupDialog,
  ExtraLessonDialog,
  SubstituteDialog,
} from './group-dialogs'
import {
  currentRules,
  lessonViews,
  monthName,
  monthProgress,
  percentOn,
  scheduleLong,
  tariffCaption,
  type GroupRow,
  type LessonRow,
  type LessonTone,
  type LessonView,
} from './model'
import { TrialCards, TrialTableRows, useGroupTrials, useTrialActions } from './group-trials'
import { GroupStatusChip } from './parts'

interface MemberRow {
  enrollmentId: string
  studentId: string
  fullName: string
  caption: string | null
  startDate: string
  left: number | null
  total: number | null
  freezes: string
}

/** Students actively enrolled in the group with their current subscription (А4 table). */
function members(
  data: StudentsSource,
  balanceRows: readonly Balance[],
  groupId: string,
): MemberRow[] {
  const balances = new Map(balanceRows.map((b) => [b.subscriptionId, b]))
  const byId = new Map(data.students.map((s) => [s.id, s]))
  return data.students
    .flatMap((s) => {
      const e = s.enrollments.find((x) => x.group_id === groupId && x.status === 'active')
      if (!e) return []
      const sub = currentSubscription(e)
      const balance = sub ? balances.get(sub.id) : undefined
      const referrer = s.referred_by_student_id ? byId.get(s.referred_by_student_id) : undefined
      const caption =
        (sub && discountCaption(sub)) ??
        // А4 «привёл Тимур М. → 5 % Тимуру» without the dative (no name declension), as on А6
        (referrer ? `привёл ${shortName(referrer.full_name)}` : null)
      return [
        {
          enrollmentId: e.id,
          studentId: s.id,
          fullName: s.full_name,
          caption,
          startDate: e.start_date,
          left: sub ? (balance?.lessonsLeft ?? sub.lessons_total) : null,
          total: sub?.lessons_total ?? null,
          freezes: balance ? `${balance.freezesUsed} / ${balance.freezeLimit}` : '—',
        },
      ]
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
}

function enrollCandidates(data: StudentsSource, groupId: string): EnrollStudent[] {
  return data.students
    .filter((s) => !s.enrollments.some((e) => e.group_id === groupId && e.status === 'active'))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'))
    .map((s) => ({
      id: s.id,
      fullName: s.full_name,
      isReturning: s.is_returning,
      subscriptions: s.enrollments.flatMap((e) => e.subscriptions),
      friendsBrought: data.students.filter((f) => f.referred_by_student_id === s.id).length,
    }))
}

type Dialog =
  | { kind: 'edit' }
  | { kind: 'archive' }
  | { kind: 'delete' }
  | { kind: 'enroll' }
  | { kind: 'exit'; row: MemberRow; action: ExitAction }
  | { kind: 'extra'; makesUpFor?: string }
  | { kind: 'cancel'; lesson: LessonRow }
  | { kind: 'substitute'; lesson: LessonRow }

// А4 Группа (docs/design/AdminGroup.dc.html): header, «Ученики» (R1-4 enrollments) and «Занятия»
// (cancel / extra lesson / substitute). payments and debts live on А5 / А6 / А7.
export function GroupPage({
  groupId,
  tab = 'students',
  onTabChange,
}: {
  groupId: string
  /** «Ученики» / «Занятия» — in the URL, the return from a lesson opens the same tab (#89). */
  tab?: GroupTab
  onTabChange: (tab: GroupTab) => void
}) {
  const isDesktop = useIsDesktop()
  const now = useNow()
  const today = bishkekDate(now)
  const queryClient = useQueryClient()
  const groups = useQuery(groupsQuery())
  const students = useQuery(studentsQuery())
  const balances = useQuery(balancesQuery())
  const lessons = useQuery(lessonsQuery(groupId))
  const trials = useGroupTrials(groupId)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const group = groups.data?.groups.find((g) => g.id === groupId) ?? null
  const teacherNames = useMemo(
    () => new Map((groups.data?.teachers ?? []).map((t) => [t.id, firstName(t.full_name)])),
    [groups.data],
  )
  const views = useMemo(
    () => lessonViews(lessons.data ?? [], today, teacherNames),
    [lessons.data, today, teacherNames],
  )
  const roster = useMemo(
    () => (students.data ? members(students.data, balances.data ?? [], groupId) : []),
    [students.data, balances.data, groupId],
  )

  const trialActions = useTrialActions(group, today, students.data)

  if (groups.isPending) {
    return <div className={cn(cardClass, 'h-64 animate-pulse')} aria-label="Загрузка" />
  }
  if (groups.isError) {
    return (
      <p role="alert" className={cn(cardClass, 'p-5 font-bold text-burned')}>
        Не удалось загрузить группу. Проверьте интернет и обновите страницу.
      </p>
    )
  }
  if (!group) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton />
        <p className={cn(cardClass, 'p-5 font-bold text-ink-muted')}>Группа не найдена</p>
      </div>
    )
  }

  const data = groups.data
  const label = groupLabel(group)
  const tariff = tariffFor(group.group_type, today, data.tariffs)
  const progress = monthProgress(lessons.data ?? [], today)
  const archived = group.status === 'archived'
  const lessonById = new Map((lessons.data ?? []).map((l) => [l.id, l]))
  const close = () => {
    setDialog(null)
  }
  const onAction = (row: MemberRow, action: ExitAction) => {
    setDialog({ kind: 'exit', row, action })
  }
  const onLessonAction = (action: 'cancel' | 'substitute' | 'extra', id: string) => {
    if (action === 'extra') {
      setDialog({ kind: 'extra', makesUpFor: id })
      return
    }
    const lesson = lessonById.get(id)
    if (lesson) setDialog({ kind: action, lesson })
  }

  const actions = !archived && (
    <div className="flex flex-wrap gap-2.5">
      <ActionButton
        onClick={() => {
          setDialog({ kind: 'edit' })
        }}
      >
        Изменить
      </ActionButton>
      <ActionButton
        onClick={() => {
          setDialog({ kind: 'extra' })
        }}
      >
        Доп. урок
      </ActionButton>
      <Link
        to="/admin/trials"
        search={{ group: group.id }}
        className="flex min-h-11 items-center rounded-xl border-[1.5px] border-dashed border-trial px-4 text-[13px] font-extrabold whitespace-nowrap text-trial-strong"
      >
        + На пробное
      </Link>
      <ActionButton
        onClick={() => {
          setDialog({ kind: 'archive' })
        }}
        className="text-burned-strong"
      >
        Архивировать
      </ActionButton>
      <button
        type="button"
        disabled={!students.data}
        onClick={() => {
          setDialog({ kind: 'enroll' })
        }}
        className="min-h-11 rounded-xl bg-ink px-4 text-[13px] font-extrabold whitespace-nowrap text-brand disabled:opacity-50"
      >
        + Зачислить ученика
      </button>
    </div>
  )

  const fill = fillCaption(group.students, tariff?.max_students ?? null, trials.length)
  const stats = (
    <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
      <StatCard label="Учеников">
        {fill.fill}
        {fill.trials && (
          <span className="ml-1.5 text-[13px] font-bold text-trial-strong">{fill.trials}</span>
        )}
      </StatCard>
      <StatCard label={`${monthName(today)} · занятий`}>
        {lessons.isPending ? '…' : `${progress.held} из ${progress.total}`}
      </StatCard>
    </div>
  )

  const studentsTable = (
    <section className={cn(cardClass, 'overflow-x-auto')}>
      <div className="flex items-center justify-between border-b border-line px-[18px] py-3.5">
        <h2 className="text-[15px] font-extrabold">Ученики и абонементы</h2>
      </div>
      {students.isPending ? (
        <div className="h-40 animate-pulse" aria-label="Загрузка" />
      ) : roster.length === 0 && trials.length === 0 ? (
        <p className="p-5 font-bold text-ink-muted">В группе пока нет учеников</p>
      ) : isDesktop ? (
        <MembersTable rows={roster} onAction={onAction}>
          <TrialTableRows
            trials={trials}
            today={today}
            fill={fill.fill}
            onAction={trialActions.onAction}
          />
        </MembersTable>
      ) : (
        <>
          <MembersList rows={roster} onAction={onAction} />
          <TrialCards
            trials={trials}
            today={today}
            fill={fill.fill}
            onAction={trialActions.onAction}
          />
        </>
      )}
    </section>
  )

  const lessonsTab = (
    <LessonsSection
      groupId={groupId}
      views={views}
      today={today}
      pending={lessons.isPending}
      archived={archived}
      isDesktop={isDesktop}
      onAction={onLessonAction}
    />
  )

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <BackButton />
          <div className="flex flex-wrap items-center gap-3.5">
            <PageTitle className="min-[900px]:text-[28px]">{label}</PageTitle>
            <GroupStatusChip status={group.status} className="px-3 py-1.5" />
          </div>
          <p className="text-sm font-bold text-ink-muted">{headerCaption(group, data, today)}</p>
        </div>
        {actions}
      </header>

      {stats}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          onTabChange(v === 'lessons' ? 'lessons' : 'students')
        }}
        className="gap-4"
      >
        <TabsList className="h-auto w-full rounded-xl border-[1.5px] border-line-strong bg-card p-[3px] min-[900px]:w-fit">
          {(
            [
              ['students', 'Ученики'],
              ['lessons', 'Занятия'],
            ] as const
          ).map(([value, text]) => (
            <TabsTrigger
              key={value}
              value={value}
              className="min-h-9 rounded-[9px] px-4 text-[13px] font-bold text-ink-muted data-[state=active]:bg-ink data-[state=active]:font-extrabold data-[state=active]:text-brand data-[state=active]:shadow-none"
            >
              {text}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="students">
          {isDesktop ? (
            <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)] items-start gap-6">
              {studentsTable}
              <MonthLessons
                views={views}
                today={today}
                onAll={() => {
                  onTabChange('lessons')
                }}
              />
            </div>
          ) : (
            studentsTable
          )}
        </TabsContent>
        <TabsContent value="lessons">{lessonsTab}</TabsContent>
      </Tabs>

      {trialActions.dialog}
      {dialog?.kind === 'edit' && (
        <EditGroupDialog
          open
          onOpenChange={close}
          group={group}
          holidays={data.holidays}
          today={today}
          teachers={data.teachers}
          onDelete={() => {
            setDialog({ kind: 'delete' })
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteGroupDialog
          open
          onOpenChange={close}
          groupId={group.id}
          groupName={group.name}
          lessonsCount={lessons.data?.length ?? 0}
        />
      )}
      {dialog?.kind === 'archive' && (
        <ArchiveGroupDialog open onOpenChange={close} group={group} label={label} />
      )}
      {dialog?.kind === 'extra' && (
        <ExtraLessonDialog
          open
          onOpenChange={close}
          group={group}
          lessons={lessons.data ?? []}
          makesUpFor={dialog.makesUpFor}
          today={today}
        />
      )}
      {dialog?.kind === 'cancel' && (
        <CancelLessonDialog open onOpenChange={close} groupId={group.id} lesson={dialog.lesson} />
      )}
      {dialog?.kind === 'substitute' && (
        <SubstituteDialog
          open
          onOpenChange={close}
          group={group}
          lesson={dialog.lesson}
          teachers={data.teachers}
        />
      )}
      {dialog?.kind === 'exit' && students.data && (
        <EnrollmentExitDialog
          action={dialog.action}
          onOpenChange={close}
          enrollmentId={dialog.row.enrollmentId}
          studentName={dialog.row.fullName}
          group={students.data.groups.find((g) => g.id === groupId) ?? null}
          startDate={dialog.row.startDate}
          groups={students.data.groups}
          today={today}
        />
      )}
      {dialog?.kind === 'enroll' && students.data && (
        <EnrollDialog
          open
          onOpenChange={close}
          students={enrollCandidates(students.data, group.id)}
          groups={[group]}
          groupId={group.id}
          today={today}
          onEnrolled={() => {
            void queryClient.invalidateQueries({ queryKey: GROUPS_KEY })
          }}
        />
      )}
    </div>
  )
}

/** «Групповая · Гульзат (45 %) · ВТ, ЧТ, СБ 09:00–10:00 · каб. 1 · тариф 3 200 / 12 · старт 1 сентября». */
function headerCaption(group: GroupRow, data: GroupsSource, today: string): string {
  const tariff = tariffFor(group.group_type, today, data.tariffs)
  const teacher = data.teachers.find((t) => t.id === group.teacher_id)
  const percent = teacher ? percentOn(teacher, today) : null
  const schedule = scheduleLong(
    currentRules(group.schedule_rules, today),
    tariff?.lesson_duration_min ?? null,
  )
  const price = tariff
    ? tariffCaption(group.group_type, tariff).split(' · ').slice(1).join(' · ')
    : null
  return [
    GROUP_TYPE_LABEL[group.group_type],
    teacher ? `${firstName(teacher.full_name)}${percent !== null ? ` (${percent} %)` : ''}` : null,
    schedule || null,
    group.room ? `каб. ${group.room}` : null,
    price ? `тариф ${price}` : null,
    `старт ${formatDayMonth(group.start_date)}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function ActionButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-xl border-[1.5px] border-line-strong bg-card px-4 text-[13px] font-extrabold whitespace-nowrap text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-3.5">
      <div className="text-[11px] font-extrabold tracking-[0.06em] text-ink-muted uppercase">
        {label}
      </div>
      <div className="font-display text-[22px] font-bold whitespace-nowrap">{children}</div>
    </div>
  )
}

const leftClass = (r: MemberRow) =>
  r.left === null
    ? 'text-ink-muted'
    : r.left < 0
      ? 'font-extrabold text-burned-strong'
      : r.left <= 2
        ? 'font-extrabold text-warn'
        : ''

const leftText = (r: MemberRow) =>
  r.left === null ? '—' : r.left < 0 ? `−${-r.left}` : `${r.left} / ${r.total ?? ''}`

function MembersTable({
  rows,
  children,
  onAction,
}: {
  rows: MemberRow[]
  children?: ReactNode
  onAction: (row: MemberRow, action: ExitAction) => void
}) {
  return (
    <table className="w-full min-w-[560px] border-collapse" aria-label="Ученики группы">
      <thead>
        <tr className="border-b border-line">
          <th className={thClass}>Ученик</th>
          <th className={thClass}>Зачислен</th>
          <th className={cn(thClass, 'text-right')}>Осталось</th>
          <th className={cn(thClass, 'text-right')}>Заморозки</th>
          <th className={thClass}>
            <span className="sr-only">Действия</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.studentId}
            className={cn(
              '[&:last-child>td]:border-0',
              r.left !== null && r.left <= 2 && 'bg-accent',
            )}
          >
            <td className={tdClass}>
              <Link
                to="/admin/students/$studentId"
                params={{ studentId: r.studentId }}
                className="font-extrabold text-ink"
              >
                {r.fullName}
              </Link>
              {r.caption && <div className="text-xs font-bold text-ink-muted">{r.caption}</div>}
            </td>
            <td className={cn(tdClass, 'whitespace-nowrap')}>{shortDate(r.startDate)}</td>
            <td className={cn(tdClass, numClass, leftClass(r))}>{leftText(r)}</td>
            <td className={cn(tdClass, numClass)}>{r.freezes}</td>
            <td className={tdClass}>
              <div className="flex items-center justify-end gap-2">
                <Link
                  to="/admin/students/$studentId"
                  params={{ studentId: r.studentId }}
                  className="text-xs font-extrabold whitespace-nowrap text-teal"
                  aria-label={`Открыть: ${r.fullName}`}
                >
                  Открыть
                </Link>
                <EnrollmentMenu
                  label={r.fullName}
                  onAction={(a) => {
                    onAction(r, a)
                  }}
                />
              </div>
            </td>
          </tr>
        ))}
        {children}
      </tbody>
    </table>
  )
}

function MembersList({
  rows,
  onAction,
}: {
  rows: MemberRow[]
  onAction: (row: MemberRow, action: ExitAction) => void
}) {
  return (
    <ul aria-label="Ученики группы">
      {rows.map((r) => (
        <li
          key={r.studentId}
          className={cn(
            'flex items-center border-b border-line pr-1 last:border-0',
            r.left !== null && r.left <= 2 && 'bg-accent',
          )}
        >
          <Link
            to="/admin/students/$studentId"
            params={{ studentId: r.studentId }}
            className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4"
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-extrabold text-ink">{r.fullName}</span>
              <span className="text-xs font-bold text-ink-muted">
                {[r.caption, `с ${shortDate(r.startDate)}`, `заморозки ${r.freezes}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            <span className={cn('text-sm whitespace-nowrap tabular-nums', leftClass(r))}>
              {leftText(r)}
            </span>
          </Link>
          <EnrollmentMenu
            label={r.fullName}
            onAction={(a) => {
              onAction(r, a)
            }}
          />
        </li>
      ))}
    </ul>
  )
}

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]
const shortDate = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1] ?? ''}`

const TONE_CLASS: Record<LessonTone, string> = {
  planned: 'font-bold text-ink-muted',
  today: 'font-extrabold text-teal',
  unconfirmed: 'font-extrabold text-burned-strong',
  held: 'font-extrabold text-present-strong',
  late: 'font-extrabold text-warn',
  cancelled: 'font-bold text-ink-muted line-through decoration-1',
}

function LessonStatus({ v }: { v: LessonView }) {
  return (
    <span className="flex flex-col items-start gap-0.5 text-left min-[900px]:items-end min-[900px]:text-right">
      <span
        className={cn(
          'whitespace-nowrap',
          TONE_CLASS[v.tone],
          v.tone === 'cancelled' && 'no-underline',
        )}
      >
        {v.status}
      </span>
      {(v.link ?? v.substitute) && (
        <span className="text-xs font-bold whitespace-nowrap text-ink-muted">
          {[v.link, v.substitute ? `замена: ${v.substitute}` : null].filter(Boolean).join(' · ')}
        </span>
      )}
    </span>
  )
}

/** Desktop aside on «Ученики» (А4 «Занятия · октябрь»): the latest 5 lessons up to next week. */
function MonthLessons({
  views,
  today,
  onAll,
}: {
  views: LessonView[]
  today: string
  onAll: () => void
}) {
  const month = today.slice(0, 7)
  const recent = views
    .filter((v) => v.date.startsWith(month))
    .filter((v) => v.date <= today || v === views.find((x) => x.date > today))
    .slice(-5)
    .reverse()
  return (
    <section className={cn(cardClass, 'flex flex-col')} aria-label="Занятия месяца">
      <div className="flex items-center justify-between border-b border-line px-[18px] py-3.5">
        <h2 className="text-[15px] font-extrabold">Занятия</h2>
        <span className="text-xs font-bold text-ink-muted">{monthName(today).toLowerCase()}</span>
      </div>
      {recent.length === 0 ? (
        <p className="px-[18px] py-3 text-[13px] font-bold text-ink-muted">
          В этом месяце занятий нет
        </p>
      ) : (
        recent.map((v) => (
          <div
            key={v.id}
            className="flex items-center justify-between gap-3 border-b border-line px-[18px] py-2.5 text-[13px]"
          >
            <span className="font-bold whitespace-nowrap">
              {v.when}
              {v.isExtra && <ExtraBadge />}
            </span>
            <LessonStatus v={v} />
          </div>
        ))
      )}
      <button
        type="button"
        onClick={onAll}
        className="min-h-11 px-[18px] text-left text-[13px] font-extrabold text-teal"
      >
        Все занятия группы →
      </button>
    </section>
  )
}

function ExtraBadge() {
  return (
    <span className="ml-1.5 inline-block rounded-full bg-teal-soft px-2 py-0.5 text-[11px] font-extrabold text-teal-strong">
      доп.
    </span>
  )
}

function LessonsSection({
  groupId,
  views,
  today,
  pending,
  archived,
  isDesktop,
  onAction,
}: {
  groupId: string
  views: LessonView[]
  today: string
  pending: boolean
  archived: boolean
  isDesktop: boolean
  onAction: (action: 'cancel' | 'substitute' | 'extra', lessonId: string) => void
}) {
  if (pending) return <div className={cn(cardClass, 'h-64 animate-pulse')} aria-label="Загрузка" />
  const upcoming = views.filter((v) => v.date >= today)
  const past = views.filter((v) => v.date < today).reverse()
  const sections = [
    { title: 'Предстоящие', rows: upcoming, empty: 'Будущих занятий нет' },
    { title: 'Прошедшие', rows: past, empty: 'Прошедших занятий нет' },
  ]
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s) => (
        <section key={s.title} className={cn(cardClass, 'overflow-x-auto')} aria-label={s.title}>
          <div className="flex items-center justify-between border-b border-line px-[18px] py-3.5">
            <h2 className="text-[15px] font-extrabold">{s.title}</h2>
            <span className="text-xs font-bold text-ink-muted">{s.rows.length}</span>
          </div>
          {s.rows.length === 0 ? (
            <p className="px-[18px] py-3 text-[13px] font-bold text-ink-muted">{s.empty}</p>
          ) : (
            <ul aria-label={`${s.title} занятия`}>
              {s.rows.map((v) => (
                <li
                  key={v.id}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-[18px] py-2.5 text-[13px] last:border-0',
                  )}
                >
                  <span className="font-bold whitespace-nowrap">
                    {v.when}
                    {v.isExtra && <ExtraBadge />}
                  </span>
                  <div
                    className={cn(
                      'flex items-center gap-3',
                      !isDesktop && 'w-full justify-between',
                    )}
                  >
                    <LessonStatus v={v} />
                    {!archived && <LessonActions groupId={groupId} v={v} onAction={onAction} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

function LessonActions({
  groupId,
  v,
  onAction,
}: {
  groupId: string
  v: LessonView
  onAction: (action: 'cancel' | 'substitute' | 'extra', lessonId: string) => void
}) {
  const btn =
    'min-h-11 rounded-xl border-[1.5px] border-line-strong bg-card px-3 text-xs font-extrabold whitespace-nowrap min-[900px]:min-h-9'
  return (
    <span className="flex gap-1.5">
      {(v.tone === 'held' || v.tone === 'late') && (
        <Link
          to="/lessons/$lessonId"
          params={{ lessonId: v.id }}
          search={fromAdminGroup(groupId, 'lessons')}
          className={cn(btn, 'inline-flex items-center text-ink')}
          aria-label={`Отметки: ${v.when}`}
        >
          Отметки
        </Link>
      )}
      {(v.tone === 'planned' || v.tone === 'today') && (
        // #84: the roster of a planned lesson — «Предупредил о пропуске» before it starts
        <Link
          to="/lessons/$lessonId"
          params={{ lessonId: v.id }}
          search={fromAdminGroup(groupId, 'lessons')}
          className={cn(btn, 'inline-flex items-center text-ink')}
          aria-label={`Ученики: ${v.when}`}
        >
          Ученики
        </Link>
      )}
      {v.canCancel && (
        <>
          <button
            type="button"
            className={cn(btn, 'text-ink')}
            aria-label={`Замена: ${v.when}`}
            onClick={() => {
              onAction('substitute', v.id)
            }}
          >
            Замена
          </button>
          <button
            type="button"
            className={cn(btn, 'text-burned-strong')}
            aria-label={`Отменить: ${v.when}`}
            onClick={() => {
              onAction('cancel', v.id)
            }}
          >
            Отменить
          </button>
        </>
      )}
      {v.needsMakeUp && (
        <button
          type="button"
          className={cn(btn, 'border-ink bg-ink text-brand')}
          aria-label={`Доп. урок за ${v.when}`}
          onClick={() => {
            onAction('extra', v.id)
          }}
        >
          Доп. урок
        </button>
      )}
    </span>
  )
}
