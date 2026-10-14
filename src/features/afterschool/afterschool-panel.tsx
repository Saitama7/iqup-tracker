// А6 «Продлёнка по часам» (#82) on the enrollment card: the student's plan («Изменить с даты»), the
// bill of the current and the next month by plan hours, «Выставить счёт за ноябрь».
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { DateInput } from '@/components/ui/date-picker'
import { BALANCES_KEY } from '@/features/payments/api'
import { STUDENTS_KEY } from '@/features/students/api'
import { formatDayMonth } from '@/features/students/model'
import { FormDialog } from '@/features/students/parts'
import { tariffsQuery } from '@/features/subscriptions/api'
import {
  defaultDiscount,
  discountAvailability,
  type DiscountHistory,
  type DiscountPct,
} from '@/features/subscriptions/model'
import { tariffFor } from '@/features/tariffs/current'
import { formatSom } from '@/features/tariffs/model'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { formatDateRu, parseDateRu } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  AFTERSCHOOL_KEY,
  enrollmentAfterschoolQuery,
  issueAfterschoolInvoice,
  monthQuoteQuery,
  planPreviewQuery,
  setAfterschoolPlan,
  type MonthBill,
} from './api'
import {
  formatHours,
  formatPlan,
  formatQuote,
  invoiceQuote,
  monthAccusative,
  monthStart,
  nextMonth,
  planOn,
  tariffHourPrice,
  validPlan,
  type PlanHours,
} from './model'
import { PlanEditor } from './plan-editor'

const linkClass =
  'flex min-h-11 items-center self-start text-xs font-extrabold whitespace-nowrap text-teal'

export interface AfterschoolEnrollment {
  enrollmentId: string
  groupLabel: string
  startDate: string
  endDate: string | null
  /** ISO weekdays of the group's schedule. */
  groupWeekdays: number[]
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [AFTERSCHOOL_KEY] }),
      queryClient.invalidateQueries({ queryKey: STUDENTS_KEY }),
      queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] }),
    ])
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Last day of the month of `month` (ISO). */
function monthEnd(month: string): string {
  const d = new Date(`${nextMonth(month)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

const signedSom = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatSom(Math.abs(n))} сом`

export function AfterschoolPanel({
  e,
  today,
  history,
}: {
  e: AfterschoolEnrollment
  today: string
  history: DiscountHistory
}) {
  const query = useQuery(enrollmentAfterschoolQuery(e.enrollmentId, monthStart(today)))
  const tariffs = useQuery(tariffsQuery())
  const [editing, setEditing] = useState(false)
  const [invoicing, setInvoicing] = useState<MonthBill | null>(null)

  if (query.isPending) return <div className="h-20 animate-pulse rounded-[14px] bg-muted" />
  if (query.isError) {
    return (
      <p role="alert" className="text-sm font-bold text-burned">
        Не удалось загрузить график продлёнки
      </p>
    )
  }
  const { plans, months, credit, earlier } = query.data
  // the first hour invoice: billed from the day after the old package — the admin may move the date
  const firstInvoice = earlier.length === 0 && months.every((m) => !m.invoice)
  const current = planOn(plans, today)
  const latest = plans.at(-1)
  const hourPrice = (month: string) => {
    const t = tariffs.data
      ? tariffFor('afterschool', month < e.startDate ? e.startDate : month, tariffs.data)
      : null
    return t ? tariffHourPrice(t) : null
  }

  return (
    <div
      aria-label="Продлёнка по часам"
      className="flex flex-col gap-2.5 rounded-[14px] bg-muted px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[11px] font-extrabold tracking-[0.06em] text-ink-muted uppercase">
          График продлёнки
        </span>
        <button
          type="button"
          className={linkClass}
          onClick={() => {
            setEditing(true)
          }}
        >
          Изменить с даты
        </button>
      </div>
      <p className="text-sm font-extrabold">
        {current ? formatPlan(current) : 'Графика нет — уроки по-старому'}
        {latest && latest.valid_from > today && (
          <span className="block text-xs font-bold text-ink-muted">
            с {formatDayMonth(latest.valid_from)}: {formatPlan(latest.hours)}
          </span>
        )}
      </p>
      {earlier.map((i) => (
        <div
          key={i.id}
          className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line-strong pt-2"
        >
          <span className="text-xs font-extrabold">{cap(monthAccusative(i.period_month))}</span>
          <span className="text-xs font-extrabold whitespace-nowrap text-present-strong">
            Счёт выставлен · {formatHours(i.hours_total)} ч · {formatSom(i.price_final)} сом
          </span>
        </div>
      ))}
      {months.map((m) => {
        const hours = m.rows.reduce((n, r) => n + r.hours * r.days, 0)
        const price = hourPrice(m.month)
        const quote = price !== null ? invoiceQuote(hours, credit, price, 0) : null
        return (
          <div key={m.month} className="flex flex-col gap-0.5 border-t border-line-strong pt-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-xs font-extrabold">{cap(monthAccusative(m.month))}</span>
              {m.invoice ? (
                <span className="text-xs font-extrabold whitespace-nowrap text-present-strong">
                  Счёт выставлен · {formatHours(m.invoice.hours_total)} ч ·{' '}
                  {formatSom(m.invoice.price_final)} сом
                </span>
              ) : (
                quote &&
                quote.hours > 0 && (
                  <span className="text-xs font-bold whitespace-nowrap text-ink-muted">
                    ≈ {formatHours(quote.hours)} ч · {formatSom(quote.priceFull)} сом
                  </span>
                )
              )}
            </div>
            <p className="text-xs font-bold text-ink-muted">
              {formatQuote({ rows: m.rows, hours })}
            </p>
            {!m.invoice && m.from >= nextMonth(m.month) && (
              <p className="text-xs font-bold text-ink-muted">Месяц покрывает старый абонемент</p>
            )}
            {!m.invoice && m.from > m.month && m.from < nextMonth(m.month) && (
              <p className="text-xs font-bold text-ink-muted">
                С {formatDayMonth(m.from)} — до этого старый абонемент
              </p>
            )}
            {m.invoice && m.invoice.credit_hours > 0 && (
              <p className="text-xs font-bold text-teal">
                − {formatHours(m.invoice.credit_hours)} ч неиспользованных прошлых счетов
              </p>
            )}
            {!m.invoice && hours > 0 && (
              <button
                type="button"
                className={linkClass}
                onClick={() => {
                  setInvoicing(m)
                }}
              >
                Выставить счёт за {monthAccusative(m.month)}
              </button>
            )}
          </div>
        )
      })}
      {credit > 0 && (
        <p className="text-xs font-bold text-teal">
          Кредит {formatHours(credit)} ч (неиспользованные часы) — вычтется из следующего счёта
        </p>
      )}
      {editing && (
        <PlanDialog
          e={e}
          today={today}
          hours={current ?? [0, 0, 0, 0, 0, 0, 0]}
          onClose={() => {
            setEditing(false)
          }}
        />
      )}
      {invoicing && (
        <InvoiceDialog
          e={e}
          bill={invoicing}
          first={firstInvoice}
          credit={credit}
          hourPrice={hourPrice(invoicing.month)}
          history={history}
          onClose={() => {
            setInvoicing(null)
          }}
        />
      )}
    </div>
  )
}

function PlanDialog({
  e,
  today,
  hours: initial,
  onClose,
}: {
  e: AfterschoolEnrollment
  today: string
  hours: PlanHours
  onClose: () => void
}) {
  const id = useId()
  const invalidate = useInvalidate()
  const [hours, setHours] = useState<number[]>([...initial])
  const reasonId = useId()
  const [date, setDate] = useState(formatDateRu(today < e.startDate ? e.startDate : today))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const iso = parseDateRu(date)
  // a date in the past (Каныкей enters a month afterwards): what changes in the marks already there
  const past = iso !== null && iso < today
  const preview = useQuery({
    ...planPreviewQuery(e.enrollmentId, iso ?? today, hours),
    enabled: iso !== null && iso <= today && iso >= e.startDate && validPlan(hours),
  })
  const mutation = useMutation({
    mutationFn: (validFrom: string) =>
      setAfterschoolPlan(e.enrollmentId, validFrom, hours, past ? reason : undefined),
    onSuccess: async (_, validFrom) => {
      await invalidate()
      toast.success(`График изменён с ${formatDayMonth(validFrom)}`)
      onClose()
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  function onSubmit(ev: SubmitEvent<HTMLFormElement>) {
    ev.preventDefault()
    const iso = parseDateRu(date)
    if (!iso) {
      setError('Дата в формате ДД.ММ.ГГГГ')
      return
    }
    if (iso < e.startDate) {
      setError('Не раньше даты зачисления')
      return
    }
    if (!validPlan(hours)) {
      setError('Укажите часы хотя бы на один день')
      return
    }
    if (iso < today && !reason.trim()) {
      setError('Дата в прошлом — укажите причину')
      return
    }
    setError(null)
    mutation.mutate(iso)
  }

  return (
    <FormDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title="График продлёнки"
      description={`${e.groupLabel} · с выбранной даты часы списываются по новому графику; выставленные счета не меняются`}
    >
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="График продлёнки"
        className="flex flex-col gap-3.5"
      >
        <Field id={id} label="Действует с">
          <DateInput
            id={id}
            className={inputClass}
            value={date}
            min={e.startDate}
            max={e.endDate ?? undefined}
            onChange={setDate}
          />
        </Field>
        <PlanEditor hours={hours} onChange={setHours} groupWeekdays={e.groupWeekdays} />
        {preview.data && preview.data.marks > 0 && iso && (
          <div
            role="alert"
            className="flex flex-col gap-0.5 rounded-[14px] bg-muted px-4 py-3 text-sm font-bold"
          >
            <p>
              Изменятся часы проведённых занятий с {formatDayMonth(iso)}: {preview.data.marks}{' '}
              {preview.data.marks === 1 ? 'отметка' : 'отметок'},{' '}
              {preview.data.hoursDelta > 0 ? '+' : '−'}
              {formatHours(Math.abs(preview.data.hoursDelta))} ч
            </p>
            <p className="text-ink-muted">
              ЗП учителя {signedSom(preview.data.payrollDelta)}, баланс ученика{' '}
              {signedSom(-preview.data.balanceDelta)}
            </p>
            <p className="text-ink-muted">
              Выставленные счета не меняются — разница уйдёт в следующий
            </p>
          </div>
        )}
        {past && (
          <Field id={reasonId} label="Причина (в журнал)">
            <input
              id={reasonId}
              className={inputClass}
              value={reason}
              maxLength={500}
              onChange={(ev) => {
                setReason(ev.target.value)
                setError(null)
              }}
              placeholder="например: график сентября внесён задним числом"
            />
          </Field>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>Сохранить график</SubmitButton>
      </form>
    </FormDialog>
  )
}

function InvoiceDialog({
  e,
  bill,
  first,
  credit,
  hourPrice,
  history,
  onClose,
}: {
  e: AfterschoolEnrollment
  bill: MonthBill
  /** The first hour invoice: «Считать с» (the day after the old package by default). */
  first: boolean
  credit: number
  hourPrice: number | null
  history: DiscountHistory
  onClose: () => void
}) {
  const invalidate = useInvalidate()
  const fromId = useId()
  const [discount, setDiscount] = useState<DiscountPct>(() => defaultDiscount(history))
  const [error, setError] = useState<string | null>(null)
  const last = monthEnd(bill.month)
  const [fromText, setFromText] = useState(() =>
    formatDateRu(bill.from > last ? bill.month : bill.from),
  )
  const parsedFrom = parseDateRu(fromText)
  const from =
    first && parsedFrom && parsedFrom >= bill.month && parsedFrom <= last ? parsedFrom : bill.from
  const fromQuote = useQuery({
    ...monthQuoteQuery(e.enrollmentId, bill.month, from),
    enabled: first && from !== bill.from,
  })
  const rows = from === bill.from ? bill.rows : (fromQuote.data ?? [])
  const planned = rows.reduce((n, r) => n + r.hours * r.days, 0)
  const quote = hourPrice !== null ? invoiceQuote(planned, credit, hourPrice, discount) : null
  const mutation = useMutation({
    mutationFn: () =>
      issueAfterschoolInvoice(e.enrollmentId, bill.month, discount, first ? from : undefined),
    onSuccess: async () => {
      await invalidate()
      toast.success(`Счёт за ${monthAccusative(bill.month)} выставлен`)
      onClose()
    },
    onError: (err) => {
      setError(err.message)
    },
  })
  const options = discountAvailability(history)

  return (
    <FormDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={`Счёт за ${monthAccusative(bill.month)}`}
      description={`${e.groupLabel} · часы по графику × цена часа; оплата — «Записать оплату»`}
    >
      <form
        onSubmit={(ev) => {
          ev.preventDefault()
          setError(null)
          mutation.mutate()
        }}
        aria-label={`Счёт за ${monthAccusative(bill.month)}`}
        className="flex flex-col gap-3.5"
      >
        {first && (
          <Field id={fromId} label="Считать с (после старого абонемента)">
            <DateInput
              id={fromId}
              className={inputClass}
              value={fromText}
              min={bill.month}
              max={last}
              onChange={setFromText}
            />
          </Field>
        )}
        <div
          role="status"
          className="flex flex-col gap-1.5 rounded-[14px] bg-muted px-4 py-3 text-sm font-bold"
        >
          <p>{formatQuote({ rows, hours: planned })}</p>
          {quote && quote.credit > 0 && (
            <p className="text-teal">− {formatHours(quote.credit)} ч неиспользованных (кредит)</p>
          )}
          {quote ? (
            <>
              <div className="flex justify-between gap-3">
                <span className="text-ink-muted">
                  {formatHours(quote.hours)} ч × {formatSom(quote.hourPrice)} сом
                </span>
                <span className="whitespace-nowrap">{formatSom(quote.priceFull)} сом</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-ink-muted">Скидка {discount} %</span>
                  <span className="whitespace-nowrap">
                    −{formatSom(quote.priceFull - quote.priceFinal)} сом
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 border-t border-line-strong pt-2">
                <span>К оплате</span>
                <span className="font-display text-lg font-bold whitespace-nowrap">
                  {formatSom(quote.priceFinal)} сом
                </span>
              </div>
            </>
          ) : (
            <p className="text-ink-muted">Нет тарифа продлёнки на этот месяц</p>
          )}
        </div>
        <div role="group" aria-label="Скидка" className="grid grid-cols-3 gap-1.5">
          {options.map((o) => (
            <button
              key={o.pct}
              type="button"
              aria-pressed={discount === o.pct}
              disabled={!o.available}
              onClick={() => {
                setDiscount(o.pct)
              }}
              className={cn(
                'min-h-11 rounded-xl border-[1.5px] px-1.5 text-sm font-extrabold disabled:opacity-45',
                discount === o.pct
                  ? 'border-ink bg-ink text-brand'
                  : 'border-line-strong bg-card text-ink',
              )}
            >
              {o.pct} %
            </button>
          ))}
        </div>
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>
          Выставить счёт{quote ? ` · ${formatSom(quote.priceFinal)} сом` : ''}
        </SubmitButton>
      </form>
    </FormDialog>
  )
}
