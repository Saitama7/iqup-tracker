// А7 «Оплаты» (docs/design/AdminPayments.dc.html; phone — АМ3 AdminMobilePayment.dc.html).
// Journal of payments and refunds of a month (filters: month / method / group), totals by group and
// teacher (Г4) on their own tabs, the panel «Записать оплату» (on the current subscription or a new
// one — В5, В7.1, И37) and «Возврат» (В8). Desktop: the panel sits to the right of the journal;
// phone: «Записать» is the first tab (the tab bar's «Оплата»).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useId, useMemo, useState, type ReactNode, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { DateInput } from '@/components/ui/date-picker'
import { PageHeader, PageTitle } from '@/components/page'
import { TEACHER_GROUPS_KEY } from '@/features/groups/teacher-api'
import { STUDENTS_KEY, studentsQuery } from '@/features/students/api'
import {
  firstName,
  groupLabel,
  type StudentRow,
  type StudentsSource,
} from '@/features/students/model'
import { NativeSelect } from '@/features/students/parts'
import { tariffsQuery } from '@/features/subscriptions/api'
import {
  DISCOUNTS,
  defaultDiscount,
  discountAvailability,
  quoteSubscription,
  type DiscountPct,
} from '@/features/subscriptions/model'
import {
  cardClass,
  ErrorText,
  Field,
  inputClass,
  labelClass,
  numClass,
  SubmitButton,
  tdClass,
  thClass,
} from '@/features/tariffs/parts'
import { formatSom } from '@/features/tariffs/model'
import { useSession } from '@/lib/auth'
import { useNow } from '@/lib/now'
import { bishkekDate, formatDateRu } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import {
  BALANCES_KEY,
  balancesQuery,
  PAYMENT_METHODS,
  PAYMENTS_KEY,
  paymentForm,
  paymentsQuery,
  recordPayment,
  refundForm,
  refundSubscription,
  type PaymentMethod,
  type StudentBalance,
} from './api'
import { debtOverLimit } from './balance'
import {
  amountPresets,
  balanceLine,
  filterPayments,
  journalCaption,
  journalRow,
  METHOD_BUTTON,
  METHOD_LABEL,
  monthBounds,
  monthLabel,
  monthOf,
  parseAmount,
  paymentHint,
  recentMonths,
  refundHint,
  shiftMonth,
  signedSom,
  som,
  totals,
  totalsByGroup,
  totalsByTeacher,
  type JournalRow,
  type Lookups,
  type TotalsRow,
} from './model'

export const PAYMENT_TABS = ['record', 'journal', 'groups', 'teachers'] as const
export type PaymentTab = (typeof PAYMENT_TABS)[number]

export interface PaymentsSearch {
  tab?: PaymentTab
  month?: string
  method?: PaymentMethod
  group?: string
  student?: string
}

const denseTable =
  'w-full min-w-[640px] border-collapse [&_td]:px-2.5 [&_td]:text-[13px] [&_th]:px-2.5'

const segment = (on: boolean) =>
  cn(
    'min-h-11 shrink-0 rounded-[9px] px-3 text-[13px] whitespace-nowrap',
    on ? 'bg-ink font-extrabold text-brand' : 'font-bold text-ink-muted',
  )
const segmentBar =
  'flex max-w-full overflow-x-auto rounded-xl border-[1.5px] border-line-strong bg-card p-[3px]'

export function PaymentsPage({
  search,
  onSearchChange,
}: {
  search: PaymentsSearch
  onSearchChange: (next: PaymentsSearch) => void
}) {
  const isDesktop = useIsDesktop()
  // The accountant reads А7 (Г1): no «Записать» / «Возврат» panel (И43); RLS + RPCs enforce it anyway.
  const canWrite = useSession().roles.includes('admin')
  const now = useNow()
  const today = bishkekDate(now)
  const month = search.month ?? monthOf(today)
  const { from, to } = monthBounds(month)

  const students = useQuery(studentsQuery())
  const balances = useQuery(balancesQuery())
  const payments = useQuery(paymentsQuery(from, to))

  const lookups = useMemo<Lookups>(
    () => ({
      students: new Map((students.data?.students ?? []).map((s) => [s.id, s])),
      groups: new Map(
        (students.data?.groups ?? []).map((g) => [
          g.id,
          { label: groupLabel(g), teacher: g.teacher ? firstName(g.teacher.full_name) : null },
        ]),
      ),
    }),
    [students.data],
  )
  const all = useMemo(() => payments.data ?? [], [payments.data])
  const filtered = useMemo(
    () => filterPayments(all, { method: search.method, group: search.group }),
    [all, search.method, search.group],
  )
  const sum = totals(filtered)

  // Phone: «Записать» first (АМ3); desktop: the panel is always on, «record» means the journal.
  const requested: PaymentTab = search.tab ?? (isDesktop || !canWrite ? 'journal' : 'record')
  const tab: PaymentTab = !canWrite && requested === 'record' ? 'journal' : requested
  const set = (patch: Partial<PaymentsSearch>) => {
    onSearchChange({ ...search, ...patch })
  }

  const tabs: { id: PaymentTab; label: string }[] = isDesktop
    ? [
        { id: 'journal', label: 'Журнал' },
        { id: 'groups', label: 'По группам' },
        { id: 'teachers', label: 'По учителям' },
      ]
    : [
        ...(canWrite ? [{ id: 'record' as const, label: 'Записать' }] : []),
        { id: 'journal', label: 'Журнал' },
        { id: 'groups', label: 'Итоги' },
      ]
  const shownTab: PaymentTab = isDesktop && tab === 'record' ? 'journal' : tab
  const tabBar = (
    <div role="tablist" aria-label="Оплаты" className={segmentBar}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={
            shownTab === t.id || (!isDesktop && t.id === 'groups' && tab === 'teachers')
          }
          onClick={() => {
            set({ tab: t.id })
          }}
          className={segment(
            shownTab === t.id || (!isDesktop && t.id === 'groups' && tab === 'teachers'),
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  const months = recentMonths(today)
  const current = monthOf(today)
  const previous = shiftMonth(current, -1)
  const monthBar = (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Месяц" className={segmentBar}>
        {[current, previous].map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={month === m}
            onClick={() => {
              set({ month: m === current ? undefined : m })
            }}
            className={segment(month === m)}
          >
            {monthLabel(m, today)}
          </button>
        ))}
      </div>
      <NativeSelect
        aria-label="Период"
        value={month === current || month === previous ? '' : month}
        onChange={(e) => {
          set({ month: e.target.value || undefined })
        }}
        className="w-[150px]"
      >
        <option value="">Период…</option>
        {months.slice(2).map((m) => (
          <option key={m} value={m}>
            {monthLabel(m, today)}
          </option>
        ))}
      </NativeSelect>
    </div>
  )

  const groupsOptions = useMemo(
    () =>
      [...(students.data?.groups ?? [])].sort((a, b) =>
        groupLabel(a).localeCompare(groupLabel(b), 'ru'),
      ),
    [students.data],
  )
  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Способ" className={segmentBar}>
        {([undefined, ...PAYMENT_METHODS] as const).map((m) => (
          <button
            key={m ?? 'all'}
            type="button"
            aria-pressed={search.method === m}
            onClick={() => {
              set({ method: m })
            }}
            className={segment(search.method === m)}
          >
            {m ? METHOD_BUTTON[m] : 'Все способы'}
          </button>
        ))}
      </div>
      <NativeSelect
        aria-label="Группа"
        value={search.group ?? ''}
        onChange={(e) => {
          set({ group: e.target.value || undefined })
        }}
        className={isDesktop ? 'w-[260px]' : 'w-full'}
      >
        <option value="">Все группы</option>
        {groupsOptions.map((g) => (
          <option key={g.id} value={g.id}>
            {groupLabel(g)}
          </option>
        ))}
      </NativeSelect>
    </div>
  )

  const loading = payments.isPending || students.isPending
  const failed = payments.isError || students.isError
  const content = loading ? (
    <div className={cn(cardClass, 'h-64 animate-pulse')} aria-label="Загрузка" />
  ) : failed ? (
    <p role="alert" className={cn(cardClass, 'p-5 font-bold text-burned')}>
      Не удалось загрузить оплаты. Проверьте интернет и обновите страницу.
    </p>
  ) : shownTab === 'journal' ? (
    <Journal
      rows={filtered.map((p) => journalRow(p, lookups))}
      isDesktop={isDesktop}
      linkStudents={canWrite}
    />
  ) : (
    <TotalsTable
      by={shownTab === 'teachers' ? 'teachers' : 'groups'}
      rows={
        shownTab === 'teachers'
          ? totalsByTeacher(filtered, lookups)
          : totalsByGroup(filtered, lookups)
      }
      isDesktop={isDesktop}
      onSwitch={
        isDesktop
          ? undefined
          : (by) => {
              set({ tab: by })
            }
      }
    />
  )

  const panel = canWrite && (
    <RecordPanel
      key={search.student ?? 'none'}
      source={students.data}
      balances={balances.data ?? []}
      today={today}
      initialStudent={search.student}
      isDesktop={isDesktop}
    />
  )

  const caption = journalCaption(month, today, sum)

  if (!isDesktop) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          eyebrow={tab === 'record' ? 'Деньги принимает администратор' : caption}
          title="Оплаты"
        />
        {tabBar}
        {tab === 'record' ? (
          panel
        ) : (
          <>
            {monthBar}
            <Kpis monthName={monthLabel(month, today)} sum={sum} isDesktop={false} />
            {filters}
            {content}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-extrabold tracking-[0.06em] text-ink-muted uppercase">
            {caption}
          </p>
          <PageTitle>Оплаты</PageTitle>
        </div>
        {monthBar}
      </header>
      <Kpis monthName={monthLabel(month, today)} sum={sum} isDesktop />
      <div
        className={cn(
          'grid items-start gap-6',
          canWrite ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1',
        )}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {tabBar}
            {filters}
          </div>
          {content}
        </div>
        {panel && <aside className="sticky top-6">{panel}</aside>}
      </div>
    </div>
  )
}

// ─── KPI ────────────────────────────────────────────────────────────────────

function Kpis({
  monthName,
  sum,
  isDesktop,
}: {
  monthName: string
  sum: ReturnType<typeof totals>
  isDesktop: boolean
}) {
  const card = 'rounded-2xl px-4 py-3.5'
  const label = 'text-[11px] font-extrabold tracking-[0.06em] uppercase'
  const value = 'font-display text-[22px] font-bold'
  return (
    <div className={cn('grid gap-3', isDesktop ? 'grid-cols-4' : 'grid-cols-2')}>
      <div className={cn(card, 'bg-brand')}>
        <div className={cn(label, 'opacity-70')}>Всего за {monthName.toLowerCase()}</div>
        <div className={cn(value, 'font-extrabold')} data-testid="kpi-total">
          {formatSom(sum.total)}
        </div>
      </div>
      <div className={cn(card, 'border border-line bg-card')}>
        <div className={cn(label, 'text-ink-muted')}>Наличные</div>
        <div className={value}>{formatSom(sum.cash)}</div>
      </div>
      <div className={cn(card, 'border border-line bg-card')}>
        <div className={cn(label, 'text-ink-muted')}>Mbank</div>
        <div className={value}>{formatSom(sum.mbank)}</div>
      </div>
      <div className={cn(card, 'bg-burned-soft')}>
        <div className={cn(label, 'text-burned-deep')}>Возвраты</div>
        <div className={cn(value, 'text-burned-deep')}>
          {sum.refunds ? signedSom(sum.refunds) : '—'}
        </div>
      </div>
    </div>
  )
}

// ─── Journal ────────────────────────────────────────────────────────────────

function Journal({
  rows,
  isDesktop,
  linkStudents,
}: {
  rows: JournalRow[]
  isDesktop: boolean
  /** А6 is admin-only: the accountant gets plain names (И43). */
  linkStudents: boolean
}) {
  const name = (r: JournalRow, className: string) =>
    linkStudents ? (
      <Link
        to="/admin/students/$studentId"
        params={{ studentId: r.studentId }}
        className={className}
      >
        {r.student}
      </Link>
    ) : (
      <span className={className}>{r.student}</span>
    )
  if (rows.length === 0) {
    return (
      <p className={cn(cardClass, 'p-5 text-center font-bold text-ink-muted')}>
        За этот месяц оплат нет.
      </p>
    )
  }
  if (!isDesktop) {
    return (
      <ul aria-label="Журнал оплат" className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <li
            key={r.id}
            className={cn(
              cardClass,
              'flex items-start justify-between gap-3 p-4',
              r.refund && 'bg-burned-tint',
            )}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              {name(r, 'font-extrabold text-ink')}
              <span className="text-[13px] font-bold text-ink-muted">{r.caption}</span>
              <span className="text-xs font-bold text-ink-muted">
                {r.date} · {r.package} · {r.method} · {r.author}
              </span>
            </div>
            <span
              className={cn(
                'font-display text-base font-bold whitespace-nowrap',
                r.refund && 'text-burned-strong',
              )}
            >
              {signedSom(r.amount)}
            </span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <section className={cn(cardClass, 'overflow-x-auto')}>
      <table className={denseTable} aria-label="Журнал оплат">
        <thead>
          <tr>
            <th className={thClass}>Дата</th>
            <th className={thClass}>Ученик · группа</th>
            <th className={thClass}>Абонемент</th>
            <th className={thClass}>Способ</th>
            <th className={cn(thClass, 'text-right')}>Сумма</th>
            <th className={thClass}>Записал</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={cn('[&:last-child>td]:border-0', r.refund && 'bg-burned-tint')}
            >
              <td className={cn(tdClass, 'whitespace-nowrap')}>{r.date}</td>
              <td className={tdClass}>
                {name(r, 'font-extrabold whitespace-nowrap text-ink')}
                <div className="font-bold text-ink-muted">{r.caption}</div>
              </td>
              <td className={cn(tdClass, 'whitespace-nowrap')}>{r.package}</td>
              <td className={tdClass}>{r.method}</td>
              <td
                className={cn(
                  tdClass,
                  numClass,
                  'font-extrabold',
                  r.refund && 'text-burned-strong',
                )}
              >
                {signedSom(r.amount)}
              </td>
              <td className={cn(tdClass, 'text-ink-muted')}>{r.author}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ─── Totals (Г4) ────────────────────────────────────────────────────────────

function TotalsTable({
  by,
  rows,
  isDesktop,
  onSwitch,
}: {
  by: 'groups' | 'teachers'
  rows: TotalsRow[]
  isDesktop: boolean
  onSwitch?: (by: 'groups' | 'teachers') => void
}) {
  const sum = rows.reduce(
    (t, r) => ({
      cash: t.cash + r.cash,
      mbank: t.mbank + r.mbank,
      refunds: t.refunds + r.refunds,
      net: t.net + r.net,
    }),
    { cash: 0, mbank: 0, refunds: 0, net: 0 },
  )
  const dash = (n: number) => (n ? signedSom(n) : '—')
  const switcher = onSwitch && (
    <div role="group" aria-label="Итоги" className={segmentBar}>
      {(['groups', 'teachers'] as const).map((b) => (
        <button
          key={b}
          type="button"
          aria-pressed={by === b}
          onClick={() => {
            onSwitch(b)
          }}
          className={cn(segment(by === b), 'flex-1')}
        >
          {b === 'groups' ? 'По группам' : 'По учителям'}
        </button>
      ))}
    </div>
  )
  if (rows.length === 0) {
    return (
      <>
        {switcher}
        <p className={cn(cardClass, 'p-5 text-center font-bold text-ink-muted')}>
          За этот месяц оплат нет.
        </p>
      </>
    )
  }
  if (!isDesktop) {
    return (
      <>
        {switcher}
        <ul
          aria-label={by === 'groups' ? 'Итоги по группам' : 'Итоги по учителям'}
          className="flex flex-col gap-2.5"
        >
          {rows.map((r) => (
            <li key={r.key} className={cn(cardClass, 'flex flex-col gap-1 p-4')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-extrabold">{r.label}</span>
                  <span className="text-[13px] font-bold text-ink-muted">{r.sub}</span>
                </div>
                <span className="font-display text-base font-bold whitespace-nowrap">
                  {formatSom(r.net)}
                </span>
              </div>
              <span className="text-xs font-bold text-ink-muted">
                наличные {formatSom(r.cash)} · Mbank {formatSom(r.mbank)}
                {r.refunds ? ` · возвраты ${signedSom(r.refunds)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </>
    )
  }
  return (
    <section className={cn(cardClass, 'overflow-x-auto')}>
      <table
        className={denseTable}
        aria-label={by === 'groups' ? 'Итоги по группам' : 'Итоги по учителям'}
      >
        <thead>
          <tr>
            <th className={thClass}>{by === 'groups' ? 'Группа' : 'Учитель'}</th>
            <th className={thClass}>{by === 'groups' ? 'Учитель' : 'Групп'}</th>
            <th className={cn(thClass, 'text-right')}>Платежей</th>
            <th className={cn(thClass, 'text-right')}>Абонементов</th>
            <th className={cn(thClass, 'text-right')}>Наличные</th>
            <th className={cn(thClass, 'text-right')}>Mbank</th>
            <th className={cn(thClass, 'text-right')}>Возвраты</th>
            <th className={cn(thClass, 'text-right')}>Итого</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className={cn(tdClass, 'font-extrabold whitespace-nowrap')}>{r.label}</td>
              <td className={cn(tdClass, 'text-ink-muted')}>{r.sub}</td>
              <td className={cn(tdClass, numClass)}>{r.payments}</td>
              <td className={cn(tdClass, numClass)}>{r.subscriptions}</td>
              <td className={cn(tdClass, numClass)}>{dash(r.cash)}</td>
              <td className={cn(tdClass, numClass)}>{dash(r.mbank)}</td>
              <td className={cn(tdClass, numClass, r.refunds && 'text-burned-strong')}>
                {dash(r.refunds)}
              </td>
              <td className={cn(tdClass, numClass, 'font-extrabold')}>{formatSom(r.net)}</td>
            </tr>
          ))}
          <tr className="[&>td]:border-0">
            <td className={cn(tdClass, 'font-extrabold')} colSpan={4}>
              Итого
            </td>
            <td className={cn(tdClass, numClass, 'font-extrabold')}>{dash(sum.cash)}</td>
            <td className={cn(tdClass, numClass, 'font-extrabold')}>{dash(sum.mbank)}</td>
            <td
              className={cn(
                tdClass,
                numClass,
                'font-extrabold',
                sum.refunds && 'text-burned-strong',
              )}
            >
              {dash(sum.refunds)}
            </td>
            <td className={cn(tdClass, numClass, 'font-extrabold')}>{formatSom(sum.net)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

// ─── «Записать оплату» / «Возврат» ──────────────────────────────────────────

type Target = { kind: 'current'; subscriptionId: string } | { kind: 'new'; enrollmentId: string }

interface EnrollmentChoice {
  enrollmentId: string
  groupId: string
  label: string
  groupType: StudentsSource['groups'][number]['group_type']
  current: StudentBalance | null
}

function choicesOf(
  student: StudentRow | undefined,
  source: StudentsSource | undefined,
  balances: readonly StudentBalance[],
): EnrollmentChoice[] {
  if (!student || !source) return []
  return student.enrollments
    .filter((e) => e.status === 'active')
    .flatMap((e) => {
      const g = source.groups.find((x) => x.id === e.group_id)
      if (!g) return []
      const current =
        balances.find((b) => b.studentId === student.id && b.groupId === g.id && b.isCurrent) ??
        null
      return [
        {
          enrollmentId: e.id,
          groupId: g.id,
          label: groupLabel(g),
          groupType: g.group_type,
          current,
        },
      ]
    })
}

/** Default: pay the rest of a partly paid current subscription, else a new one. */
const defaultTarget = (c: EnrollmentChoice): Target =>
  c.current && c.current.paidLessons < c.current.lessonsTotal
    ? { kind: 'current', subscriptionId: c.current.subscriptionId }
    : { kind: 'new', enrollmentId: c.enrollmentId }

const targetValue = (t: Target) =>
  t.kind === 'current' ? `cur:${t.subscriptionId}` : `new:${t.enrollmentId}`

function RecordPanel({
  source,
  balances,
  today,
  initialStudent,
  isDesktop,
}: {
  source: StudentsSource | undefined
  balances: readonly StudentBalance[]
  today: string
  initialStudent: string | undefined
  isDesktop: boolean
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const tariffs = useQuery(tariffsQuery())
  const [studentId, setStudentId] = useState(initialStudent ?? '')
  const [picked, setTarget] = useState<Target | null>(null)
  const [amount, setAmount] = useState('')
  const [pickedDiscount, setDiscount] = useState<DiscountPct | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [paidOn, setPaidOn] = useState(formatDateRu(today))
  const [comment, setComment] = useState('')
  const [refund, setRefund] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const students = useMemo(
    () =>
      (source?.students ?? [])
        .filter((s) => s.enrollments.some((e) => e.status === 'active'))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru')),
    [source],
  )
  const student = students.find((s) => s.id === studentId)
  const choices = useMemo(() => choicesOf(student, source, balances), [student, source, balances])

  const history = useMemo(
    () =>
      student
        ? {
            isReturning: student.is_returning,
            subscriptions: student.enrollments.flatMap((e) => e.subscriptions),
            friendsBrought: (source?.students ?? []).filter(
              (s) => s.referred_by_student_id === student.id,
            ).length,
          }
        : null,
    [student, source],
  )
  const availability = history ? discountAvailability(history) : []

  // the first enrollment until the admin picks another; the discount the student is entitled to
  const first = choices[0]
  const target = picked ?? (first ? defaultTarget(first) : null)
  const discount = pickedDiscount ?? (history ? defaultDiscount(history) : 0)
  const choice =
    target &&
    choices.find((c) =>
      target.kind === 'new'
        ? c.enrollmentId === target.enrollmentId
        : c.current?.subscriptionId === target.subscriptionId,
    )
  const current = choice?.current ?? null

  const quote =
    choice && tariffs.data
      ? quoteSubscription(
          choice.groupType,
          today,
          tariffs.data,
          target.kind === 'new' ? discount : 0,
        )
      : null

  const reset = () => {
    setAmount('')
    setComment('')
    setRefund(false)
    setError(null)
    setTarget(null)
    setDiscount(null)
  }

  const onDone = async (text: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [PAYMENTS_KEY] }),
      queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] }),
      queryClient.invalidateQueries({ queryKey: STUDENTS_KEY }),
      queryClient.invalidateQueries({ queryKey: [TEACHER_GROUPS_KEY] }),
    ])
    toast.success(text)
    reset()
  }

  const pay = useMutation({
    mutationFn: recordPayment,
    onSuccess: async (_, input) => {
      await onDone(`Оплата записана: ${student?.full_name ?? 'ученик'} · ${som(input.amount)}`)
    },
    onError: (e) => {
      setError(e.message)
    },
  })
  const back = useMutation({
    mutationFn: refundSubscription,
    onSuccess: async (_, input) => {
      await onDone(`Возврат оформлен: ${student?.full_name ?? 'ученик'} · ${som(input.amount)}`)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!student) {
      setError('Выберите ученика')
      return
    }
    if (!target) {
      setError('Выберите группу')
      return
    }
    if (refund) {
      if (!current) return
      const parsed = refundForm(today, current.paidSom).safeParse({
        subscriptionId: current.subscriptionId,
        amount,
        method,
        paidOn,
        reason: comment,
      })
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
        return
      }
      setError(null)
      back.mutate(parsed.data)
      return
    }
    const parsed = paymentForm(today).safeParse(
      target.kind === 'current'
        ? {
            target: 'current',
            subscriptionId: target.subscriptionId,
            amount,
            method,
            paidOn,
            comment,
          }
        : {
            target: 'new',
            enrollmentId: target.enrollmentId,
            discount,
            amount,
            method,
            paidOn,
            comment,
          },
    )
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    setError(null)
    pay.mutate(parsed.data)
  }

  const value = parseAmount(amount)
  const line = current ? balanceLine(current) : null
  const presets =
    target && !refund
      ? amountPresets(target.kind, quote?.priceFinal ?? current?.priceFinal ?? 0, current)
      : []
  const hint =
    target && choice && !refund
      ? paymentHint(
          target.kind,
          value,
          target.kind === 'new'
            ? {
                lessonsTotal: quote?.lessonsTotal ?? 0,
                priceFinal: quote?.priceFinal ?? 0,
                priceFull: quote?.priceFull ?? 0,
              }
            : {
                lessonsTotal: current?.lessonsTotal ?? 0,
                priceFinal: current?.priceFinal ?? 0,
                priceFull: current?.priceFinal ?? 0,
              },
          current,
        )
      : ''
  const pending = pay.isPending || back.isPending
  const canRefund = !!current && target?.kind === 'current' && current.paidSom > 0

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={refund ? 'Возврат' : 'Записать оплату'}
      className={cn(cardClass, 'flex flex-col gap-3.5', isDesktop ? 'p-[22px]' : 'p-4')}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold">
          {refund ? 'Возврат' : 'Записать оплату'}
        </h2>
        {canRefund && (
          <button
            type="button"
            onClick={() => {
              setRefund((r) => !r)
              setAmount(refund ? '' : String(current.refundSuggested))
              setComment('')
              setError(null)
            }}
            className="min-h-11 rounded-xl px-2 text-[13px] font-extrabold text-teal"
          >
            {refund ? 'К оплате' : 'Возврат'}
          </button>
        )}
      </div>

      <Field id={`${id}-student`} label="Ученик">
        <NativeSelect
          id={`${id}-student`}
          value={studentId}
          onChange={(e) => {
            setStudentId(e.target.value)
            reset()
          }}
        >
          <option value="">Выберите ученика</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
              {s.grade ? ` · ${s.grade} класс` : ''}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {student && (
        <Field id={`${id}-target`} label={refund ? 'Группа · абонемент' : 'Что оплачивает'}>
          <NativeSelect
            id={`${id}-target`}
            value={target ? targetValue(target) : ''}
            disabled={refund}
            onChange={(e) => {
              const [kind, ref = ''] = e.target.value.split(':')
              setTarget(
                kind === 'cur'
                  ? { kind: 'current', subscriptionId: ref }
                  : { kind: 'new', enrollmentId: ref },
              )
              setDiscount(null)
              setAmount('')
              setError(null)
            }}
          >
            {choices.flatMap((c) => [
              c.current ? (
                <option
                  key={`cur:${c.current.subscriptionId}`}
                  value={`cur:${c.current.subscriptionId}`}
                >
                  {c.label} ·{' '}
                  {c.current.debtLessons > 0 || c.current.paidLessons >= c.current.lessonsTotal
                    ? 'закрыть долг / доплата'
                    : 'доплата по текущему'}
                </option>
              ) : null,
              <option key={`new:${c.enrollmentId}`} value={`new:${c.enrollmentId}`}>
                {c.label} · новый абонемент
              </option>,
            ])}
          </NativeSelect>
        </Field>
      )}

      {line && (
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 rounded-xl bg-band px-3 py-2.5 text-[13px] font-bold">
          <span className="text-ink-muted">{line.text}</span>
          <span
            className={cn(
              line.state === 'debt'
                ? current && debtOverLimit(current.debtLessons)
                  ? 'text-burned-strong'
                  : 'text-warn-strong'
                : line.state === 'soon'
                  ? 'text-warn-strong'
                  : line.state === 'partial'
                    ? 'text-teal'
                    : 'text-present-strong',
            )}
          >
            {line.note}
          </span>
        </div>
      )}

      {student && target && (
        <>
          <div
            className={cn(
              'grid gap-2.5',
              target.kind === 'new' && !refund ? 'grid-cols-2' : 'grid-cols-1',
            )}
          >
            <Field id={`${id}-amount`} label={refund ? 'Сумма возврата, сом' : 'Сумма, сом'}>
              <input
                id={`${id}-amount`}
                inputMode="numeric"
                autoComplete="off"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setError(null)
                }}
                className={cn(inputClass, 'font-display text-lg')}
              />
            </Field>
            {target.kind === 'new' && !refund && (
              <Field id={`${id}-discount`} label="Скидка">
                <NativeSelect
                  id={`${id}-discount`}
                  value={String(discount)}
                  onChange={(e) => {
                    setDiscount(Number(e.target.value) as DiscountPct)
                    setAmount('')
                  }}
                >
                  {DISCOUNTS.map((d) => {
                    const a = availability.find((x) => x.pct === d.pct)
                    return (
                      <option key={d.pct} value={d.pct} disabled={a ? !a.available : false}>
                        {d.pct === 0 ? 'Нет' : d.label}
                        {a?.hint ? ` (${a.hint})` : ''}
                      </option>
                    )
                  })}
                </NativeSelect>
              </Field>
            )}
          </div>
          {refund && current && (
            <p className="text-xs font-bold text-ink-muted">{refundHint(current)}</p>
          )}
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setAmount(String(p.amount))
                    setError(null)
                  }}
                  className={cn(
                    'min-h-11 rounded-xl border-[1.5px] px-3 text-[13px] font-extrabold',
                    value === p.amount
                      ? 'border-ink bg-ink text-brand'
                      : 'border-line-strong bg-card text-ink',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className={labelClass} id={`${id}-method`}>
              Способ
            </span>
            <div role="radiogroup" aria-labelledby={`${id}-method`} className="flex gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => {
                    setMethod(m)
                  }}
                  className={cn(
                    'min-h-11 flex-1 rounded-xl text-[13px]',
                    method === m
                      ? 'bg-ink font-extrabold text-brand'
                      : 'border-[1.5px] border-line-strong font-bold text-ink-muted',
                  )}
                >
                  {METHOD_BUTTON[m]}
                </button>
              ))}
            </div>
          </div>

          <Field id={`${id}-date`} label="Дата">
            <DateInput
              id={`${id}-date`}
              value={paidOn}
              max={today}
              onChange={setPaidOn}
              className={inputClass}
            />
          </Field>
          <Field id={`${id}-comment`} label={refund ? 'Причина возврата' : 'Комментарий'}>
            <input
              id={`${id}-comment`}
              value={comment}
              placeholder={refund ? 'обязательно' : 'необязательно'}
              onChange={(e) => {
                setComment(e.target.value)
                setError(null)
              }}
              className={inputClass}
            />
          </Field>

          {hint && (
            <p className="rounded-xl bg-present-soft px-3 py-2.5 text-xs font-bold text-present-strong">
              {hint}
            </p>
          )}
          {refund && (
            <p className="rounded-xl bg-burned-soft px-3 py-2.5 text-xs font-bold text-burned-deep">
              Абонемент закроется, зачисление в группе останется (И42). Ученик продолжает? Завершить
              зачисление —{' '}
              <Link
                to="/admin/students/$studentId"
                params={{ studentId: student.id }}
                className="underline underline-offset-2"
              >
                на А6
              </Link>
              .
            </p>
          )}
        </>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      {student && target && (
        <SubmitButton
          pending={pending}
          variant={refund ? 'danger' : 'primary'}
          className="min-h-12"
        >
          {refund
            ? `Оформить возврат ${value !== null ? som(value) : ''}`.trim()
            : `Записать ${value !== null ? som(value) : 'оплату'}${isDesktop ? '' : ` · ${METHOD_LABEL[method]}`}`}
        </SubmitButton>
      )}
      {!student && <EmptyHint>Выберите ученика — покажем его абонементы и долг.</EmptyHint>}
    </form>
  )
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-sm font-bold text-ink-muted">{children}</p>
}
