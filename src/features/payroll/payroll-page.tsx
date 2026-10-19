// Б1 «Расчёт ЗП» (docs/design/Payroll.dc.html) and БМ1 on the phone (AccMobilePayroll.dc.html):
// accountant and admin (И2). Totals from v_payroll_preview (0011), advances (#83), «Закрыть период»
// / «Открыть период» (#94, И77). The comparison with the old scheme is R3 — disabled with a hint.
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { MonthPickerButton } from '@/components/ui/date-picker'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'
import { Avatar } from '@/components/shell/shell-parts'
import { formatSom } from '@/features/tariffs/model'
import { useSession } from '@/lib/auth'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { payrollQuery, usePayrollRealtime } from './api'
import {
  AdvanceDialog,
  AdvancesList,
  DeleteAdvanceDialog,
  EditAdvanceDialog,
  type AdvanceTarget,
} from './advance-dialog'
import { ClosePeriodDialog, ReopenPeriodDialog } from './period-dialog'
import {
  canClosePeriod,
  hoursCaption,
  minusSom,
  monthNom,
  monthOf,
  monthTitle,
  noSubscriptionCaption,
  payday,
  payrollCaption,
  payrollView,
  periodChip,
  shiftMonth,
  som,
  STUDENT_LESSON_NOTE,
  toPayCaption,
  type Adjustment,
  type PayrollPeriod,
  type PayrollRow,
  type PayrollView,
} from './model'

const R3_HINT = 'Сверка со старой схемой появится в R3'

/** Dialog openers shared by both layouts (#83, #94). */
interface AdvanceActions {
  month: string
  /** Rows whose advances history is open. */
  open: ReadonlySet<string>
  toggle: (teacherId: string) => void
  /** Null — the month is closed. */
  issue: ((row: PayrollRow) => void) | null
  remove: ((row: PayrollRow, a: Adjustment) => void) | null
  /** Null — not the admin, or the month is closed. */
  edit: ((row: PayrollRow, a: Adjustment) => void) | null
}

/** «Закрыть период» / «Открыть период» — who may and what the button does now. */
interface PeriodActions {
  period: PayrollPeriod | null
  /** Null — the month is not over yet (closing) / not the admin (reopening). */
  close: (() => void) | null
  reopen: (() => void) | null
}

export function PayrollPage({ month }: { month: string }) {
  const now = useNow()
  const isDesktop = useIsDesktop()
  const today = bishkekDate(now)
  const navigate = useNavigate()

  usePayrollRealtime()
  const { roles } = useSession()
  const isAdmin = roles.includes('admin')
  const source = useQuery(payrollQuery(month, today))
  const period = source.data?.period ?? null
  const closed = period !== null

  const view = source.data ? payrollView(source.data, month, now) : null
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [issuing, setIssuing] = useState<AdvanceTarget | null>(null)
  const [removing, setRemoving] = useState<{ name: string; adjustment: Adjustment } | null>(null)
  const [editing, setEditing] = useState<{ name: string; adjustment: Adjustment } | null>(null)
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)
  const periodActions: PeriodActions = {
    period,
    close:
      source.data && !closed && canClosePeriod(month, today)
        ? () => {
            setClosing(true)
          }
        : null,
    reopen:
      closed && isAdmin
        ? () => {
            setReopening(true)
          }
        : null,
  }
  const actions: AdvanceActions = {
    month,
    open,
    toggle: (teacherId) => {
      setOpen((prev) => {
        const next = new Set(prev)
        if (!next.delete(teacherId)) next.add(teacherId)
        return next
      })
    },
    issue: closed
      ? null
      : (r) => {
          setIssuing({
            teacherId: r.teacherId,
            name: r.name,
            month,
            amount: r.amount,
            advances: r.advances,
          })
        },
    remove: closed
      ? null
      : (r, adjustment) => {
          setRemoving({ name: r.name, adjustment })
        },
    edit:
      closed || !isAdmin
        ? null
        : (r, adjustment) => {
            setEditing({ name: r.name, adjustment })
          },
  }
  let body: ReactNode
  if (source.isError) {
    body = <Notice>Не удалось загрузить расчёт. Проверьте интернет — обновим сами.</Notice>
  } else if (!view) {
    body = <Notice>Считаем зарплату…</Notice>
  } else {
    body = isDesktop ? (
      <DesktopPayroll view={view} actions={actions} period={periodActions} />
    ) : (
      <MobilePayroll view={view} actions={actions} period={periodActions} />
    )
  }

  return (
    <section className="flex flex-col gap-[18px] min-[900px]:gap-[22px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1 min-[900px]:gap-1.5">
          <p className="text-[13px] font-bold tracking-[0.04em] text-ink-muted uppercase min-[900px]:text-xs min-[900px]:font-extrabold min-[900px]:tracking-[0.06em]">
            {isDesktop ? 'Расчёт зарплаты' : 'Расчёт ЗП'}
          </p>
          <div className="flex flex-wrap items-center gap-3.5">
            <h1 className="font-display text-[26px] leading-[1.1] font-bold text-ink min-[900px]:text-[30px]">
              <MonthPickerButton
                value={month}
                max={monthOf(today)}
                onSelect={(m) => {
                  void navigate({ to: '/payroll', search: { month: m } })
                }}
              >
                {isDesktop ? monthTitle(month) : monthNom(month)}
              </MonthPickerButton>
            </h1>
            {isDesktop && <PeriodChip period={period} />}
          </div>
          {isDesktop && view && (
            <p className="text-sm font-bold text-ink-muted">{payrollCaption(view, month)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <MonthSwitch month={month} today={today} />
          {isDesktop && (
            <>
              <button
                type="button"
                disabled
                title={R3_HINT}
                className="min-h-12 rounded-[14px] border-[1.5px] border-line-strong bg-card px-[18px] text-sm font-extrabold text-ink disabled:opacity-50"
              >
                Сверка со старой схемой
              </button>
              <PeriodButton actions={periodActions} />
            </>
          )}
        </div>
      </header>
      {body}
      <AdvanceDialog
        target={issuing}
        today={today}
        onOpenChange={(o) => {
          if (!o) setIssuing(null)
        }}
      />
      <DeleteAdvanceDialog
        adjustment={removing?.adjustment ?? null}
        name={removing?.name ?? ''}
        onOpenChange={(o) => {
          if (!o) setRemoving(null)
        }}
      />
      <EditAdvanceDialog
        adjustment={editing?.adjustment ?? null}
        name={editing?.name ?? ''}
        today={today}
        onOpenChange={(o) => {
          if (!o) setEditing(null)
        }}
      />
      <ClosePeriodDialog month={month} view={view} open={closing} onOpenChange={setClosing} />
      <ReopenPeriodDialog month={month} open={reopening} onOpenChange={setReopening} />
    </section>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[18px] border border-dashed border-line-strong bg-card p-5 text-sm font-bold text-ink-muted">
      {children}
    </p>
  )
}

function PeriodChip({ period, className }: { period: PayrollPeriod | null; className?: string }) {
  const chip = periodChip(period)
  return (
    <span
      data-testid="period-chip"
      title={period?.closedBy ? `Закрыл(а): ${period.closedBy}` : undefined}
      className={cn(
        'rounded-full px-3 py-1.5 text-xs font-extrabold whitespace-nowrap',
        chip.closed ? 'bg-stone text-ink' : 'bg-present-soft text-present-strong',
        className,
      )}
    >
      {chip.text}
    </span>
  )
}

/** «Закрыть период» (a month that is over) / «Открыть период» (closed, admin). */
function PeriodButton({ actions, mobileLabel }: { actions: PeriodActions; mobileLabel?: string }) {
  const base = 'min-h-12 rounded-[14px] px-[18px] text-sm font-extrabold disabled:opacity-50'
  if (actions.period) {
    if (!actions.reopen) return null
    return (
      <button
        type="button"
        onClick={actions.reopen}
        className={cn(base, 'border-[1.5px] border-line-strong bg-card text-ink')}
      >
        Открыть период
      </button>
    )
  }
  return (
    <button
      type="button"
      disabled={!actions.close}
      title={actions.close ? undefined : 'Закрыть можно, когда месяц закончится'}
      onClick={actions.close ?? undefined}
      className={cn(base, 'bg-ink text-brand')}
    >
      {mobileLabel ?? 'Закрыть период'}
    </button>
  )
}

function MonthSwitch({ month, today }: { month: string; today: string }) {
  const prev = shiftMonth(month, -1)
  const next = month < monthOf(today) ? shiftMonth(month, 1) : null
  const pill =
    'flex min-h-11 items-center gap-1.5 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 text-[13px] font-extrabold whitespace-nowrap text-ink'
  return (
    <nav className="flex gap-2" aria-label="Месяц">
      <Link to="/payroll" search={{ month: prev }} className={pill}>
        <ChevronLeft className="size-4" strokeWidth={2.5} aria-hidden />
        {monthNom(prev)}
      </Link>
      {next && (
        <Link to="/payroll" search={{ month: next }} className={pill}>
          {monthNom(next)}
          <ChevronRight className="size-4" strokeWidth={2.5} aria-hidden />
        </Link>
      )}
    </nav>
  )
}

// ─── Б1 · desktop ───────────────────────────────────────────────────────────

const th =
  'px-3 py-3.5 text-left text-[11px] font-extrabold tracking-[0.06em] whitespace-nowrap text-ink-muted uppercase'
const td = 'border-b border-line px-3 py-3.5 align-middle text-sm'
const num = 'text-right tabular-nums whitespace-nowrap'
const tile = 'flex flex-col gap-1 rounded-[18px] p-[18px]'
const tileLabel = 'text-xs font-extrabold'
const tileValue = 'font-display text-[26px] font-bold whitespace-nowrap'

function DesktopPayroll({
  view,
  actions,
  period,
}: {
  view: PayrollView
  actions: AdvanceActions
  period: PeriodActions
}) {
  const { total } = view
  const { month } = actions
  return (
    <>
      <div className="grid grid-cols-4 gap-3.5">
        <div className={cn(tile, 'bg-brand text-ink')}>
          <span className={cn(tileLabel, 'opacity-70')}>К выплате всего</span>
          <span className={cn(tileValue, 'font-extrabold')} data-testid="payroll-total">
            {som(total.toPay)}
          </span>
          {total.overpaid > 0 && (
            <span
              className="text-xs font-extrabold whitespace-nowrap text-burned-deep"
              data-testid="payroll-overpaid"
            >
              Переплата {som(total.overpaid)}
            </span>
          )}
        </div>
        <div className={cn(tile, 'border border-line bg-card')}>
          <span className={cn(tileLabel, 'text-ink-muted')}>Ученико-уроков</span>
          <span className={tileValue}>{formatSom(total.studentLessons)}</span>
        </div>
        <div className={cn(tile, 'border border-line bg-card')}>
          <span className={cn(tileLabel, 'text-ink-muted')}>Авансов выдано</span>
          <span className={tileValue} data-testid="payroll-advances">
            {total.advances > 0 ? som(total.advances) : '—'}
          </span>
        </div>
        <Unconfirmed count={view.unconfirmed} />
      </div>

      <div className="overflow-x-auto rounded-[20px] border border-line bg-card">
        <table className="w-full min-w-[1000px] border-collapse" aria-label="Учителя">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>Учитель</th>
              <th className={cn(th, 'text-right')}>Занятий</th>
              <th className={cn(th, 'text-right')}>Часов</th>
              <th className={cn(th, 'text-right')}>Ученико-уроков</th>
              <th className={cn(th, 'text-right')}>%</th>
              <th className={cn(th, 'text-right')}>Начислено</th>
              <th className={cn(th, 'text-right')}>Авансы</th>
              <th className={cn(th, 'text-right')}>К выплате</th>
              <th className={th}>
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => {
              const open = actions.open.has(r.teacherId)
              const pay = toPayCaption(r.toPay)
              return (
                <Fragment key={r.teacherId}>
                  <tr data-testid={`payroll-row-${r.teacherId}`}>
                    <td className={td}>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.name} className="size-8 text-[11px]" />
                        <div>
                          <div className="font-extrabold">{r.name}</div>
                          <div className="text-xs font-bold text-ink-muted">{r.caption}</div>
                          {r.noSubscription > 0 && (
                            <div className="text-xs font-bold text-burned-strong">
                              {noSubscriptionCaption(r.noSubscription)}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={cn(td, num)}>{r.lessonsHeld}</td>
                    <td className={cn(td, num)}>{String(r.hours).replace('.', ',')}</td>
                    <td className={cn(td, num)}>
                      {r.studentLessons}
                      {r.studentHours > 0 && (
                        <span className="block text-xs font-bold text-ink-muted">
                          {String(r.studentHours).replace('.', ',')} уч-ч продлёнки
                        </span>
                      )}
                    </td>
                    <td className={cn(td, num)}>{r.percent ?? '—'}</td>
                    <td className={cn(td, num, 'font-extrabold')}>{formatSom(r.amount)}</td>
                    <td className={cn(td, num)}>
                      {r.adjustments.length > 0 ? (
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => {
                            actions.toggle(r.teacherId)
                          }}
                          className="inline-flex min-h-11 items-center gap-1 font-bold text-ink"
                        >
                          {minusSom(r.advances)}
                          <ChevronDown
                            className={cn('size-4 transition-transform', open && 'rotate-180')}
                            aria-hidden
                          />
                          <span className="sr-only">История авансов</span>
                        </button>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        td,
                        num,
                        'font-display font-bold',
                        pay.overpaid && 'text-burned-strong',
                      )}
                      data-testid="payroll-to-pay"
                    >
                      {pay.overpaid ? pay.text : formatSom(r.toPay)}
                    </td>
                    <td className={cn(td, 'text-right')}>
                      {actions.issue && (
                        <button
                          type="button"
                          onClick={() => {
                            actions.issue?.(r)
                          }}
                          className="min-h-11 rounded-xl border-[1.5px] border-line-strong bg-card px-3 text-[13px] font-extrabold whitespace-nowrap text-ink"
                        >
                          Выдать аванс
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={9} className="border-b border-line bg-band px-6 py-2">
                        <AdvancesList
                          adjustments={r.adjustments}
                          onDelete={actions.remove && ((a) => actions.remove?.(r, a))}
                          onEdit={actions.edit && ((a) => actions.edit?.(r, a))}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="text-sm font-extrabold">
              <td className="px-3 py-3.5">Итого</td>
              <td className={cn('px-3 py-3.5', num)}>{total.lessonsHeld}</td>
              <td className={cn('px-3 py-3.5', num)}>{hoursCaption(total.hours)}</td>
              <td className={cn('px-3 py-3.5', num)}>{formatSom(total.studentLessons)}</td>
              <td />
              <td className={cn('px-3 py-3.5', num)}>{formatSom(total.amount)}</td>
              <td className={cn('px-3 py-3.5', num, total.advances === 0 && 'text-ink-muted')}>
                {total.advances > 0 ? minusSom(total.advances) : '—'}
              </td>
              <td className={cn('px-3 py-3.5 font-display', num)}>{formatSom(total.toPay)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[13px] leading-normal font-bold text-ink-muted">
        Начислено = ученико-уроки × цена урока по тарифу × процент учителя. {STUDENT_LESSON_NOTE}{' '}
        Скидки учеников не влияют. К выплате = начислено − авансы, выплата {payday(month)}.{' '}
        {period.period
          ? 'Период закрыт — суммы окончательные; правки — только после «Открыть период».'
          : 'Цифры предварительные, пока период не закрыт.'}
      </p>
    </>
  )
}

function Unconfirmed({ count }: { count: number }) {
  const ok = count === 0
  return (
    <div
      className={cn(
        tile,
        ok ? 'bg-present-soft text-present-strong' : 'bg-burned-soft text-burned-deep',
      )}
    >
      <span className={tileLabel}>Не подтверждено</span>
      <span className={tileValue} data-testid="payroll-unconfirmed">
        {count}
      </span>
      <span className="text-xs font-bold">{ok ? 'можно закрывать' : 'не входят в ЗП'}</span>
    </div>
  )
}

// ─── БМ1 · phone ────────────────────────────────────────────────────────────

function MobilePayroll({
  view,
  actions,
  period,
}: {
  view: PayrollView
  actions: AdvanceActions
  period: PeriodActions
}) {
  const { total } = view
  const { month } = actions
  const stats = [
    [String(view.teachers), 'учителей'],
    [formatSom(total.studentLessons), 'уч-уроков'],
    [String(view.unconfirmed), 'не подтв.'],
  ] as const
  return (
    <>
      <div className="flex flex-col gap-3.5 rounded-[24px] bg-ink px-[22px] pt-5 pb-[18px] text-paper">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-extrabold tracking-[0.06em] text-brand uppercase">
            К выплате {payday(month)}
          </span>
          <PeriodChip period={period.period} className="px-2.5 py-1" />
        </div>
        <p
          className="font-display text-[34px] leading-none font-extrabold whitespace-nowrap text-brand"
          data-testid="payroll-total"
        >
          {formatSom(total.toPay)} <span className="text-lg font-medium text-paper">сом</span>
        </p>
        {total.overpaid > 0 && (
          <p className="text-[13px] font-extrabold text-burned" data-testid="payroll-overpaid">
            Переплата {som(total.overpaid)}
          </p>
        )}
        {total.advances > 0 && (
          <p className="text-[13px] font-bold opacity-70" data-testid="payroll-advances">
            начислено {formatSom(total.amount)} · авансы {minusSom(total.advances)}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {stats.map(([value, label]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-[14px] bg-paper/8 p-2.5">
              <span className="font-display text-lg font-bold">{value}</span>
              <span className="text-[11px] font-bold opacity-65">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-2" aria-label="По учителям">
        <h2 className="text-sm font-extrabold">По учителям</h2>
        <ul className="flex flex-col rounded-2xl border border-line bg-card px-3.5">
          {view.rows.map((r) => {
            const open = actions.open.has(r.teacherId)
            const pay = toPayCaption(r.toPay)
            return (
              <li key={r.teacherId} className="flex flex-col border-b border-line last:border-b-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => {
                    actions.toggle(r.teacherId)
                  }}
                  className="flex min-h-11 items-center gap-3 py-3 text-left"
                  data-testid={`payroll-row-${r.teacherId}`}
                >
                  <Avatar name={r.name} className="size-9 text-xs" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-extrabold">{r.name.split(' ')[0]}</span>
                    <span className="text-xs font-bold text-ink-muted">
                      {[
                        `${r.lessonsHeld} зан`,
                        r.hours !== r.lessonsHeld ? hoursCaption(r.hours) : null,
                        `${r.studentLessons} уч-ур`,
                        r.studentHours > 0
                          ? `${String(r.studentHours).replace('.', ',')} уч-ч продлёнки`
                          : null,
                        r.percent !== null ? `${r.percent} %` : null,
                        r.advances > 0 ? `аванс ${minusSom(r.advances)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {r.noSubscription > 0 && (
                        <span className="text-burned-strong">
                          {' · '}
                          {noSubscriptionCaption(r.noSubscription)}
                        </span>
                      )}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'font-display text-sm font-bold whitespace-nowrap',
                      pay.overpaid && 'text-burned-strong',
                    )}
                    data-testid="payroll-to-pay"
                  >
                    {pay.overpaid ? pay.text : formatSom(r.toPay)}
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-ink-muted transition-transform',
                      open && 'rotate-180',
                    )}
                    aria-hidden
                  />
                </button>
                {open && (
                  <div className="flex flex-col gap-2.5 pb-3.5">
                    <div className="flex flex-col gap-1 rounded-xl bg-band px-3 py-2.5 text-[13px] font-bold">
                      <div className="flex justify-between gap-3">
                        <span className="text-ink-muted">Начислено</span>
                        <span className="whitespace-nowrap">{som(r.amount)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-ink-muted">Авансы</span>
                        <span className="whitespace-nowrap">
                          {r.advances > 0 ? minusSom(r.advances) : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3 font-extrabold">
                        <span>К выплате {payday(month)}</span>
                        <span
                          className={cn('whitespace-nowrap', pay.overpaid && 'text-burned-strong')}
                        >
                          {pay.text}
                        </span>
                      </div>
                    </div>
                    <AdvancesList
                      adjustments={r.adjustments}
                      onDelete={actions.remove && ((a) => actions.remove?.(r, a))}
                      onEdit={actions.edit && ((a) => actions.edit?.(r, a))}
                    />
                    {actions.issue && (
                      <button
                        type="button"
                        onClick={() => {
                          actions.issue?.(r)
                        }}
                        className="min-h-11 rounded-[14px] border-[1.5px] border-line-strong bg-card px-4 text-sm font-extrabold text-ink"
                      >
                        Выдать аванс
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <PeriodButton actions={period} mobileLabel={`Закрыть ${monthNom(month).toLowerCase()}`} />
      <p className="text-xs font-bold text-ink-muted">
        {period.period
          ? 'Период закрыт — суммы окончательные; правки — только после «Открыть период».'
          : period.close
            ? 'После закрытия занятия месяца блокируются.'
            : 'Закрыть можно, когда месяц закончится.'}
      </p>
    </>
  )
}
