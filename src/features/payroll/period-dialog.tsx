// Б1б «Закрыть период» (docs/design/PayrollClose.dc.html, minimal — #94) and «Открыть период».
// Closing: admin or accountant, a month that is over; every lesson of it is locked (И77). Reopening:
// admin only, with a reason (the closed period is the one wall left — Кайрат 19.10).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { AUDIT_KEY } from '@/features/audit/api'
import { pluralRu } from '@/features/lessons/select'
import { FormDialog } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import { closePeriod, PAYROLL_KEY, reopenPeriod, reopenPeriodForm } from './api'
import { monthNom, monthTitle, payday, som, type PayrollView } from './model'

const LESSONS = ['занятие', 'занятия', 'занятий'] as const

function useInvalidate() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      [PAYROLL_KEY, AUDIT_KEY, 'lesson', 'group-lessons', 'admin-lessons', 'today-lessons'].map(
        (key) => queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    )
}

export function ClosePeriodDialog({
  month,
  view,
  open,
  onOpenChange,
}: {
  month: string
  view: PayrollView | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Закрыть период · ${monthTitle(month)}`}
      description="Суммы месяца станут окончательными. Открыть период снова может только администратор — с причиной."
    >
      {open && view && (
        <CloseForm
          month={month}
          view={view}
          onDone={() => {
            onOpenChange(false)
          }}
        />
      )}
    </FormDialog>
  )
}

function CloseForm({
  month,
  view,
  onDone,
}: {
  month: string
  view: PayrollView
  onDone: () => void
}) {
  const id = useId()
  const invalidate = useInvalidate()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: closePeriod,
    onSuccess: (locked) => {
      void invalidate()
      toast.success(
        `Период закрыт: ${monthNom(month).toLowerCase()} · ${locked} ${pluralRu(locked, LESSONS)} заблокировано`,
      )
      onDone()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (comment.trim().length > 500) {
      setError('Слишком длинный комментарий')
      return
    }
    setError(null)
    mutation.mutate({ month, comment })
  }

  const ok = view.unconfirmed === 0
  const check = 'flex items-start gap-2.5 text-[13px] font-bold'
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Закрыть период"
      className="flex flex-col gap-3.5"
    >
      <ul className="flex flex-col gap-2 rounded-xl bg-band px-3.5 py-3" aria-label="Проверка">
        <li className={cn(check, ok ? 'text-present-strong' : 'text-burned-deep')}>
          <span aria-hidden>{ok ? '✓' : '!'}</span>
          <span data-testid="close-unconfirmed">
            {ok
              ? 'Все занятия подтверждены'
              : `Не подтверждено ${view.unconfirmed} ${pluralRu(view.unconfirmed, LESSONS)} — после закрытия их не провести и в ЗП они не войдут`}
          </span>
        </li>
        <li className={cn(check, 'text-ink')}>
          <span aria-hidden>✓</span>
          <span>Авансы: {view.total.advances > 0 ? som(view.total.advances) : 'нет'}</span>
        </li>
        <li className={cn(check, 'text-ink')}>
          <span aria-hidden>✓</span>
          <span>
            Начислено {som(view.total.amount)} · к выплате {payday(month)} —{' '}
            <span className="font-extrabold">{som(view.total.toPay)}</span>
          </span>
        </li>
      </ul>
      <p className="rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong">
        Занятия месяца блокируются: отметки, исправления, авансы, праздники и перенос занятий —
        только после «Открыть период».
      </p>
      <Field id={`${id}-comment`} label="Комментарий">
        <input
          id={`${id}-comment`}
          value={comment}
          maxLength={500}
          placeholder="необязательно, например «сверено с Excel»"
          onChange={(e) => {
            setComment(e.target.value)
            setError(null)
          }}
          className={inputClass}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2.5">
        <SubmitButton variant="outline" onClick={onDone}>
          Не закрывать
        </SubmitButton>
        <SubmitButton pending={mutation.isPending}>Закрыть период</SubmitButton>
      </div>
    </form>
  )
}

export function ReopenPeriodDialog({
  month,
  open,
  onOpenChange,
}: {
  month: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Открыть период · ${monthTitle(month)}`}
      description="Занятия месяца снова можно править. Причина попадёт в журнал изменений; после правок закройте период снова."
    >
      {open && (
        <ReopenForm
          month={month}
          onDone={() => {
            onOpenChange(false)
          }}
        />
      )}
    </FormDialog>
  )
}

function ReopenForm({ month, onDone }: { month: string; onDone: () => void }) {
  const id = useId()
  const invalidate = useInvalidate()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: reopenPeriod,
    onSuccess: () => {
      void invalidate()
      toast.success(`Период открыт: ${monthNom(month).toLowerCase()}`)
      onDone()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = reopenPeriodForm.safeParse({ month, reason })
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
      aria-label="Открыть период"
      className="flex flex-col gap-3.5"
    >
      <Field id={`${id}-reason`} label="Причина">
        <input
          id={`${id}-reason`}
          value={reason}
          maxLength={500}
          placeholder="обязательно, например «забыли провести занятие»"
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
          Отмена
        </SubmitButton>
        <SubmitButton variant="danger" pending={mutation.isPending}>
          Открыть период
        </SubmitButton>
      </div>
    </form>
  )
}
