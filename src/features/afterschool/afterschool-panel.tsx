// А6 «График продлёнки» (#82, #111 К13) on the enrollment card: the student's plan and «Изменить с
// даты». The subscription is a package of days (the subscription block above, «Дней»); the plan only
// decides on which days the student is on the roster — it never changes the price.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { DateInput } from '@/components/ui/date-picker'
import { BALANCES_KEY } from '@/features/payments/api'
import { STUDENTS_KEY } from '@/features/students/api'
import { formatDayMonth } from '@/features/students/model'
import { FormDialog } from '@/features/students/parts'
import { formatSom } from '@/features/tariffs/model'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { formatDateRu, parseDateRu } from '@/lib/time'
import {
  AFTERSCHOOL_KEY,
  enrollmentPlanVersionsQuery,
  planPreviewQuery,
  setAfterschoolPlan,
} from './api'
import {
  formatPlan,
  formatRemovedMarks,
  monthAccusative,
  planOn,
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

const signedSom = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatSom(Math.abs(n))} сом`

export function AfterschoolPanel({ e, today }: { e: AfterschoolEnrollment; today: string }) {
  const query = useQuery(enrollmentPlanVersionsQuery(e.enrollmentId))
  const [editing, setEditing] = useState(false)

  if (query.isPending) return <div className="h-20 animate-pulse rounded-[14px] bg-muted" />
  if (query.isError) {
    return (
      <p role="alert" className="text-sm font-bold text-burned">
        Не удалось загрузить график продлёнки
      </p>
    )
  }
  const plans = query.data
  const current = planOn(plans, today)
  const latest = plans.at(-1)

  return (
    <div
      aria-label="График продлёнки"
      className="flex flex-col gap-1.5 rounded-[14px] bg-muted px-4 py-3"
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
        {current ? formatPlan(current) : 'Графика нет — все дни группы'}
        {latest && latest.valid_from > today && (
          <span className="block text-xs font-bold text-ink-muted">
            с {formatDayMonth(latest.valid_from)}: {formatPlan(latest.hours)}
          </span>
        )}
      </p>
      <p className="text-xs font-bold text-ink-muted">
        Определяет, в какие дни ученик в составе занятия; на цену не влияет
      </p>
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
  // a date in the past (Каныкей enters a month afterwards): the marks of the days that become 0 h go
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
      description={`${e.groupLabel} · с выбранной даты ученик в составе занятий по новому графику; цена абонемента не меняется`}
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
              Удалится {formatRemovedMarks(preview.data.marks, preview.data.weekdays)} с{' '}
              {formatDayMonth(iso)} — в эти дни по графику 0 ч
            </p>
            {preview.data.payroll
              .filter((p) => p.amount !== 0)
              .map((p) => (
                <p key={`${p.teacherName}|${p.month}`} className="text-ink-muted">
                  {p.teacherName} {signedSom(p.amount)} за {monthAccusative(p.month)}
                </p>
              ))}
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
