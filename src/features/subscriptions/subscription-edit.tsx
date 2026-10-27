import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState, type SubmitEvent } from 'react'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import {
  editableSubscriptionQuery,
  subscriptionEditForm,
  subscriptionEditPreviewQuery,
  updateSubscription,
  type EditableSubscription,
} from './edit-api'
import { balanceLine, payrollLine, termsCaption } from './edit-model'

// #109 · «Изменить абонемент» (К12, И90) — the «⋯» of an enrollment on А6 and on the group page:
// size and price of its newest live package with a reason; under the form the database's preview —
// the teacher's payroll and the student's balance «было → станет». Payroll follows by К6.

const toNumber = (v: string) => (/^\d+$/.test(v) ? Number(v) : Number.NaN)

/** Waits `ms` after the last change — the preview is not asked on every keystroke. */
function useSettled<T>(value: T, ms = 350): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => {
      setSettled(value)
    }, ms)
    return () => {
      clearTimeout(t)
    }
  }, [value, ms])
  return settled
}

export function SubscriptionEditBody({
  enrollmentId,
  onDone,
}: {
  enrollmentId: string
  onDone: (message: string) => void
}) {
  const sub = useQuery(editableSubscriptionQuery(enrollmentId))
  if (sub.isPending) {
    return <div className="h-24 animate-pulse rounded-xl bg-muted" aria-label="Загрузка" />
  }
  if (sub.isError) return <ErrorText>{sub.error.message}</ErrorText>
  if (!sub.data) {
    return <p className="text-sm font-bold text-ink-muted">У зачисления нет абонемента.</p>
  }
  if (sub.data.hours_total !== null) {
    return (
      <p
        role="status"
        className="rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong"
      >
        Счёт продлёнки по часам так не меняется — он считается по графику и цене часа.
      </p>
    )
  }
  return <EditForm sub={sub.data} onDone={onDone} />
}

function EditForm({
  sub,
  onDone,
}: {
  sub: EditableSubscription
  onDone: (message: string) => void
}) {
  const id = useId()
  const [lessonsText, setLessonsText] = useState(String(sub.lessons_total))
  const [priceText, setPriceText] = useState(String(sub.price_full))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lessons = toNumber(lessonsText)
  const price = toNumber(priceText)
  const max = 2 * sub.tariff.lessons_in_package
  const lessonsOk = Number.isInteger(lessons) && lessons >= 1 && lessons <= max
  const priceOk = Number.isInteger(price) && price >= 1 && price <= 1_000_000
  const changed = lessons !== sub.lessons_total || price !== sub.price_full
  const asked = useSettled({ lessons, price })
  const preview = useQuery({
    ...subscriptionEditPreviewQuery(sub.id, asked.lessons, asked.price),
    enabled: lessonsOk && priceOk && changed,
    placeholderData: keepPreviousData,
  })

  const mutation = useMutation({
    mutationFn: updateSubscription,
    onSuccess: (_, input) => {
      onDone(`Абонемент изменён: ${termsCaption(input.lessons, input.price)} сом`)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!lessonsOk) {
      setError(`Уроков в абонементе — от 1 до ${max}`)
      return
    }
    if (!changed) {
      setError('Размер и цена не изменились')
      return
    }
    const parsed = subscriptionEditForm.safeParse({ lessons, price, reason })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    setError(null)
    mutation.mutate({ id: sub.id, ...parsed.data })
  }

  const p = preview.data
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Изменить абонемент"
      className="flex flex-col gap-3.5"
    >
      <p className="text-sm font-bold text-ink-muted">
        Сейчас: {termsCaption(sub.lessons_total, sub.price_full)} сом
        {sub.discount_percent > 0 ? ` · скидка ${sub.discount_percent} % от новой цены` : ''}
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        <Field id={`${id}-lessons`} label="Уроков">
          <input
            id={`${id}-lessons`}
            inputMode="numeric"
            autoComplete="off"
            value={lessonsText}
            onChange={(e) => {
              setLessonsText(e.target.value.replace(/\s/g, ''))
              setError(null)
            }}
            aria-invalid={!lessonsOk || undefined}
            className={cn(inputClass, 'tabular-nums', !lessonsOk && 'border-burned-strong')}
          />
        </Field>
        <Field id={`${id}-price`} label="Цена, сом">
          <input
            id={`${id}-price`}
            inputMode="numeric"
            autoComplete="off"
            value={priceText}
            onChange={(e) => {
              setPriceText(e.target.value.replace(/\s/g, ''))
              setError(null)
            }}
            aria-invalid={!priceOk || undefined}
            className={cn(inputClass, 'tabular-nums', !priceOk && 'border-burned-strong')}
          />
        </Field>
      </div>

      <section
        aria-label="Что изменится"
        role="status"
        className="flex flex-col gap-1.5 rounded-[14px] bg-muted px-4 py-3 text-sm font-bold"
      >
        {!changed ? (
          <p className="text-ink-muted">Измените размер или цену — здесь будет, что изменится.</p>
        ) : !lessonsOk || !priceOk ? (
          <p className="text-ink-muted">Уроков — от 1 до {max}, цена — от 1 сом.</p>
        ) : preview.isError ? (
          <ErrorText>{preview.error.message}</ErrorText>
        ) : !p ? (
          <div className="h-10 animate-pulse rounded-xl bg-card" aria-label="Считаем" />
        ) : (
          <>
            {p.payroll.length === 0 ? (
              <p className="text-ink-muted">ЗП учителя не изменится — проведённых уроков нет.</p>
            ) : (
              <ul aria-label="ЗП учителя" className="flex flex-col gap-1">
                {p.payroll.map((r) => (
                  <li key={`${r.teacherId}|${r.month}`}>{payrollLine(r)}</li>
                ))}
              </ul>
            )}
            {p.balance && (
              <div className="flex flex-col gap-0.5 border-t border-line-strong pt-1.5">
                <span className="text-xs text-ink-muted">
                  Было: {balanceLine(p.balance.before)}
                </span>
                <span>Станет: {balanceLine(p.balance.after)}</span>
              </div>
            )}
          </>
        )}
      </section>

      <Field id={`${id}-reason`} label="Причина">
        <input
          id={`${id}-reason`}
          value={reason}
          maxLength={500}
          placeholder="обязательно, например «12 часов = 8 занятий по 1,5 ч»"
          onChange={(e) => {
            setReason(e.target.value)
            setError(null)
          }}
          className={inputClass}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <SubmitButton pending={mutation.isPending}>Сохранить</SubmitButton>
    </form>
  )
}
