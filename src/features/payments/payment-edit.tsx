// #92 · «⋯ → Изменить / Удалить» of a payment for the admin (Г9, Г10) — А7 «Журнал» and А6 «Платежи».
// Desktop: the «⋯» menu; phone: a tap on the card opens a sheet with the details and both buttons.
// The database decides and checks everything (0026); errors show under the form, no optimistic update.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { DateInput } from '@/components/ui/date-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { AUDIT_KEY } from '@/features/audit/api'
import { TEACHER_GROUPS_KEY } from '@/features/groups/teacher-api'
import { STUDENTS_KEY } from '@/features/students/api'
import { FormDialog } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { useNow } from '@/lib/now'
import { bishkekDate, formatDateRu } from '@/lib/time'
import { cn } from '@/lib/utils'
import { BALANCES_KEY, PAYMENT_METHODS, PAYMENTS_KEY, type PaymentRow } from './api'
import {
  deletePayment,
  deletePaymentForm,
  editPaymentForm,
  paymentImpactQuery,
  updatePayment,
} from './edit-api'
import { deleteImpact, deleteImpactText } from './edit-model'
import { formatPaidAt, METHOD_BUTTON, METHOD_LABEL, som } from './model'

export type PaymentAction = 'edit' | 'delete'

/** The row an action is about, with the names the dialogs show. */
export interface PaymentTarget {
  payment: PaymentRow
  studentId: string
  student: string
  /** «Математика · 8 класс А». */
  group: string
  /** «12 ур · 3 200». */
  package: string
}

/** Only payments and refunds — a transfer is undone with its transfer / «ушёл» (И41). */
export const isEditable = (p: Pick<PaymentRow, 'kind'>) => p.kind !== 'transfer'

const kindWord = (p: PaymentRow) => (p.kind === 'refund' ? 'Возврат' : 'Оплата')

export function PaymentMenu({
  label,
  onAction,
}: {
  label: string
  onAction: (action: PaymentAction) => void
}) {
  const [open, setOpen] = useState(false)
  const item =
    'flex min-h-11 items-center rounded-xl px-3 text-left text-sm font-bold hover:bg-muted'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Действия: ${label}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-muted"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-52 flex-col p-1.5">
        <button
          type="button"
          className={item}
          onClick={() => {
            setOpen(false)
            onAction('edit')
          }}
        >
          Изменить
        </button>
        <button
          type="button"
          className={cn(item, 'text-burned-strong')}
          onClick={() => {
            setOpen(false)
            onAction('delete')
          }}
        >
          Удалить
        </button>
      </PopoverContent>
    </Popover>
  )
}

/** Ученик · сумма · дата · способ · группа · абонемент. */
function Details({ target }: { target: PaymentTarget }) {
  const p = target.payment
  const rows: [string, string][] = [
    ['Ученик', target.student],
    ['Сумма', `${p.amount < 0 ? '− ' : ''}${som(Math.abs(p.amount))}`],
    ['Дата', formatPaidAt(p.paid_at)],
    ['Способ', p.method ? METHOD_LABEL[p.method] : 'перенос'],
    ['Группа', target.group],
    ['Абонемент', target.package],
  ]
  if (p.reason) rows.push([p.kind === 'refund' ? 'Причина возврата' : 'Комментарий', p.reason])
  return (
    <dl className="flex flex-col gap-1 rounded-[14px] bg-muted px-3.5 py-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3">
          <dt className="font-bold text-ink-muted">{k}</dt>
          <dd className="text-right font-extrabold break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Phone: a tap on a journal card — the details and «Изменить» / «Удалить». */
export function PaymentSheet({
  target,
  onOpenChange,
  onAction,
}: {
  target: PaymentTarget | null
  onOpenChange: (open: boolean) => void
  onAction: (action: PaymentAction) => void
}) {
  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto rounded-t-[20px] border-line bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex flex-col gap-1.5 pr-6">
          <SheetTitle className="font-display text-lg font-bold">
            {target ? kindWord(target.payment) : 'Оплата'}
          </SheetTitle>
          <SheetDescription className="text-sm font-bold text-ink-muted">
            {target?.payment.createdByName ? `Записал(а): ${target.payment.createdByName}` : ' '}
          </SheetDescription>
        </div>
        {target && <Details target={target} />}
        {target && (
          <Link
            to="/admin/students/$studentId"
            params={{ studentId: target.studentId }}
            className="flex min-h-11 items-center text-sm font-extrabold text-teal"
          >
            Карточка ученика
          </Link>
        )}
        {target && isEditable(target.payment) && (
          <div className="grid grid-cols-2 gap-2.5">
            <SubmitButton
              variant="outline"
              onClick={() => {
                onAction('edit')
              }}
            >
              Изменить
            </SubmitButton>
            <SubmitButton
              variant="danger"
              onClick={() => {
                onAction('delete')
              }}
            >
              Удалить
            </SubmitButton>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      [PAYMENTS_KEY, BALANCES_KEY, STUDENTS_KEY, TEACHER_GROUPS_KEY, AUDIT_KEY].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    )
}

/** «Удалить оплату» / «Изменить оплату» for the chosen row. */
export function PaymentEditDialogs({
  target,
  action,
  onClose,
}: {
  target: PaymentTarget | null
  action: PaymentAction | null
  onClose: () => void
}) {
  const p = target?.payment
  const refund = p?.kind === 'refund'
  return (
    <>
      <FormDialog
        open={target !== null && action === 'delete'}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        title={refund ? 'Удалить возврат?' : 'Удалить оплату?'}
        description="Запись с причиной останется в журнале изменений."
      >
        {target && action === 'delete' && (
          <DeleteForm key={target.payment.id} target={target} onDone={onClose} />
        )}
      </FormDialog>
      <FormDialog
        open={target !== null && action === 'edit'}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        title={refund ? 'Изменить возврат' : 'Изменить оплату'}
        description={target ? `${target.student} · ${target.group} · ${target.package}` : ''}
      >
        {target && action === 'edit' && (
          <EditForm key={target.payment.id} target={target} onDone={onClose} />
        )}
      </FormDialog>
    </>
  )
}

function DeleteForm({ target, onDone }: { target: PaymentTarget; onDone: () => void }) {
  const id = useId()
  const p = target.payment
  const invalidate = useInvalidate()
  const impact = useQuery(paymentImpactQuery(p.subscription.id))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const kind = p.kind === 'refund' ? 'refund' : 'payment'
  const effect = impact.data ? deleteImpact(impact.data, p.subscription.id, p.id, kind) : null

  const mutation = useMutation({
    mutationFn: deletePayment,
    onSuccess: async () => {
      await invalidate()
      toast.success(
        `${p.kind === 'refund' ? 'Возврат удалён' : 'Оплата удалена'}: ${target.student} · ${som(Math.abs(p.amount))}`,
      )
      onDone()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = deletePaymentForm.safeParse({ paymentId: p.id, reason })
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
      aria-label={p.kind === 'refund' ? 'Удалить возврат' : 'Удалить оплату'}
      className="flex flex-col gap-3.5"
    >
      <Details target={target} />
      {effect ? (
        <p
          role="status"
          data-testid="delete-impact"
          className="rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong"
        >
          {deleteImpactText(effect)}
        </p>
      ) : (
        impact.isPending && <div className="h-10 animate-pulse rounded-xl bg-muted" aria-hidden />
      )}
      <Field id={`${id}-reason`} label="Причина">
        <input
          id={`${id}-reason`}
          value={reason}
          maxLength={500}
          placeholder="обязательно, например «внесли дважды»"
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
          {p.kind === 'refund' ? 'Удалить возврат' : 'Удалить оплату'}
        </SubmitButton>
      </div>
    </form>
  )
}

function EditForm({ target, onDone }: { target: PaymentTarget; onDone: () => void }) {
  const id = useId()
  const p = target.payment
  const refund = p.kind === 'refund'
  const invalidate = useInvalidate()
  const today = bishkekDate(useNow())
  const [amount, setAmount] = useState(String(Math.abs(p.amount)))
  const [method, setMethod] = useState(p.method ?? 'cash')
  const [paidOn, setPaidOn] = useState(formatDateRu(bishkekDate(Date.parse(p.paid_at))))
  const [comment, setComment] = useState(p.reason ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: updatePayment,
    onSuccess: async () => {
      await invalidate()
      toast.success(refund ? 'Возврат изменён' : 'Оплата изменена')
      onDone()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = editPaymentForm(today, refund).safeParse({
      paymentId: p.id,
      amount,
      method,
      paidOn,
      comment,
      reason,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  const clear = () => {
    setError(null)
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={refund ? 'Изменить возврат' : 'Изменить оплату'}
      className="flex flex-col gap-3.5"
    >
      <Field id={`${id}-amount`} label={refund ? 'Сумма возврата, сом' : 'Сумма, сом'}>
        <input
          id={`${id}-amount`}
          inputMode="numeric"
          autoComplete="off"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            clear()
          }}
          className={cn(inputClass, 'font-display text-lg')}
        />
      </Field>
      <div
        role="radiogroup"
        aria-label="Способ"
        className="grid grid-cols-2 gap-1 rounded-xl border-[1.5px] border-line-strong p-[3px]"
      >
        {PAYMENT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => {
              setMethod(m)
              clear()
            }}
            className={cn(
              'min-h-11 rounded-[9px] text-sm',
              method === m ? 'bg-ink font-extrabold text-brand' : 'font-bold text-ink-muted',
            )}
          >
            {METHOD_BUTTON[m]}
          </button>
        ))}
      </div>
      <Field id={`${id}-date`} label="Дата">
        <DateInput
          id={`${id}-date`}
          value={paidOn}
          max={today}
          onChange={(v) => {
            setPaidOn(v)
            clear()
          }}
          className={inputClass}
        />
      </Field>
      <Field id={`${id}-comment`} label={refund ? 'Причина возврата' : 'Комментарий'}>
        <input
          id={`${id}-comment`}
          value={comment}
          maxLength={500}
          placeholder={refund ? 'обязательно' : 'необязательно'}
          onChange={(e) => {
            setComment(e.target.value)
            clear()
          }}
          className={inputClass}
        />
      </Field>
      <Field id={`${id}-reason`} label="Причина исправления">
        <input
          id={`${id}-reason`}
          value={reason}
          maxLength={500}
          placeholder="обязательно, например «ошиблись суммой»"
          onChange={(e) => {
            setReason(e.target.value)
            clear()
          }}
          className={inputClass}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <SubmitButton pending={mutation.isPending} className="min-h-12">
        Сохранить
      </SubmitButton>
    </form>
  )
}

/** State of the menu / sheet / dialogs on one screen. */
export function usePaymentEditor() {
  const [target, setTarget] = useState<PaymentTarget | null>(null)
  const [action, setAction] = useState<PaymentAction | 'details' | null>(null)
  const close = () => {
    setTarget(null)
    setAction(null)
  }
  return {
    open: (t: PaymentTarget, a: PaymentAction | 'details') => {
      setTarget(t)
      setAction(a)
    },
    dialogs: (
      <>
        <PaymentSheet
          target={action === 'details' ? target : null}
          onOpenChange={(open) => {
            if (!open) close()
          }}
          onAction={setAction}
        />
        <PaymentEditDialogs
          target={target}
          action={action === 'details' ? null : action}
          onClose={close}
        />
      </>
    ),
  }
}
