import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { GROUPS_KEY } from '@/features/groups/api'
import { BALANCES_KEY } from '@/features/payments/api'
import { STUDENTS_KEY } from '@/features/students/api'
import { formatDayMonth } from '@/features/students/model'
import { FormDialog } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { maskDateInput } from '@/lib/date-input'
import { formatDateRu, parseDateRu } from '@/lib/time'
import { setEnrollmentStart } from './api'

/**
 * «Изменить дату зачисления» (А6, #60): within the group dates — e.g. September filled in after the
 * fact; the subscription that started on the old date follows.
 */
export function EnrollmentStartDialog({
  open,
  onOpenChange,
  enrollmentId,
  groupLabel,
  startDate,
  groupStart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  enrollmentId: string
  groupLabel: string
  startDate: string
  /** groups.start_date — the earliest date allowed. */
  groupStart: string | null
}) {
  const ids = { date: useId(), hint: useId() }
  const queryClient = useQueryClient()
  const [date, setDate] = useState(formatDateRu(startDate))
  const [error, setError] = useState<string | null>(null)
  const iso = parseDateRu(date)
  const tooEarly = iso !== null && groupStart !== null && iso < groupStart

  const mutation = useMutation({
    mutationFn: (value: string) => setEnrollmentStart(enrollmentId, value),
    onSuccess: async (_, value) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: STUDENTS_KEY }),
        queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] }),
        queryClient.invalidateQueries({ queryKey: GROUPS_KEY }),
      ])
      toast.success(`Зачисление — с ${formatDayMonth(value)}`)
      onOpenChange(false)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!iso) {
      setError('Дата в формате ДД.ММ.ГГГГ')
      return
    }
    if (tooEarly) {
      setError('Дата — вне дат группы (раньше старта группы)')
      return
    }
    if (iso === startDate) {
      onOpenChange(false)
      return
    }
    setError(null)
    mutation.mutate(iso)
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Дата зачисления"
      description={`${groupLabel} · абонемент, начатый в день зачисления, перенесётся вместе с ней`}
    >
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Дата зачисления"
        className="flex flex-col gap-3.5"
      >
        <Field id={ids.date} label="Зачислен с">
          <input
            id={ids.date}
            className={inputClass}
            inputMode="numeric"
            placeholder="ДД.ММ.ГГГГ"
            autoComplete="off"
            value={date}
            aria-invalid={tooEarly || undefined}
            aria-describedby={groupStart ? ids.hint : undefined}
            onChange={(e) => {
              setDate(maskDateInput(e.target.value))
            }}
          />
        </Field>
        {groupStart && (
          <p id={ids.hint} className="-mt-2 text-xs font-bold text-ink-muted">
            Можно задним числом, не раньше старта группы — {formatDateRu(groupStart)}
          </p>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>Сохранить</SubmitButton>
      </form>
    </FormDialog>
  )
}
