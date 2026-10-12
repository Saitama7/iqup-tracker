import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { ADMIN_LESSONS_KEY } from '@/features/schedule/api'
import type { GroupBrief } from '@/features/students/model'
import { FormDialog, NativeSelect } from '@/features/students/parts'
import { EnrollDialog } from '@/features/subscriptions/enroll-dialog'
import type { DiscountHistory } from '@/features/subscriptions/model'
import { ErrorText, Field, SubmitButton } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import {
  closeTrial,
  enrollTrial,
  groupLessonsQuery,
  markTrial,
  rebookTrial,
  TRIALS_KEY,
} from './api'
import {
  enrollStartDefault,
  lessonOptionLabel,
  trialGroupLabel,
  trialWhen,
  type Trial,
} from './model'

// Shared by А11, А4 (admin) and У3 / УД2 (teacher). Violet dashed = trial (Ж4), never red.

export const trialChipClass =
  'inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-trial px-2.5 py-0.5 text-xs leading-[1.3] font-extrabold whitespace-nowrap text-trial-strong'

/** «пробный» / «вся группа» chip (А11, А4, У2, УД2). */
export function TrialChip({
  children = 'пробный',
  className,
}: {
  children?: string
  className?: string
}) {
  return <span className={cn(trialChipClass, className)}>{children}</span>
}

/** After any write: every trials query + А1/А2 cells; an enrollment refreshes everything (students, groups, balances). */
function useInvalidateTrials() {
  const queryClient = useQueryClient()
  return async (enrolled = false) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [TRIALS_KEY] }),
      queryClient.invalidateQueries({ queryKey: [ADMIN_LESSONS_KEY] }),
      ...(enrolled ? [queryClient.invalidateQueries()] : []),
    ])
  }
}

/** «Был / Не пришёл» (teacher, Ж3) — writes trials.status only, never confirm_lesson. */
export function useMarkTrial() {
  const invalidate = useInvalidateTrials()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'attended' | 'no_show' }) =>
      markTrial(id, status),
    onSuccess: () => invalidate(),
    onError: (e) => {
      toast.error(e.message)
    },
  })
}

/** «Отказ» / «Закрыть» (admin). */
export function useCloseTrial() {
  const invalidate = useInvalidateTrials()
  return useMutation({
    mutationFn: (t: Trial) => closeTrial(t.id),
    onSuccess: async (_, t) => {
      await invalidate()
      toast.success(`${t.full_name}: пробное закрыто`)
    },
    onError: (e) => {
      toast.error(e.message)
    },
  })
}

/**
 * «Перенести» (scheduled) / «Записать заново» (no_show, Ж8): another planned lesson of the same
 * group, today or later.
 */
export function RebookDialog({
  trial,
  today,
  onOpenChange,
}: {
  trial: Trial
  today: string
  onOpenChange: (open: boolean) => void
}) {
  const id = useId()
  const invalidate = useInvalidateTrials()
  const lessons = useQuery(groupLessonsQuery(trial.group_id, today))
  const options = (lessons.data ?? []).filter((l) => l.id !== trial.lesson_id)
  const [lessonId, setLessonId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const again = trial.status !== 'scheduled'
  const title = again ? 'Записать заново' : 'Перенести пробное'

  const mutation = useMutation({
    mutationFn: () => rebookTrial(trial.id, lessonId),
    onSuccess: async () => {
      await invalidate()
      toast.success(`${trial.full_name}: записан(а) на другое занятие`)
      onOpenChange(false)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!lessonId) {
      setError('Выберите занятие')
      return
    }
    setError(null)
    mutation.mutate()
  }

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={title}
      description={`${trial.full_name} · ${trialGroupLabel(trial.group)} · было ${trialWhen(trial.lessonDate, trial.lessonStart, today).toLowerCase()}`}
    >
      <form onSubmit={onSubmit} noValidate aria-label={title} className="flex flex-col gap-3.5">
        <Field id={id} label="Занятие">
          <NativeSelect
            id={id}
            value={lessonId}
            onChange={(e) => {
              setLessonId(e.target.value)
              setError(null)
            }}
          >
            <option value="">
              {lessons.isPending ? 'Загружаем занятия…' : 'Выберите занятие'}
            </option>
            {options.map((l) => (
              <option key={l.id} value={l.id}>
                {lessonOptionLabel(l.date, l.start, today)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {lessons.isSuccess && options.length === 0 && (
          <p className="text-sm font-bold text-ink-muted">
            У группы нет запланированных занятий впереди
          </p>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>{title}</SubmitButton>
      </form>
    </FormDialog>
  )
}

/**
 * «Оплатил → зачислить» (Ж5): the enrollment dialog of А4/А6 with the trial's pupil and group; the
 * start date defaults to the group's next lesson after the trial (the trial stays free, §7 #17).
 */
export function EnrollTrialDialog({
  trial,
  group,
  history,
  today,
  onOpenChange,
}: {
  trial: Trial
  group: GroupBrief
  /** Discounts of an existing student (А6); a lead has none. */
  history?: DiscountHistory
  today: string
  onOpenChange: (open: boolean) => void
}) {
  const invalidate = useInvalidateTrials()
  const lessons = useQuery(groupLessonsQuery(trial.group_id, today))
  if (lessons.isPending) return null
  const start = enrollStartDefault(trial.lessonDate, lessons.data ?? [], today)
  return (
    <EnrollDialog
      open
      onOpenChange={onOpenChange}
      student={{
        // a lead has no student row yet: enroll_trial creates it, the id here is only for the form
        id: trial.student_id ?? trial.id,
        fullName: trial.full_name,
        ...(history ?? { isReturning: false, subscriptions: [], friendsBrought: 0 }),
      }}
      groups={[group]}
      groupId={group.id}
      today={today}
      startDate={start}
      description={`${trial.full_name} · был(а) на пробном · абонемент со следующего занятия`}
      submit={(input) =>
        enrollTrial({ trialId: trial.id, startDate: input.startDate, discount: input.discount })
      }
      onEnrolled={() => {
        void invalidate(true)
      }}
    />
  )
}
