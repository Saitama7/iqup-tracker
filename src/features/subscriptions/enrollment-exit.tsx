import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useId, useState, type ReactNode, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { DateInput } from '@/components/ui/date-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PAYMENT_METHODS, type PaymentMethod } from '@/features/payments/api'
import { METHOD_BUTTON } from '@/features/payments/model'
import { groupLabel, type GroupBrief } from '@/features/students/model'
import { FormDialog, NativeSelect } from '@/features/students/parts'
import { formatSom } from '@/features/tariffs/model'
import { ErrorText, Field, inputClass, labelClass, SubmitButton } from '@/features/tariffs/parts'
import { formatDateRu, parseDateRu } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  deleteEnrollment,
  payrollImpactQuery,
  settlementQuery,
  transferPreviewQuery,
  transferStudent,
  withdrawEnrollment,
  type DeleteMoney,
  type Settlement,
} from './exit-api'
import {
  AFTERSCHOOL_NO_TRANSFER,
  impactCaption,
  marksCaption,
  settlementLines,
  targetLabel,
  toPayCaption,
  transferTargets,
  withdrawDefaultDate,
  withdrawMinDate,
} from './exit-model'

// #81: the «⋯» of an enrollment on А6 and on the group page — «Перевести в другую группу», «Ушёл из
// группы», «Записан по ошибке — удалить». Each dialog shows the money (and the payroll) before the
// button; the database recomputes and checks everything (0024).

export type ExitAction = 'transfer' | 'withdraw' | 'delete'

const ACTION_TITLE: Record<ExitAction, string> = {
  transfer: 'Перевести в другую группу',
  withdraw: 'Ушёл из группы',
  delete: 'Записан по ошибке — удалить',
}

/**
 * «⋯» next to an enrollment: the three ways out of a group. An after-school enrollment billed by
 * hours has no transfer — its dialog says so (#82); one still on the old 20-lesson packages moves.
 */
export function EnrollmentMenu({
  label,
  onAction,
}: {
  label: string
  onAction: (action: ExitAction) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Действия: ${label}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-muted"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col p-1.5">
        {(Object.keys(ACTION_TITLE) as ExitAction[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => {
              setOpen(false)
              onAction(a)
            }}
            className={cn(
              'flex min-h-11 items-center rounded-xl px-3 text-left text-sm font-bold hover:bg-muted',
              a === 'delete' && 'text-burned-strong',
            )}
          >
            {ACTION_TITLE[a]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

const noteClass = 'rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong'

function Note({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'muted' }) {
  return (
    <p role="status" className={tone === 'warn' ? noteClass : 'text-xs font-bold text-ink-muted'}>
      {children}
    </p>
  )
}

/** Оплачено / Отучено / Остаток. */
function MoneyBlock({ s, extra }: { s: Settlement; extra?: ReactNode }) {
  return (
    <dl className="flex flex-col gap-1 rounded-[14px] bg-muted px-3.5 py-3 text-sm">
      {settlementLines(s).map((l) => (
        <div key={l.label} className="flex items-baseline justify-between gap-3">
          <dt className="font-bold text-ink-muted">{l.label}</dt>
          <dd
            className={cn(
              'text-right font-extrabold tabular-nums',
              l.tone === 'debt' && 'text-burned-strong',
            )}
          >
            {l.value}
          </dd>
        </div>
      ))}
      {extra}
    </dl>
  )
}

function MoneyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1">
      <dt className="font-bold text-ink-muted">{label}</dt>
      <dd className="text-right font-extrabold tabular-nums">{children}</dd>
    </div>
  )
}

function Choice({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string
  value: string
  checked: boolean
  onChange: () => void
  children: ReactNode
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border-[1.5px] border-line-strong px-3 text-sm font-bold has-[:checked]:border-ink">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="size-4 accent-ink"
      />
      {children}
    </label>
  )
}

function MethodPicker({
  value,
  onChange,
}: {
  value: PaymentMethod | null
  onChange: (m: PaymentMethod) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelClass}>Способ возврата</span>
      <div role="group" aria-label="Способ возврата" className="grid grid-cols-2 gap-2">
        {PAYMENT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={value === m}
            onClick={() => {
              onChange(m)
            }}
            className={cn(
              'min-h-11 rounded-xl border-[1.5px] border-line-strong text-sm font-extrabold',
              value === m && 'border-ink bg-ink text-brand',
            )}
          >
            {METHOD_BUTTON[m]}
          </button>
        ))}
      </div>
    </div>
  )
}

const som = (n: number) => `${formatSom(n)} сом`

interface ExitProps {
  enrollmentId: string
  studentName: string
  group: GroupBrief | null
  startDate: string
  groups: readonly GroupBrief[]
  today: string
  onDone: (message: string) => void
}

/** One of the three dialogs; closes itself after the database accepted the change. */
export function EnrollmentExitDialog({
  action,
  onOpenChange,
  ...props
}: Omit<ExitProps, 'onDone'> & { action: ExitAction; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const settlement = useQuery(settlementQuery(props.enrollmentId))
  const label = props.group ? groupLabel(props.group) : 'группа'
  const onDone = (message: string) => {
    toast.success(message)
    onOpenChange(false)
    // balances, rosters, payroll, payments, journal — everything the change touches
    void queryClient.invalidateQueries()
  }

  let body: ReactNode
  if (settlement.isPending) {
    body = <div className="h-24 animate-pulse rounded-xl bg-muted" aria-label="Загрузка" />
  } else if (settlement.isError) {
    body = <ErrorText>{settlement.error.message}</ErrorText>
  } else if (action === 'transfer' && settlement.data.unit === 'hour') {
    // billed by hours (#82): the month invoices do not move; old 20-lesson packages do (0024)
    body = <Note>{AFTERSCHOOL_NO_TRANSFER}</Note>
  } else if (action === 'transfer') {
    body = <TransferBody {...props} s={settlement.data} onDone={onDone} />
  } else if (action === 'withdraw') {
    body = <WithdrawBody {...props} s={settlement.data} onDone={onDone} />
  } else {
    body = <DeleteBody {...props} s={settlement.data} onDone={onDone} />
  }

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={action === 'delete' ? 'Записан по ошибке?' : ACTION_TITLE[action]}
      description={`${props.studentName} · ${label}`}
    >
      {body}
    </FormDialog>
  )
}

// ─── Перевести ──────────────────────────────────────────────────────────────

function TransferBody({
  enrollmentId,
  studentName,
  group,
  groups,
  s,
  onDone,
}: ExitProps & { s: Settlement }) {
  const ids = { group: useId(), date: useId(), surplus: useId() }
  const targets = transferTargets(groups, group)
  const [groupId, setGroupId] = useState('')
  const [typed, setTyped] = useState<string | null>(null)
  const [refundSurplus, setRefundSurplus] = useState(false)
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const target = targets.find((g) => g.id === groupId) ?? null
  const typedIso = typed !== null ? parseDateRu(typed) : null
  const preview = useQuery({
    ...transferPreviewQuery(enrollmentId, groupId, typedIso),
    enabled: !!target,
  })
  const p = preview.data
  const date = typed ?? (p ? formatDateRu(p.startDate) : '')

  const mutation = useMutation({
    mutationFn: transferStudent,
    onSuccess: () => {
      onDone(`${studentName} переведён(а) в ${target ? groupLabel(target) : 'группу'}`)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!target) {
      setError('Выберите группу')
      return
    }
    const iso = parseDateRu(date)
    if (!iso) {
      setError('Дата в формате ДД.ММ.ГГГГ')
      return
    }
    const refund = !!p && p.surplus > 0 && refundSurplus
    if (refund && !method) {
      setError('Выберите способ возврата')
      return
    }
    setError(null)
    mutation.mutate({
      enrollmentId,
      groupId: target.id,
      startDate: iso,
      refundSurplus: refund,
      method: refund ? method : null,
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Перевести в другую группу"
      className="flex flex-col gap-3.5"
    >
      {targets.length === 0 ? (
        <Note>Нет другой действующей группы.</Note>
      ) : (
        <Field id={ids.group} label="Новая группа">
          <NativeSelect
            id={ids.group}
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value)
              setTyped(null)
              setError(null)
            }}
          >
            <option value="">Выберите группу</option>
            {targets.map((g) => (
              <option key={g.id} value={g.id}>
                {targetLabel(g)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {target && (
        <Field id={ids.date} label="С какого дня в новой группе">
          <DateInput
            id={ids.date}
            className={inputClass}
            value={date}
            min={target.start_date}
            max={target.end_date}
            onChange={(v) => {
              setTyped(v)
              setError(null)
            }}
          />
        </Field>
      )}
      {target && preview.isError && <ErrorText>{preview.error.message}</ErrorText>}
      {target && p?.wholeMove && (
        <Note tone="muted">
          Тот же тип группы, отметок «был» нет — зачисление переедет целиком вместе с абонементом и
          оплатами ({som(s.moneySom)}).
        </Note>
      )}
      {target && p && !p.wholeMove && (
        <>
          <MoneyBlock
            s={s}
            extra={
              <>
                <MoneyRow label={`Цена в новой группе`}>
                  {p.price !== null ? `${som(p.price)} · ${p.lessonsTotal ?? 0} ур` : '—'}
                </MoneyRow>
                <MoneyRow label="К оплате">{toPayCaption(p)}</MoneyRow>
              </>
            }
          />
          {p.surplus > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className={cn(labelClass, 'mb-1.5')}>
                Остаток больше цены на {som(p.surplus)}
              </legend>
              <Choice
                name={ids.surplus}
                value="keep"
                checked={!refundSurplus}
                onChange={() => {
                  setRefundSurplus(false)
                }}
              >
                Оставить на балансе — пойдёт на следующие уроки
              </Choice>
              <Choice
                name={ids.surplus}
                value="refund"
                checked={refundSurplus}
                onChange={() => {
                  setRefundSurplus(true)
                }}
              >
                Вернуть {som(p.surplus)}
              </Choice>
              {refundSurplus && <MethodPicker value={method} onChange={setMethod} />}
            </fieldset>
          )}
          <Note tone="muted">
            Старый абонемент закроется на {s.lessonsUsed} отученных уроках — учитель старой группы
            получает за них как раньше. Остаток переносится записью «перенос» в оплатах обеих групп.
          </Note>
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {targets.length > 0 && (
        <SubmitButton pending={mutation.isPending || (!!target && preview.isFetching)}>
          Перевести
        </SubmitButton>
      )}
    </form>
  )
}

// ─── Ушёл ───────────────────────────────────────────────────────────────────

function WithdrawBody({
  enrollmentId,
  studentName,
  startDate,
  today,
  s,
  onDone,
}: ExitProps & { s: Settlement }) {
  const ids = {
    date: useId(),
    choice: useId(),
    amount: useId(),
    reason: useId(),
    center: useId(),
  }
  const min = withdrawMinDate(startDate, s.lastMarkDate)
  const [date, setDate] = useState(formatDateRu(withdrawDefaultDate(today, min)))
  const refundable = Math.max(0, s.remainder)
  const [refund, setRefund] = useState(refundable > 0)
  const [amount, setAmount] = useState(String(refundable))
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [reason, setReason] = useState('')
  const [centerReason, setCenterReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  // What is not refunded stays with the center — only explicitly, with a reason (never lost silently).
  const typed = Number(amount.replace(/\s/g, ''))
  const rest = refund
    ? Number.isInteger(typed) && typed > 0 && typed < refundable
      ? refundable - typed
      : 0
    : refundable

  const mutation = useMutation({
    mutationFn: withdrawEnrollment,
    onSuccess: (_, input) => {
      const left = refundable - input.refund
      onDone(
        [
          `${studentName}: зачисление завершено`,
          input.refund > 0 ? `возврат ${som(input.refund)}` : null,
          left > 0 ? `${som(left)} оставлено центру` : null,
        ]
          .filter(Boolean)
          .join(', '),
      )
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const iso = parseDateRu(date)
    if (!iso) {
      setError('Дата в формате ДД.ММ.ГГГГ')
      return
    }
    if (iso < min) {
      setError(`Не раньше ${formatDateRu(min)} — до этого дня есть отметки`)
      return
    }
    const sum = refund ? Number(amount.replace(/\s/g, '')) : 0
    if (refund && (!Number.isInteger(sum) || sum <= 0 || sum > refundable)) {
      setError(`Сумма возврата — от 1 до ${som(refundable)}`)
      return
    }
    if (refund && !method) {
      setError('Выберите способ возврата')
      return
    }
    const left = refundable - sum
    if (left > 0 && !centerReason.trim()) {
      setError(`Укажите, почему ${som(left)} остаётся центру`)
      return
    }
    setError(null)
    mutation.mutate({
      enrollmentId,
      endDate: iso,
      refund: sum,
      method: refund ? method : null,
      reason,
      centerReason: left > 0 ? centerReason : '',
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Ушёл из группы"
      className="flex flex-col gap-3.5"
    >
      <Field id={ids.date} label="Последний день в группе">
        <DateInput
          id={ids.date}
          className={inputClass}
          value={date}
          min={min}
          onChange={(v) => {
            setDate(v)
            setError(null)
          }}
        />
      </Field>
      <MoneyBlock s={s} />
      {refundable > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className={cn(labelClass, 'mb-1.5')}>Остаток {som(refundable)}</legend>
          <Choice
            name={ids.choice}
            value="refund"
            checked={refund}
            onChange={() => {
              setRefund(true)
            }}
          >
            Оформить возврат родителю
          </Choice>
          <Choice
            name={ids.choice}
            value="center"
            checked={!refund}
            onChange={() => {
              setRefund(false)
            }}
          >
            Не возвращать — остаток остаётся центру
          </Choice>
          {refund && (
            <>
              <Field id={ids.amount} label="Сумма возврата, сом">
                <input
                  id={ids.amount}
                  inputMode="numeric"
                  className={inputClass}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value)
                    setError(null)
                  }}
                />
              </Field>
              <MethodPicker value={method} onChange={setMethod} />
              <Field id={ids.reason} label="Причина">
                <input
                  id={ids.reason}
                  className={inputClass}
                  value={reason}
                  placeholder="ученик ушёл из группы"
                  onChange={(e) => {
                    setReason(e.target.value)
                  }}
                />
              </Field>
            </>
          )}
          {rest > 0 && (
            <>
              <Note tone="muted">
                {refund
                  ? `Разница ${som(rest)} не вернётся — она останется центру.`
                  : `${som(rest)} останется центру.`}{' '}
                На балансе ученика после ухода деньги не хранятся — причина попадёт в журнал.
              </Note>
              <Field id={ids.center} label={`Почему ${som(rest)} остаётся центру`}>
                <input
                  id={ids.center}
                  className={inputClass}
                  value={centerReason}
                  placeholder="например: договорились с родителем"
                  onChange={(e) => {
                    setCenterReason(e.target.value)
                    setError(null)
                  }}
                />
              </Field>
            </>
          )}
        </fieldset>
      ) : (
        <Note tone="muted">
          {s.remainder < 0
            ? `Возвращать нечего: за учеником долг ${som(-s.remainder)}.`
            : 'Возвращать нечего.'}
        </Note>
      )}
      <Note tone="muted">
        Прошедшие уроки остаются, ЗП учителю за них — тоже. С занятий после этого дня ученик
        уберётся.
      </Note>
      {error && <ErrorText>{error}</ErrorText>}
      <SubmitButton pending={mutation.isPending}>
        {refund && refundable > 0 ? 'Оформить возврат и завершить' : 'Завершить зачисление'}
      </SubmitButton>
    </form>
  )
}

// ─── Записан по ошибке ──────────────────────────────────────────────────────

function DeleteBody({
  enrollmentId,
  studentName,
  group,
  groups,
  startDate,
  s,
  onDone,
}: ExitProps & { s: Settlement }) {
  const ids = { choice: useId(), group: useId(), date: useId() }
  const impact = useQuery(payrollImpactQuery(enrollmentId))
  // no money moves out of an enrollment billed by hours — as the transfer (#82); targets have no
  // after-school groups (transferTargets)
  const fromAfterschool = s.unit === 'hour'
  const targets = transferTargets(groups, group)
  const hasMoney = s.moneySom !== 0
  const [money, setMoney] = useState<'transfer' | 'refund' | null>(null)
  const [groupId, setGroupId] = useState('')
  const [typed, setTyped] = useState<string | null>(null)
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const target = targets.find((g) => g.id === groupId) ?? null
  const defaultStart = target && target.start_date > startDate ? target.start_date : startDate
  const date = typed ?? formatDateRu(defaultStart)
  const marks = marksCaption(s)

  const mutation = useMutation({
    mutationFn: (m: DeleteMoney) => deleteEnrollment(enrollmentId, m),
    onSuccess: () => {
      onDone(`${studentName}: ошибочное зачисление удалено`)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    let m: DeleteMoney = { kind: 'none' }
    if (hasMoney) {
      if (money === 'transfer') {
        const iso = parseDateRu(date)
        if (!target) {
          setError('Выберите правильную группу')
          return
        }
        if (!iso) {
          setError('Дата в формате ДД.ММ.ГГГГ')
          return
        }
        m = { kind: 'transfer', groupId: target.id, startDate: iso }
      } else if (money === 'refund') {
        if (!method) {
          setError('Выберите способ возврата')
          return
        }
        m = { kind: 'refund', method }
      } else {
        setError('Оплаты не удаляются — выберите, что сделать с деньгами')
        return
      }
    }
    setError(null)
    mutation.mutate(m)
  }

  if (s.locked > 0) {
    return (
      <Note>
        Есть отметки в закрытом периоде — зачисление нельзя удалить. Исправления — через ЗП.
      </Note>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Записан по ошибке"
      className="flex flex-col gap-3.5"
    >
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Будет удалено</span>
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm font-bold">
          <li>
            Зачисление и абонемент{hasMoney || s.payments > 0 ? ' (оплаты остаются в истории)' : ''}
          </li>
          {marks && <li>{marks}</li>}
        </ul>
        {s.hasTrial && (
          <p className="text-xs font-bold text-ink-muted">
            Пробное вернётся в статус «был на пробном».
          </p>
        )}
      </div>
      {impact.data && impact.data.length > 0 && (
        <div role="status" className={noteClass}>
          ЗП уменьшится: {impact.data.map((i) => impactCaption(i)).join('; ')}
        </div>
      )}
      {hasMoney && (
        <fieldset className="flex flex-col gap-2">
          <legend className={cn(labelClass, 'mb-1.5')}>
            Оплачено {som(s.moneySom)} — оплаты не удаляются. Что сделать с деньгами?
          </legend>
          {fromAfterschool ? (
            <p className="text-xs font-bold text-ink-muted">{AFTERSCHOOL_NO_TRANSFER}</p>
          ) : (
            <Choice
              name={ids.choice}
              value="transfer"
              checked={money === 'transfer'}
              onChange={() => {
                setMoney('transfer')
                setError(null)
              }}
            >
              Перевести в правильную группу
            </Choice>
          )}
          {s.moneySom > 0 && (
            <Choice
              name={ids.choice}
              value="refund"
              checked={money === 'refund'}
              onChange={() => {
                setMoney('refund')
                setError(null)
              }}
            >
              Вернуть {som(s.moneySom)}
            </Choice>
          )}
          {money === 'transfer' && (
            <>
              <Field id={ids.group} label="Правильная группа">
                <NativeSelect
                  id={ids.group}
                  value={groupId}
                  onChange={(e) => {
                    setGroupId(e.target.value)
                    setTyped(null)
                    setError(null)
                  }}
                >
                  <option value="">Выберите группу</option>
                  {targets.map((g) => (
                    <option key={g.id} value={g.id}>
                      {targetLabel(g)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {target && (
                <Field id={ids.date} label="Зачислен в неё с">
                  <DateInput
                    id={ids.date}
                    className={inputClass}
                    value={date}
                    min={target.start_date}
                    max={target.end_date}
                    onChange={(v) => {
                      setTyped(v)
                      setError(null)
                    }}
                  />
                </Field>
              )}
            </>
          )}
          {money === 'refund' && <MethodPicker value={method} onChange={setMethod} />}
        </fieldset>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <SubmitButton variant="danger" pending={mutation.isPending}>
        Удалить зачисление
      </SubmitButton>
    </form>
  )
}
