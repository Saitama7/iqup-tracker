// А1 Дашборд (docs/design/AdminDashboard.dc.html) and АМ1 «Центр сегодня» (AdminMobileToday.dc.html).
// Everything time-dependent is a pure function of (lessons, now); now = useNow() (§7.1).
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/page'
import { firstName, useDisplayName } from '@/components/shell/shell-parts'
import { monthName } from '@/features/groups/model'
import { useEnsureLessons } from '@/features/groups/use-ensure-lessons'
import { monthTotalQuery, periodQuery } from '@/features/payroll/api'
import { balancesQuery, paymentsQuery, unbilledQuery } from '@/features/payments/api'
import { monthBounds, monthOf, som } from '@/features/payments/model'
import { studentsQuery } from '@/features/students/api'
import { studentListRows } from '@/features/students/model'
import { usePendingRequests, type PendingRequest } from '@/features/lessons/corrections-api'
import { lessonState, lessonsWord } from '@/features/lessons/select'
import { formatSom } from '@/features/tariffs/model'
import { useNow } from '@/lib/now'
import { bishkekDate, formatDayLong } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import {
  adminLessonsQuery,
  adminUnconfirmedQuery,
  useAdminLessonsRealtime,
  type AdminLesson,
} from './api'
import {
  adminUnconfirmed,
  dashboardCaption,
  dashboardChip,
  dayKpi,
  dayKpiCaption,
  lessonLabel,
  mobileCaption,
  payrollCard,
  payrollMonth,
  sortByStart,
  unconfirmedLine,
  unconfirmedMore,
  unconfirmedSpread,
  WIDGET_SHOWN,
  type DayKpi,
} from './model'
import {
  CaptionWithTrials,
  TrialsWidget,
  useDashboardTrials,
  type DashboardTrials,
} from './dashboard-trials'
import { CHIP, DOT, Notice } from './parts'
import {
  debtorLine,
  debtorsMore,
  debtSummary,
  debtTileCaption,
  debtTileValue,
  DEBTORS_SHOWN,
  todayPayments,
  todayPaymentsCaption,
  type DebtSummary,
  type TodayPayments,
} from './dashboard-money'
import { PresetsWidget } from '@/features/presets/dashboard-presets'
import { CorrectionItems, CorrectionsWidget } from './dashboard-corrections'
import { UnbilledItems, UnbilledWidget, useUnbilled, type UnbilledItem } from './dashboard-unbilled'

/** А1 shows this many of today's lessons, the rest behind «ещё N занятий». */
const TODAY_SHOWN = 7

const UNCONFIRMED_SEARCH = { filter: 'unconfirmed' } as const
const UNPAID_SEARCH = { pay: 'unpaid' } as const

/** А5 rows (same as «Не оплатили») and this month's payments → the money tiles; undefined while loading. */
function useDashboardMoney(today: string) {
  const month = monthOf(today)
  const { from, to } = monthBounds(month)
  const students = useQuery(studentsQuery()).data
  const balances = useQuery(balancesQuery()).data
  const unbilled = useQuery(unbilledQuery()).data
  const payments = useQuery(paymentsQuery(from, to)).data
  const debts = useMemo(
    () =>
      students && balances ? debtSummary(studentListRows(students, balances, unbilled)) : undefined,
    [students, balances, unbilled],
  )
  const paid = useMemo(
    () => (payments ? todayPayments(payments, today) : undefined),
    [payments, today],
  )
  return { month, debts, paid }
}

function greeting(now: number): string {
  const hour = new Date(now + 6 * 3_600_000).getUTCHours()
  if (hour < 12) return 'Доброе утро'
  if (hour < 18) return 'Добрый день'
  return 'Добрый вечер'
}

export function DashboardPage() {
  const now = useNow()
  const isDesktop = useIsDesktop()
  const today = bishkekDate(now)
  const name = firstName(useDisplayName())

  useEnsureLessons(today)
  useAdminLessonsRealtime()
  const day = useQuery(adminLessonsQuery(today, today))
  const pending = useQuery(adminUnconfirmedQuery(today))
  const trials = useDashboardTrials(today)
  const requests = usePendingRequests(true)
  const unbilled = useUnbilled()
  const money = useDashboardMoney(today)

  let body: ReactNode
  if (day.isError || pending.isError) {
    body = <Notice>Не удалось загрузить занятия. Проверьте интернет — обновим сами.</Notice>
  } else if (!day.data || !pending.data) {
    body = <Notice>Загружаем занятия…</Notice>
  } else {
    const data: DashboardData = {
      lessons: sortByStart(day.data),
      kpi: dayKpi(day.data, now),
      unconfirmed: adminUnconfirmed(pending.data, now),
      today,
      now,
      trials,
      requests: requests.data ?? [],
      unbilled: unbilled.data ?? [],
      ...money,
    }
    body = isDesktop ? <DesktopDashboard {...data} /> : <MobileDashboard {...data} />
  }

  if (!isDesktop) {
    return (
      <section className="flex flex-col gap-[18px]">
        <PageHeader eyebrow={formatDayLong(now)} title="Центр сегодня" />
        {body}
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          eyebrow={formatDayLong(now)}
          title={name ? `${greeting(now)}, ${name}` : greeting(now)}
        />
        <div className="flex flex-wrap gap-2.5">
          <Link
            to="/admin/payments"
            className="flex min-h-12 items-center gap-2 rounded-[14px] bg-ink px-[18px] text-sm font-extrabold text-brand"
          >
            <Plus className="size-[18px]" strokeWidth={2.5} aria-hidden />
            Записать оплату
          </Link>
          <Link
            to="/admin/groups"
            className="flex min-h-12 items-center rounded-[14px] border-[1.5px] border-line-strong bg-card px-[18px] text-sm font-extrabold"
          >
            Новая группа
          </Link>
        </div>
      </div>
      {body}
    </section>
  )
}

interface DashboardData {
  lessons: AdminLesson[]
  kpi: DayKpi
  /** Freshest first. */
  unconfirmed: AdminLesson[]
  today: string
  now: number
  trials: DashboardTrials
  /** Teachers' requests to correct marks (#74), oldest first. */
  requests: PendingRequest[]
  /** After-school months with marks and no invoice (#82, И69). */
  unbilled: UnbilledItem[]
  month: string
  debts: DebtSummary | undefined
  paid: TodayPayments | undefined
}

// ─── А1 · desktop ───────────────────────────────────────────────────────────

const tileClass = 'flex flex-col gap-1 rounded-[18px] p-[18px]'
const tileLabel = 'text-xs font-extrabold'
const tileValue = 'font-display text-[26px] font-bold'
const tileCaption = 'text-xs font-bold'

function DesktopDashboard({
  lessons,
  kpi,
  unconfirmed,
  today,
  now,
  trials,
  requests,
  unbilled,
  month,
  debts,
  paid,
}: DashboardData) {
  const [expanded, setExpanded] = useState(false)
  const spread = unconfirmedSpread(unconfirmed)
  const shown = expanded ? lessons : lessons.slice(0, TODAY_SHOWN)
  const hidden = lessons.length - shown.length

  return (
    <>
      <div className="grid grid-cols-4 gap-3.5">
        <div className={cn(tileClass, 'border border-line bg-card')}>
          <span className={cn(tileLabel, 'text-ink-muted')}>Занятий сегодня</span>
          <span className={tileValue}>{kpi.total}</span>
          <span className={cn(tileCaption, 'text-present-strong')}>{dayKpiCaption(kpi)}</span>
        </div>
        <Link
          to="/admin/schedule"
          search={UNCONFIRMED_SEARCH}
          aria-label={`Не подтверждено: ${unconfirmed.length}`}
          className={cn(tileClass, 'bg-burned-soft text-burned-deep')}
        >
          <span className={tileLabel}>Не подтверждено</span>
          <span className={tileValue} data-testid="kpi-unconfirmed">
            {unconfirmed.length}
          </span>
          <span className={tileCaption}>
            {unconfirmed.length > 0 ? `${spread.days} · ${spread.teachers}` : 'всё отмечено'}
          </span>
        </Link>
        <Link
          to="/admin/students"
          search={UNPAID_SEARCH}
          className={cn(tileClass, 'bg-warn-soft text-warn-strong')}
        >
          <span className={tileLabel}>Долги и «пора оплачивать»</span>
          <span className={tileValue} data-testid="kpi-unpaid">
            {debts ? debtTileValue(debts) : '…'}
          </span>
          <span className={tileCaption}>{debts ? debtTileCaption(debts) : ' '}</span>
        </Link>
        <Link
          to="/admin/payments"
          search={{ tab: 'journal', month }}
          className={cn(tileClass, 'bg-brand text-ink')}
        >
          <span className={cn(tileLabel, 'opacity-70')}>Оплат сегодня</span>
          <span className={cn(tileValue, 'font-extrabold')} data-testid="kpi-paid-today">
            {paid ? som(paid.total) : '…'}
          </span>
          <span className={cn(tileCaption, 'opacity-75')}>
            {paid ? todayPaymentsCaption(paid, today) : ' '}
          </span>
        </Link>
      </div>

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)] items-start gap-6">
        <section className="flex flex-col rounded-[20px] border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-[15px] font-extrabold">Занятия сегодня · все учителя</h2>
            <Link to="/admin/schedule" className="text-[13px] font-extrabold text-teal">
              Расписание →
            </Link>
          </div>
          {lessons.length === 0 ? (
            <p className="px-5 py-4 text-sm font-bold text-ink-muted">Сегодня занятий нет.</p>
          ) : (
            <ul aria-label="Занятия сегодня">
              {shown.map((l) => (
                <DesktopRow key={l.id} lesson={l} now={now} trials={trials.byLesson} />
              ))}
            </ul>
          )}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => {
                setExpanded(true)
              }}
              className="min-h-11 px-5 py-3 text-center text-xs font-bold text-ink-muted"
            >
              ещё {lessonsWord(hidden)}
            </button>
          )}
        </section>

        <aside className="flex flex-col gap-3.5">
          <CorrectionsWidget requests={requests} />
          <UnbilledWidget items={unbilled} />
          <PresetsWidget today={today} />
          <UnconfirmedWidget unconfirmed={unconfirmed} today={today} />
          {debts && <DebtsWidget debts={debts} />}
          <TrialsWidget trials={trials} today={today} />
          <PayrollCard today={today} />
        </aside>
      </div>
    </>
  )
}

function DesktopRow({
  lesson,
  now,
  trials,
}: {
  lesson: AdminLesson
  now: number
  trials: DashboardTrials['byLesson']
}) {
  const { state, label } = dashboardChip(lesson, now)
  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        to="/admin/groups/$groupId"
        params={{ groupId: lesson.group.id }}
        className={cn(
          'flex items-center gap-3.5 px-5 py-3',
          state === 'current' && 'bg-accent',
          state === 'cancelled' && 'opacity-70',
        )}
      >
        <span className="min-w-[52px] font-display text-sm font-bold">
          {lesson.planned_start.slice(0, 5)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('text-sm font-extrabold', state === 'cancelled' && 'line-through')}>
            {lessonLabel(lesson)}
          </span>
          <span className="text-xs font-bold text-ink-muted">
            <CaptionWithTrials lesson={lesson} caption={dashboardCaption(lesson)} trials={trials} />
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full text-xs font-extrabold whitespace-nowrap',
            state !== 'upcoming' && 'px-2.5 py-[5px]',
            CHIP[state],
          )}
        >
          {label}
        </span>
      </Link>
    </li>
  )
}

function UnconfirmedWidget({ unconfirmed, today }: { unconfirmed: AdminLesson[]; today: string }) {
  const more = unconfirmedMore(unconfirmed)
  return (
    <section
      aria-label="Не подтверждено"
      className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-card px-5 py-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-extrabold">Не подтверждено</h2>
          <span className="rounded-full bg-burned-soft px-[9px] py-[3px] text-xs font-extrabold whitespace-nowrap text-burned-deep">
            {unconfirmed.length}
          </span>
        </div>
        {unconfirmed.length > 0 && (
          <Link
            to="/admin/schedule"
            search={UNCONFIRMED_SEARCH}
            className="text-[13px] font-extrabold text-teal"
          >
            Все {unconfirmed.length} →
          </Link>
        )}
      </div>
      {unconfirmed.length === 0 ? (
        <p className="text-[13px] font-bold text-ink-muted">Все занятия отмечены.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {unconfirmed.slice(0, WIDGET_SHOWN).map((l) => (
            <li key={l.id} className="flex justify-between gap-2.5 text-[13px] font-bold">
              <span>{unconfirmedLine(l, today)}</span>
              <Link
                to="/admin/groups/$groupId"
                params={{ groupId: l.group.id }}
                className="font-extrabold whitespace-nowrap text-teal"
              >
                Открыть
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <Link
          to="/admin/schedule"
          search={UNCONFIRMED_SEARCH}
          className="mt-0.5 rounded-[10px] bg-burned-soft px-2.5 py-2 text-center text-xs font-extrabold text-burned-deep"
        >
          {more}
        </Link>
      )}
      <p className="text-[11px] font-bold text-ink-muted">
        Виджет показывает 3 самых свежих. Полный список — в расписании с фильтром «не подтверждено».
      </p>
    </section>
  )
}

/** А1 «Сентябрь · ЗП»: the month being paid and its period (payrollCard, И15) and everyone's accrual from v_payroll_preview. */
function PayrollCard({ today }: { today: string }) {
  const period = useQuery(periodQuery(payrollMonth(today).month))
  const { month, status } = payrollCard(today, period.data ?? null)
  const total = useQuery(monthTotalQuery(month))
  return (
    <section className="flex flex-col gap-2 rounded-[20px] bg-ink px-5 py-4 text-paper">
      <h2 className="text-xs font-extrabold tracking-[0.06em] text-brand uppercase">
        {monthName(`${month}-01`)} · ЗП
      </h2>
      <p className="text-[13px] font-bold opacity-80" data-testid="payroll-card-status">
        {status}
      </p>
      <Link
        to="/payroll"
        search={{ month }}
        className="text-[13px] font-extrabold text-brand"
        data-testid="payroll-card-link"
      >
        Расчёт ЗП → {total.data !== undefined ? `${formatSom(total.data)} сом` : '…'}
      </Link>
    </section>
  )
}

// ─── АМ1 · phone ────────────────────────────────────────────────────────────

const mTile = 'flex flex-col rounded-2xl px-3.5 py-3'
const mLabel = 'text-[11px] font-extrabold tracking-[0.04em] uppercase'
const mValue = 'font-display text-[22px] font-bold'
const mCaption = 'text-[11px] font-bold'

function MobileDashboard({
  lessons,
  kpi,
  unconfirmed,
  today,
  now,
  trials,
  requests,
  unbilled,
  month,
  debts,
  paid,
}: DashboardData) {
  const spread = unconfirmedSpread(unconfirmed)
  const more = unconfirmed.length - WIDGET_SHOWN
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <div className={cn(mTile, 'border border-line bg-card')}>
          <span className={cn(mLabel, 'text-ink-muted')}>Занятий</span>
          <span className={mValue}>{kpi.total}</span>
          <span className={cn(mCaption, 'text-present-strong')}>
            {dayKpiCaption(kpi, { short: true })}
          </span>
        </div>
        <Link
          to="/admin/schedule"
          search={UNCONFIRMED_SEARCH}
          aria-label={`Не подтверждено: ${unconfirmed.length}`}
          className={cn(mTile, 'bg-burned-soft text-burned-deep')}
        >
          <span className={mLabel}>Не подтверждено</span>
          <span className={mValue} data-testid="kpi-unconfirmed">
            {unconfirmed.length}
          </span>
          <span className={mCaption}>
            {unconfirmed.length > 0 ? spread.teachers : 'всё отмечено'}
          </span>
        </Link>
        <Link
          to="/admin/students"
          search={UNPAID_SEARCH}
          className={cn(mTile, 'bg-warn-soft text-warn-strong')}
        >
          <span className={mLabel}>Долги</span>
          <span className={mValue} data-testid="kpi-unpaid">
            {debts ? debts.debt : '…'}
          </span>
          <span className={mCaption}>{debts ? `${formatSom(debts.debtSom)} сом` : ' '}</span>
        </Link>
        <div className={cn(mTile, 'justify-between bg-brand text-ink')}>
          <Link to="/admin/payments" search={{ tab: 'journal', month }} className="flex flex-col">
            <span className={cn(mLabel, 'opacity-70')}>Оплат сегодня</span>
            <span className={cn(mValue, 'font-extrabold')} data-testid="kpi-paid-today">
              {paid ? formatSom(paid.total) : '…'}
            </span>
          </Link>
          <Link
            to="/admin/payments"
            search={{ tab: 'record' }}
            className="flex min-h-11 items-center text-[11px] font-extrabold"
          >
            + Записать →
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-extrabold">Занятия · все учителя</h2>
          <span className="text-xs font-bold text-ink-muted">по времени</span>
        </div>
        {lessons.length === 0 ? (
          <Notice>Сегодня занятий нет.</Notice>
        ) : (
          <ul aria-label="Занятия сегодня" className="flex flex-col gap-2">
            {lessons.map((l) => (
              <MobileRow key={l.id} lesson={l} now={now} trials={trials.byLesson} />
            ))}
          </ul>
        )}

        <TrialsWidget trials={trials} today={today} compact />
        <PresetsWidget today={today} compact />

        {(unconfirmed.length > 0 ||
          requests.length > 0 ||
          unbilled.length > 0 ||
          (debts?.debtors.length ?? 0) > 0) && (
          <>
            <h2 className="pt-2 text-sm font-extrabold">Требует внимания</h2>
            <ul aria-label="Требует внимания" className="flex flex-col gap-2">
              <CorrectionItems requests={requests} />
              <UnbilledItems items={unbilled} />
              {unconfirmed.slice(0, WIDGET_SHOWN).map((l) => (
                <li key={l.id}>
                  <Link
                    to="/admin/groups/$groupId"
                    params={{ groupId: l.group.id }}
                    className="flex min-h-11 items-center gap-2.5 rounded-[14px] bg-burned-soft px-3.5 py-2.5 text-burned-deep"
                  >
                    <span className="flex-1 text-[13px] font-bold">
                      {unconfirmedLine(l, today)} — не подтверждено
                    </span>
                    <span className="text-[13px] font-extrabold" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              ))}
              {debts && <DebtorItems debtors={debts.debtors} />}
            </ul>
            {more > 0 && (
              <Link
                to="/admin/schedule"
                search={UNCONFIRMED_SEARCH}
                className="flex min-h-11 items-center justify-center rounded-[14px] bg-burned-soft px-3.5 text-xs font-extrabold text-burned-deep"
              >
                {unconfirmedMore(unconfirmed)}
              </Link>
            )}
          </>
        )}
      </div>
    </>
  )
}

const STATE_WORD = {
  held: 'проведено',
  ended_unconfirmed: 'не подтверждено',
  cancelled: 'отменено',
} as const

function MobileRow({
  lesson,
  now,
  trials,
}: {
  lesson: AdminLesson
  now: number
  trials: DashboardTrials['byLesson']
}) {
  const state = lessonState(lesson, now)
  const dot = DOT[state]
  return (
    <li>
      <Link
        to="/admin/groups/$groupId"
        params={{ groupId: lesson.group.id }}
        className={cn(
          'flex items-center gap-3 rounded-2xl bg-card',
          state === 'current'
            ? 'border-2 border-brand px-[13px] py-2.5'
            : 'border border-line px-3.5 py-[11px]',
        )}
      >
        <span className="min-w-[46px] font-display text-sm font-bold">
          {lesson.planned_start.slice(0, 5)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('text-sm font-extrabold', state === 'cancelled' && 'line-through')}>
            {lessonLabel(lesson)}
          </span>
          <span className="text-xs font-bold text-ink-muted">
            <CaptionWithTrials
              lesson={lesson}
              caption={mobileCaption(lesson, now)}
              trials={trials}
            />
          </span>
        </span>
        {state === 'current' && (
          <span className="rounded-full bg-brand px-2 py-1 text-[11px] font-extrabold whitespace-nowrap">
            Идёт
          </span>
        )}
        {state === 'upcoming' && (
          <span className="text-[11px] font-extrabold text-ink-muted">Далее</span>
        )}
        {dot && (
          <span className="flex items-center">
            <span className={cn('size-2.5 rounded-full', dot)} aria-hidden />
            <span className="sr-only">{STATE_WORD[state as keyof typeof STATE_WORD]}</span>
          </span>
        )}
      </Link>
    </li>
  )
}

/** А1 «Долги»: the biggest debts first, each opens the student; hidden when nobody owes. */
function DebtsWidget({ debts }: { debts: DebtSummary }) {
  if (debts.debtors.length === 0) return null
  const more = debtorsMore(debts.debtors)
  return (
    <section
      aria-label="Долги"
      className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-card px-5 py-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold">Долги</h2>
        <Link
          to="/admin/students"
          search={UNPAID_SEARCH}
          className="text-[13px] font-extrabold text-teal"
        >
          Все →
        </Link>
      </div>
      <ul className="flex flex-col gap-2.5">
        {debts.debtors.slice(0, DEBTORS_SHOWN).map((r) => (
          <li key={r.id} className="flex justify-between gap-2.5 text-[13px] font-bold">
            <span>{debtorLine(r)}</span>
            <Link
              to="/admin/students/$studentId"
              params={{ studentId: r.id }}
              className="font-extrabold whitespace-nowrap text-teal"
            >
              Открыть
            </Link>
          </li>
        ))}
      </ul>
      {more && (
        <Link
          to="/admin/students"
          search={UNPAID_SEARCH}
          className="mt-0.5 rounded-[10px] bg-warn-soft px-2.5 py-2 text-center text-xs font-extrabold text-warn-strong"
        >
          {more}
        </Link>
      )}
    </section>
  )
}

/** АМ1 «Требует внимания»: up to 5 debtors, then «и ещё N →» to А5 «Не оплатили». */
function DebtorItems({ debtors }: { debtors: DebtSummary['debtors'] }) {
  const more = debtorsMore(debtors)
  return (
    <>
      {debtors.slice(0, DEBTORS_SHOWN).map((r) => (
        <li key={r.id}>
          <Link
            to="/admin/students/$studentId"
            params={{ studentId: r.id }}
            className="flex min-h-11 items-center gap-2.5 rounded-[14px] bg-warn-soft px-3.5 py-2.5 text-warn-strong"
          >
            <span className="flex-1 text-[13px] font-bold">{debtorLine(r)}</span>
            <span className="text-[13px] font-extrabold" aria-hidden>
              →
            </span>
          </Link>
        </li>
      ))}
      {more && (
        <li>
          <Link
            to="/admin/students"
            search={UNPAID_SEARCH}
            className="flex min-h-11 items-center justify-center rounded-[14px] bg-warn-soft px-3.5 text-xs font-extrabold text-warn-strong"
          >
            {more}
          </Link>
        </li>
      )}
    </>
  )
}
