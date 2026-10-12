import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, Phone, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { PageTitle } from '@/components/page'
import { balancesQuery, studentPaymentsQuery, type PaymentRow } from '@/features/payments/api'
import { availableLessons, totalDebt } from '@/features/payments/balance'
import { EnrollDialog, type EnrollStudent } from '@/features/subscriptions/enroll-dialog'
import { formatSom } from '@/features/tariffs/model'
import { cardClass, numClass, tdClass, thClass } from '@/features/tariffs/parts'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { attendanceQuery, studentsQuery, type AttendanceRecord } from './api'
import {
  ATTENDANCE_LABEL,
  displayPhone,
  enrollableGroups,
  enrollmentViews,
  firstName,
  formatDayMonth,
  formatLessonWhen,
  formatMarkedAt,
  groupLabel,
  initials,
  shortName,
  type Balance,
  type EnrollmentView,
  type GroupBrief,
  type StudentRow,
  type StudentsSource,
} from './model'
import { debtCaption } from './pay-view'
import { EnrollmentCard, MobileEnrollment } from './student-card'
import { StudentFormDialog } from './student-form-dialog'
import { PaymentsSection } from './student-payments'

interface StudentView {
  student: StudentRow
  enrollments: EnrollmentView[]
  active: EnrollmentView[]
  /** Balances of every subscription of the student (old ones too). */
  balances: Balance[]
  referrer: StudentRow | null
  groupsById: Map<string, GroupBrief>
  /** Groups the student can still join. */
  enrollable: GroupBrief[]
  enroll: EnrollStudent
}

function buildView(
  data: StudentsSource,
  allBalances: readonly Balance[],
  studentId: string,
): StudentView | null {
  const student = data.students.find((s) => s.id === studentId)
  if (!student) return null
  const groupsById = new Map(data.groups.map((g) => [g.id, g]))
  const balances = new Map(allBalances.map((b) => [b.subscriptionId, b]))
  const enrollments = enrollmentViews(student, groupsById, balances)
  const own = student.enrollments.flatMap((e) =>
    e.subscriptions.flatMap((s) => balances.get(s.id) ?? []),
  )
  const active = enrollments.filter((e) => e.active)
  const activeGroupIds = new Set(active.map((e) => e.group?.id))
  return {
    student,
    enrollments,
    active,
    balances: own,
    referrer: data.students.find((s) => s.id === student.referred_by_student_id) ?? null,
    groupsById,
    enrollable: enrollableGroups(data.groups).filter((g) => !activeGroupIds.has(g.id)),
    enroll: {
      id: student.id,
      fullName: student.full_name,
      isReturning: student.is_returning,
      subscriptions: student.enrollments.flatMap((e) => e.subscriptions),
      friendsBrought: data.students.filter((s) => s.referred_by_student_id === student.id).length,
    },
  }
}

// А6 Ученик (docs/design/AdminStudent.dc.html), phone — АМ2 (AdminMobileStudent.dc.html).
// Money: balances from v_student_balance (features/payments), «Платежи» from payments.
export function StudentPage({ studentId }: { studentId: string }) {
  const isDesktop = useIsDesktop()
  const now = useNow()
  const today = bishkekDate(now)
  const students = useQuery(studentsQuery())
  const balances = useQuery(balancesQuery())
  const attendance = useQuery(attendanceQuery(studentId))
  const paymentsQuery = useQuery(studentPaymentsQuery(studentId))
  const query = {
    isPending: students.isPending || balances.isPending,
    isError: students.isError || balances.isError,
    data: students.data,
  }
  const view = useMemo(
    () =>
      students.data && balances.data ? buildView(students.data, balances.data, studentId) : null,
    [students.data, balances.data, studentId],
  )
  const [editing, setEditing] = useState(false)
  const [enrolling, setEnrolling] = useState(false)

  if (query.isPending) {
    return <div className={cn(cardClass, 'h-64 animate-pulse')} aria-label="Загрузка" />
  }
  if (query.isError) {
    return (
      <p role="alert" className={cn(cardClass, 'p-5 font-bold text-burned')}>
        Не удалось загрузить ученика. Проверьте интернет и обновите страницу.
      </p>
    )
  }
  if (!view) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <p className={cn(cardClass, 'p-5 font-bold text-ink-muted')}>Ученик не найден</p>
      </div>
    )
  }

  const actions = {
    onEdit: () => {
      setEditing(true)
    },
    onEnroll: () => {
      setEnrolling(true)
    },
  }
  const records = attendance.data ?? []
  const payments = {
    payments: paymentsQuery.data ?? [],
    paymentsState: paymentsQuery.isError
      ? ('error' as const)
      : paymentsQuery.isPending
        ? ('pending' as const)
        : ('ready' as const),
  }

  return (
    <>
      {isDesktop ? (
        <DesktopStudent view={view} today={today} records={records} {...payments} {...actions} />
      ) : (
        <MobileStudent view={view} today={today} records={records} {...payments} {...actions} />
      )}
      {editing && (
        <StudentFormDialog
          open={editing}
          onOpenChange={setEditing}
          student={view.student}
          students={students.data?.students ?? []}
        />
      )}
      {enrolling && (
        <EnrollDialog
          open={enrolling}
          onOpenChange={setEnrolling}
          student={view.enroll}
          groups={view.enrollable}
          today={today}
        />
      )}
    </>
  )
}

interface ScreenProps {
  view: StudentView
  today: string
  records: AttendanceRecord[]
  payments: PaymentRow[]
  paymentsState: 'pending' | 'error' | 'ready'
  onEdit: () => void
  onEnroll: () => void
}

function headerCaption(view: StudentView): string {
  const s = view.student
  const since = view.enrollments.map((e) => e.startDate).sort()[0]
  return [
    s.grade ? `${s.grade} класс` : null,
    s.parent_name ? `родитель ${s.parent_name}` : null,
    displayPhone(s.parent_phone),
    since ? `с нами с ${formatDayMonth(since)}` : null,
    view.referrer ? `привёл ${shortName(view.referrer.full_name)}` : null,
    s.is_returning ? 'бывший ученик' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function groupName(view: StudentView, groupId: string): string | null {
  const g = view.groupsById.get(groupId)
  return g ? groupLabel(g) : null
}

function BackLink() {
  return (
    <Link
      to="/admin/students"
      className="flex min-h-8 items-center gap-1.5 text-[13px] font-extrabold text-ink-muted"
    >
      <ChevronLeft className="size-4" strokeWidth={2.5} aria-hidden />
      Ученики
    </Link>
  )
}

const outlineButton =
  'flex min-h-11 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-card px-4 text-[13px] font-extrabold whitespace-nowrap text-ink'
const primaryButton =
  'flex min-h-11 items-center justify-center rounded-xl bg-ink px-4 text-[13px] font-extrabold whitespace-nowrap text-brand'

// ─── Desktop (А6) ───────────────────────────────────────────────────────────

function DesktopStudent({
  view,
  today,
  records,
  payments,
  paymentsState,
  onEdit,
  onEnroll,
}: ScreenProps) {
  const s = view.student
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand font-display text-xl font-extrabold">
            {initials(s.full_name)}
          </div>
          <div className="flex flex-col gap-1.5">
            <BackLink />
            <PageTitle className="min-[900px]:text-[28px]">{s.full_name}</PageTitle>
            <p className="text-sm font-bold text-ink-muted">{headerCaption(view)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={onEdit} className={outlineButton}>
            Изменить
          </button>
          <button
            type="button"
            onClick={onEnroll}
            disabled={view.enrollable.length === 0}
            className={cn(outlineButton, 'disabled:opacity-50')}
          >
            + Зачислить в группу
          </button>
          <Link to="/admin/payments" search={{ student: s.id }} className={primaryButton}>
            Записать оплату
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)] items-start gap-6">
        <div className="flex flex-col gap-4">
          {view.active.length === 0 ? (
            <NotEnrolled onEnroll={onEnroll} />
          ) : (
            view.active.map((e) => <EnrollmentCard key={e.enrollmentId} e={e} today={today} />)
          )}
          <AttendanceTable view={view} records={records} />
        </div>
        <aside className="flex flex-col gap-3.5">
          <PaymentsSection
            studentId={s.id}
            payments={payments}
            state={paymentsState}
            groupNameOf={(id) => (view.enrollments.length > 1 ? groupName(view, id) : null)}
          />
          <Totals view={view} records={records} />
          <Notes notes={s.notes} />
        </aside>
      </div>
    </div>
  )
}

function NotEnrolled({ onEnroll }: { onEnroll: () => void }) {
  return (
    <section
      className={cn(
        cardClass,
        'flex flex-col items-start gap-3 border-dashed border-line-strong px-[22px] py-5',
      )}
    >
      <div>
        <h2 className="text-base font-extrabold">Ещё не зачислен в группу</h2>
        <p className="text-xs font-bold text-ink-muted">
          Абонемент создаётся при зачислении — по тарифу группы на дату начала.
        </p>
      </div>
      <button type="button" onClick={onEnroll} className={primaryButton}>
        + Зачислить в группу
      </button>
    </section>
  )
}

function markClass(status: AttendanceRecord['status']) {
  if (status === 'present') return 'text-present-strong'
  if (status === 'absent_frozen') return 'text-teal-strong'
  return 'text-burned-strong'
}

const EMPTY_ATTENDANCE = 'Занятий ещё не было'

function AttendanceTable({ view, records }: { view: StudentView; records: AttendanceRecord[] }) {
  const used = records.filter((r) => r.consumes_credit).length
  return (
    <section aria-label="Посещаемость" className={cn(cardClass, 'overflow-x-auto')}>
      <div className="flex items-center justify-between border-b border-line px-[18px] py-3.5">
        <h2 className="text-[15px] font-extrabold">Посещаемость</h2>
        <span className="text-xs font-bold text-ink-muted">все занятия</span>
      </div>
      {records.length === 0 ? (
        <p className="px-[18px] py-6 text-center text-sm font-bold text-ink-muted">
          {EMPTY_ATTENDANCE}
        </p>
      ) : (
        <>
          <table className="w-full min-w-[520px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={thClass}>Дата</th>
                <th className={thClass}>Группа</th>
                <th className={thClass}>Отметка</th>
                <th className={thClass}>Кто отметил</th>
                <th className={cn(thClass, 'text-right')}>Списано</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const g = view.groupsById.get(r.lesson.group_id)
                return (
                  <tr key={r.id}>
                    <td className={cn(tdClass, 'whitespace-nowrap')}>
                      {formatLessonWhen(r.lesson.lesson_date, r.lesson.planned_start)}
                    </td>
                    <td className={tdClass}>{g ? groupLabel(g) : '—'}</td>
                    <td className={tdClass}>
                      <span className={cn('font-extrabold', markClass(r.status))}>
                        {ATTENDANCE_LABEL[r.status]}
                      </span>
                      {r.status === 'absent_burned' && (
                        <span className="text-ink-muted"> · сгорел</span>
                      )}
                    </td>
                    <td className={cn(tdClass, 'text-ink-muted')}>
                      {[r.markedByName, formatMarkedAt(r.marked_at, r.lesson.lesson_date)]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                    <td className={cn(tdClass, numClass)}>{r.consumes_credit ? 1 : 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="px-[18px] py-2.5 text-xs font-bold text-ink-muted">
            Списано уроков: {used} из {records.length} отметок
          </p>
        </>
      )}
    </section>
  )
}

function Totals({ view, records }: { view: StudentView; records: AttendanceRecord[] }) {
  const paid = view.balances.reduce((n, b) => n + b.paidSom, 0)
  const debt = totalDebt(view.balances)
  const rows: [string, ReactNode][] = [
    ['Групп', view.active.length],
    ['Посещений', records.filter((r) => r.status === 'present').length],
    ['Использовано уроков', records.filter((r) => r.consumes_credit).length],
    ['Заморозок', records.filter((r) => r.status === 'absent_frozen').length],
    ['Оплачено всего', formatSom(paid)],
    [
      'Долг',
      debt.lessons > 0 ? (
        <span className={debtOnDark(debt.lessons)}>{debtCaption(debt.lessons, debt.som)}</span>
      ) : (
        'нет'
      ),
    ],
  ]
  return (
    <section className="flex flex-col gap-2.5 rounded-[20px] bg-ink px-[18px] py-4 text-paper">
      <h2 className="text-xs font-extrabold tracking-[0.06em] text-brand uppercase">
        Итого по ученику
      </h2>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 text-[13px] font-bold">
          <span className="opacity-75">{label}</span>
          <span className="text-right">{value}</span>
        </div>
      ))}
    </section>
  )
}

/** Light tints on the dark card; the text («долг …») carries the meaning, the tint the severity. */
const debtOnDark = (lessons: number) =>
  lessons > 3 ? 'font-extrabold text-burned-soft' : 'font-extrabold text-warn-soft'

function Notes({ notes }: { notes: string | null }) {
  return (
    <section aria-label="Заметки" className={cn(cardClass, 'flex flex-col gap-2 px-[18px] py-4')}>
      <h2 className="text-[15px] font-extrabold">Заметки</h2>
      <p className="text-[13px] leading-normal font-bold whitespace-pre-line text-ink-muted">
        {notes ?? 'Заметок нет'}
      </p>
    </section>
  )
}

// ─── Phone (АМ2) ────────────────────────────────────────────────────────────

function MobileStudent({
  view,
  today,
  records,
  payments,
  paymentsState,
  onEdit,
  onEnroll,
}: ScreenProps) {
  const s = view.student
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const first = view.active[0]
  const debt = totalDebt(view.balances)
  const available = view.active.reduce(
    (n, e) => n + (e.balance ? Math.max(0, availableLessons(e.balance)) : 0),
    0,
  )
  const freezes = first?.balance
    ? `${first.balance.freezesUsed} / ${first.balance.freezeLimit}`
    : '—'
  const caption = [
    s.grade ? `${s.grade} класс` : null,
    first?.groupLabel,
    first?.group?.teacher ? firstName(first.group.teacher.full_name) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const phone = displayPhone(s.parent_phone)

  return (
    <div className="flex flex-col gap-2.5 pb-24">
      <div className="flex items-center gap-2.5">
        <Link
          to="/admin/students"
          aria-label="Назад"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-card"
        >
          <ChevronLeft className="size-[22px]" strokeWidth={2.5} aria-hidden />
        </Link>
        <form
          role="search"
          className="flex min-h-11 flex-1 items-center gap-2 rounded-[14px] border-[1.5px] border-line-strong bg-card px-3.5 focus-within:border-ink"
          onSubmit={(e) => {
            e.preventDefault()
            void navigate({ to: '/admin/students', search: { q: q.trim() || undefined } })
          }}
        >
          <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={2.5} aria-hidden />
          <input
            type="search"
            aria-label="Поиск ученика"
            placeholder="Найти ученика"
            className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:font-semibold placeholder:text-placeholder"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
            }}
          />
        </form>
      </div>

      <section className="mt-1.5 flex flex-col gap-3 rounded-[22px] bg-ink p-[18px] text-paper">
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand font-display text-sm font-extrabold text-ink">
            {initials(s.full_name)}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="font-display text-lg leading-tight font-bold">{s.full_name}</h1>
            {caption && <p className="text-xs font-bold opacity-70">{caption}</p>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {debt.lessons > 0 ? (
            <>
              <DarkTile value={`−${debt.lessons}`} label="уроков в долг" accent />
              <DarkTile value={formatSom(debt.som)} label="сом долг" />
            </>
          ) : (
            <>
              <DarkTile
                value={view.active.length ? available : '—'}
                label="доступно уроков"
                accent
              />
              <DarkTile value={freezes} label="заморозок" />
            </>
          )}
          <DarkTile
            value={records.filter((r) => r.status === 'present').length}
            label="посещений"
          />
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="flex min-h-11 items-center justify-center rounded-xl border border-paper/30 px-3 text-[13px] font-extrabold text-paper"
        >
          Изменить
        </button>
        {phone ? (
          <a
            href={`tel:${phone.replace(/\s/g, '')}`}
            className="flex min-h-11 items-center justify-between rounded-xl bg-paper/8 px-3 py-2.5 text-[13px] font-bold text-paper"
          >
            <span>
              Родитель{s.parent_name ? ` · ${s.parent_name}` : ''} · {phone}
            </span>
            <Phone className="size-[18px] text-brand" strokeWidth={2.4} aria-hidden />
          </a>
        ) : (
          <p className="rounded-xl bg-paper/8 px-3 py-2.5 text-[13px] font-bold opacity-70">
            Телефон родителя не указан
          </p>
        )}
      </section>

      {view.active.length === 0 ? (
        <section
          className={cn(
            cardClass,
            'rounded-[18px] border-dashed border-line-strong px-4 py-3.5 text-sm font-bold text-ink-muted',
          )}
        >
          Ещё не зачислен в группу — абонемент создаётся при зачислении.
        </section>
      ) : (
        view.active.map((e) => <MobileEnrollment key={e.enrollmentId} e={e} today={today} />)
      )}

      <PaymentsSection
        studentId={s.id}
        payments={payments}
        state={paymentsState}
        groupNameOf={(id) => (view.enrollments.length > 1 ? groupName(view, id) : null)}
      />

      <section aria-label="Посещаемость" className={cn(cardClass, 'flex flex-col rounded-[18px]')}>
        <h2 className="border-b border-line px-4 py-3 text-sm font-extrabold">Посещаемость</h2>
        {records.length === 0 ? (
          <p className="px-4 py-5 text-center text-[13px] font-bold text-ink-muted">
            {EMPTY_ATTENDANCE}
          </p>
        ) : (
          <ul>
            {records.map((r) => (
              <li
                key={r.id}
                className="flex justify-between gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0"
              >
                <span className="font-bold">
                  {formatLessonWhen(r.lesson.lesson_date, r.lesson.planned_start)}
                </span>
                <span className={cn('font-extrabold', markClass(r.status))}>
                  {ATTENDANCE_LABEL[r.status]}
                  {r.status === 'absent_burned' && ' · сгорел'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {s.notes && <Notes notes={s.notes} />}

      <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2.5 border-t border-line bg-card px-5 pt-3 pb-[max(1.875rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onEnroll}
          disabled={view.enrollable.length === 0}
          className="flex min-h-[52px] flex-1 items-center justify-center rounded-2xl border-[1.5px] border-ink text-sm font-extrabold text-ink disabled:opacity-50"
        >
          Зачислить в группу
        </button>
        <Link
          to="/admin/payments"
          search={{ student: s.id }}
          className="flex min-h-[52px] flex-[1.5] items-center justify-center rounded-2xl bg-ink text-sm font-extrabold text-brand"
        >
          Записать оплату
        </Link>
      </div>
    </div>
  )
}

function DarkTile({ value, label, accent }: { value: ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-px rounded-xl bg-paper/8 p-2.5">
      <div className={cn('font-display text-base font-bold', accent && 'text-brand')}>{value}</div>
      <div className="text-[11px] font-bold opacity-65">{label}</div>
    </div>
  )
}
