// «Выдать аванс» and the advances history of a teacher on Б1 (#83, А8; Б2а PayrollAdjustment.dc.html).
// Admin and accountant issue; a mistaken entry is deleted with a reason while the month is open.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { DateInput } from '@/components/ui/date-picker'
import { FormDialog, NativeSelect } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { formatSom } from '@/features/tariffs/model'
import { formatDateRu, parseDateRu } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  advanceForm,
  deleteAdjustment,
  deleteAdjustmentForm,
  issueAdvance,
  PAYROLL_KEY,
} from './api'
import {
  adjustmentCaption,
  advanceMonths,
  minusSom,
  monthNom,
  monthOf,
  monthTitle,
  payday,
  som,
  toPayCaption,
  type Adjustment,
} from './model'

/** The teacher the dialog is about, with her numbers of the page month. */
export interface AdvanceTarget {
  teacherId: string
  name: string
  /** Page month `YYYY-MM`, its accrual and advances. */
  month: string
  amount: number
  advances: number
}

const parseAmount = (v: string) => {
  const digits = v.replace(/\s/g, '')
  return /^\d+$/.test(digits) ? Number(digits) : null
}

export function AdvanceDialog({
  target,
  today,
  onOpenChange,
}: {
  target: AdvanceTarget | null
  today: string
  onOpenChange: (open: boolean) => void
}) {
  return (
    <FormDialog
      open={target !== null}
      onOpenChange={onOpenChange}
      title={target ? `Аванс · ${target.name}` : 'Аванс'}
      description="Вычитается из выплаты 15-го. Учитель сразу увидит запись в «Моём месяце»."
    >
      {target && (
        <AdvanceForm
          key={target.teacherId}
          target={target}
          today={today}
          onDone={() => {
            onOpenChange(false)
          }}
        />
      )}
    </FormDialog>
  )
}

function AdvanceForm({
  target,
  today,
  onDone,
}: {
  target: AdvanceTarget
  today: string
  onDone: () => void
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [issuedOn, setIssuedOn] = useState(formatDateRu(today))
  const [month, setMonth] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  // А8: the month of the issue date unless one is picked.
  const issuedIso = parseDateRu(issuedOn) ?? today
  const months = advanceMonths(issuedIso)
  const chosen = month && months.includes(month) ? month : monthOf(issuedIso)
  const value = parseAmount(amount)

  const mutation = useMutation({
    mutationFn: issueAdvance,
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: [PAYROLL_KEY] })
      toast.success(
        `Аванс ${som(input.amount)} · ${target.name.split(' ')[0] ?? ''} · в счёт ЗП за ${monthNom(input.month).toLowerCase()}`,
      )
      onDone()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = advanceForm(today).safeParse({
      teacherId: target.teacherId,
      amount,
      issuedOn,
      month: chosen,
      comment,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  // The preview is of the page month; another month chosen — only the amount is shown.
  const samePage = chosen === target.month
  const after = target.advances + (value ?? 0)
  const pay = toPayCaption(target.amount - after)

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Выдать аванс"
      className="flex flex-col gap-3.5"
    >
      <Field id={`${id}-amount`} label="Сумма, сом">
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
      <div className="grid grid-cols-2 gap-2.5">
        <Field id={`${id}-date`} label="Дата выдачи">
          <DateInput
            id={`${id}-date`}
            value={issuedOn}
            max={today}
            onChange={(v) => {
              setIssuedOn(v)
              setError(null)
            }}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-month`} label="В счёт ЗП за">
          <NativeSelect
            id={`${id}-month`}
            value={chosen}
            onChange={(e) => {
              setMonth(e.target.value)
            }}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthTitle(m)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field id={`${id}-comment`} label="Комментарий">
        <input
          id={`${id}-comment`}
          value={comment}
          placeholder="необязательно"
          onChange={(e) => {
            setComment(e.target.value)
            setError(null)
          }}
          className={inputClass}
        />
      </Field>

      {samePage && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-band px-3.5 py-3 text-[13px] font-bold">
          <div className="flex justify-between gap-3">
            <span className="text-ink-muted">Начислено за {monthNom(chosen).toLowerCase()}</span>
            <span className="whitespace-nowrap">{som(target.amount)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-ink-muted">Авансы с этим</span>
            <span className="whitespace-nowrap">{minusSom(after)}</span>
          </div>
          <div className="flex justify-between gap-3 text-sm font-extrabold">
            <span>К выплате {payday(chosen)}</span>
            <span
              className={cn('whitespace-nowrap', pay.overpaid && 'text-burned-strong')}
              data-testid="advance-preview-to-pay"
            >
              {pay.text}
            </span>
          </div>
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <SubmitButton pending={mutation.isPending} className="min-h-12">
        {`Выдать аванс ${value ? minusSom(value) : ''}`.trim()}
      </SubmitButton>
    </form>
  )
}

/** The teacher's advances of the month (Б1 row expansion): date · author, comment, amount, delete. */
export function AdvancesList({
  adjustments,
  onDelete,
}: {
  adjustments: Adjustment[]
  onDelete: (a: Adjustment) => void
}) {
  if (adjustments.length === 0) {
    return <p className="text-[13px] font-bold text-ink-muted">Авансов за месяц нет</p>
  }
  return (
    <ul className="flex flex-col" aria-label="Авансы">
      {adjustments.map((a) => (
        <li
          key={a.id}
          className="flex items-center gap-3 border-b border-line py-2 last:border-b-0"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[13px] font-extrabold">{adjustmentCaption(a)}</span>
            {a.comment && (
              <span className="text-xs font-bold break-words text-ink-muted">{a.comment}</span>
            )}
          </span>
          <span className="font-display text-sm font-bold whitespace-nowrap">
            {minusSom(a.amount)}
          </span>
          <button
            type="button"
            onClick={() => {
              onDelete(a)
            }}
            aria-label={`Удалить аванс ${formatSom(a.amount)} сом`}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:text-burned-strong"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** «Удалить аванс» — a mistaken entry, with a reason (goes to the journal). */
export function DeleteAdvanceDialog({
  adjustment,
  name,
  onOpenChange,
}: {
  adjustment: Adjustment | null
  name: string
  onOpenChange: (open: boolean) => void
}) {
  return (
    <FormDialog
      open={adjustment !== null}
      onOpenChange={onOpenChange}
      title="Удалить аванс?"
      description={
        adjustment
          ? `${name} · ${adjustmentCaption(adjustment)} · ${som(adjustment.amount)}. Запись с причиной останется в журнале изменений.`
          : ''
      }
    >
      {adjustment && (
        <DeleteAdvanceForm
          key={adjustment.id}
          adjustment={adjustment}
          onDone={() => {
            onOpenChange(false)
          }}
        />
      )}
    </FormDialog>
  )
}

function DeleteAdvanceForm({ adjustment, onDone }: { adjustment: Adjustment; onDone: () => void }) {
  const id = useId()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: deleteAdjustment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [PAYROLL_KEY] })
      toast.success(`Аванс ${som(adjustment.amount)} удалён`)
      onDone()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = deleteAdjustmentForm.safeParse({ id: adjustment.id, reason })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Укажите причину')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Удалить аванс"
      className="flex flex-col gap-3.5"
    >
      <Field id={`${id}-reason`} label="Причина">
        <input
          id={`${id}-reason`}
          value={reason}
          placeholder="обязательно"
          onChange={(e) => {
            setReason(e.target.value)
            setError(null)
          }}
          className={inputClass}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2.5">
        <SubmitButton variant="outline" onClick={onDone}>
          Не удалять
        </SubmitButton>
        <SubmitButton variant="danger" pending={mutation.isPending}>
          Удалить
        </SubmitButton>
      </div>
    </form>
  )
}
