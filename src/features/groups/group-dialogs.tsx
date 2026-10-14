import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type ReactNode, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { STUDENTS_KEY } from '@/features/students/api'
import { firstName, formatDayMonth, formatLessonWhen } from '@/features/students/model'
import { FormDialog, NativeSelect } from '@/features/students/parts'
import { ErrorText, Field, inputClass, labelClass, SubmitButton } from '@/features/tariffs/parts'
import { DateInput } from '@/components/ui/date-picker'
import { maskTimeInput } from '@/lib/date-input'
import { formatDateRu, parseDateRu } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  archiveGroup,
  cancelLesson,
  createExtraLesson,
  extraLessonForm,
  GROUPS_KEY,
  lessonsKey,
  rescheduleForm,
  rescheduleGroup,
  setGroupStart,
  setGroupStatus,
  setSubstitute,
} from './api'
import {
  CANCEL_REASON_LABEL,
  currentRules,
  extraLessonDateError,
  groupStartNote,
  horizon,
  MANUAL_CANCEL_REASONS,
  planLessonDates,
  type GroupRow,
  type LessonRow,
  type TeacherRow,
} from './model'
import { GroupTeacherSection } from './group-teacher-section'
import { Segmented, WeekdayPicker } from './parts'
import { TEACHER_GROUPS_KEY } from './teacher-api'
import { changeGroupTeacher } from './undo-api'

// А4 actions. Every write is an RPC / RLS-checked update; the dialogs only collect input.

function useGroupMutation<T>(groupId: string, fn: (input: T) => Promise<unknown>, done: string) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: lessonsKey(groupId) }),
        queryClient.invalidateQueries({ queryKey: GROUPS_KEY }),
        queryClient.invalidateQueries({ queryKey: STUDENTS_KEY }),
        queryClient.invalidateQueries({ queryKey: [TEACHER_GROUPS_KEY] }),
      ])
      toast.success(done)
    },
    onError: (e) => {
      setError(e.message)
    },
  })
  return { mutation, error, setError }
}

const CANCEL_HINT: Record<(typeof MANUAL_CANCEL_REASONS)[number], string> = {
  center: 'праздник вне списка, нет света',
  teacher: 'заболел, без штрафа',
  all_frozen: 'все предупредили заранее',
}

/** «Отменить» (А5.1, А6): not paid, no lessons consumed, made up by an extra lesson. */
export function CancelLessonDialog({
  open,
  onOpenChange,
  groupId,
  lesson,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  lesson: LessonRow
}) {
  const id = useId()
  const [reason, setReason] = useState<(typeof MANUAL_CANCEL_REASONS)[number] | null>(null)
  const [comment, setComment] = useState('')
  const { mutation, error, setError } = useGroupMutation(
    groupId,
    (r: (typeof MANUAL_CANCEL_REASONS)[number]) => cancelLesson(lesson.id, r, comment),
    'Занятие отменено',
  )

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!reason) {
      setError('Выберите причину')
      return
    }
    mutation.mutate(reason, {
      onSuccess: () => {
        onOpenChange(false)
      },
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Отменить занятие"
      description={`${formatLessonWhen(lesson.lesson_date, lesson.planned_start)} · не оплачивается и не списывает уроки, восполняется доп. уроком`}
    >
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Отменить занятие"
        className="flex flex-col gap-3.5"
      >
        <div className="flex flex-col gap-1.5">
          <span id={`${id}-reason`} className={labelClass}>
            Причина
          </span>
          <div role="radiogroup" aria-labelledby={`${id}-reason`} className="flex flex-col gap-1.5">
            {MANUAL_CANCEL_REASONS.map((r) => {
              const on = reason === r
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setReason(r)
                    setError(null)
                  }}
                  className={cn(
                    'flex min-h-12 flex-col items-start justify-center rounded-xl border-[1.5px] px-3.5 py-2 text-left',
                    on ? 'border-ink bg-ink text-brand' : 'border-line-strong bg-card text-ink',
                  )}
                >
                  <span className="text-sm font-extrabold">
                    {CANCEL_REASON_LABEL[r][0]?.toUpperCase()}
                    {CANCEL_REASON_LABEL[r].slice(1)}
                  </span>
                  <span
                    className={cn('text-xs font-bold', on ? 'text-paper/75' : 'text-ink-muted')}
                  >
                    {CANCEL_HINT[r]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <Field id={`${id}-comment`} label="Комментарий">
          <input
            id={`${id}-comment`}
            className={inputClass}
            placeholder="Необязательно"
            autoComplete="off"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value)
            }}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>Отменить занятие</SubmitButton>
      </form>
    </FormDialog>
  )
}

/** «Доп. урок» (Б3, В3): date and time set by the admin, optionally making up a cancelled lesson. */
export function ExtraLessonDialog({
  open,
  onOpenChange,
  group,
  lessons,
  makesUpFor,
  today,
  minDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: Pick<GroupRow, 'id' | 'schedule_rules'>
  lessons: readonly LessonRow[]
  makesUpFor?: string
  today: string
  /** Earliest date allowed — a teacher's dialog passes today (И16); the admin has no limit. */
  minDate?: string
}) {
  const ids = { link: useId(), date: useId(), time: useId(), hint: useId() }
  const madeUp = new Set(lessons.flatMap((l) => l.makes_up_for_lesson_id ?? []))
  const cancelled = lessons.filter((l) => l.status === 'cancelled' && !madeUp.has(l.id))
  const defaultTime = currentRules(group.schedule_rules, today)[0]?.start_time.slice(0, 5) ?? ''
  const [link, setLink] = useState(makesUpFor ?? '')
  const [date, setDate] = useState(formatDateRu(today))
  const [time, setTime] = useState(defaultTime)
  const tooEarly = extraLessonDateError(parseDateRu(date), minDate) !== null
  const { mutation, error, setError } = useGroupMutation(
    group.id,
    (input: Parameters<typeof createExtraLesson>[1]) => createExtraLesson(group.id, input),
    'Доп. урок добавлен',
  )

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = extraLessonForm.safeParse({ date, time, makesUpFor: link })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    const dateError = extraLessonDateError(parsed.data.date, minDate)
    if (dateError) {
      setError(dateError)
      return
    }
    setError(null)
    mutation.mutate(parsed.data, {
      onSuccess: () => {
        onOpenChange(false)
      },
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Доп. урок"
      description="Обычное занятие: оплачивается и списывает уроки, когда проведено"
    >
      <form onSubmit={onSubmit} noValidate aria-label="Доп. урок" className="flex flex-col gap-3.5">
        <Field id={ids.link} label="Восполняет">
          <NativeSelect
            id={ids.link}
            value={link}
            onChange={(e) => {
              setLink(e.target.value)
            }}
          >
            <option value="">Без привязки — отработка заморозок</option>
            {cancelled.map((l) => (
              <option key={l.id} value={l.id}>
                {formatLessonWhen(l.lesson_date, l.planned_start)}
                {l.cancel_reason ? ` · ${CANCEL_REASON_LABEL[l.cancel_reason]}` : ''}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field id={ids.date} label="Дата">
            <DateInput
              id={ids.date}
              className={inputClass}
              value={date}
              min={minDate}
              aria-invalid={tooEarly || undefined}
              aria-describedby={minDate ? ids.hint : undefined}
              onChange={(v) => {
                setDate(v)
              }}
            />
          </Field>
          <Field id={ids.time} label="Время">
            <input
              id={ids.time}
              className={inputClass}
              inputMode="numeric"
              placeholder="ЧЧ:ММ"
              autoComplete="off"
              value={time}
              onChange={(e) => {
                setTime(maskTimeInput(e.target.value))
              }}
            />
          </Field>
        </div>
        {minDate && (
          <p
            id={ids.hint}
            className={cn('text-xs font-bold', tooEarly ? 'text-burned' : 'text-ink-muted')}
          >
            Не раньше сегодняшнего дня — {formatDateRu(minDate)}
          </p>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>Добавить доп. урок</SubmitButton>
      </form>
    </FormDialog>
  )
}

/** «Замена учителя» — who actually taught; payroll stays with the group's teacher (А7). */
export function SubstituteDialog({
  open,
  onOpenChange,
  group,
  lesson,
  teachers,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: GroupRow
  lesson: LessonRow
  teachers: readonly TeacherRow[]
}) {
  const id = useId()
  const [teacherId, setTeacherId] = useState(lesson.substitute_teacher_id ?? '')
  const { mutation, error } = useGroupMutation(
    group.id,
    (value: string) => setSubstitute(lesson.id, value || null),
    'Замена сохранена',
  )

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    mutation.mutate(teacherId, {
      onSuccess: () => {
        onOpenChange(false)
      },
    })
  }

  const main = group.teacher ? firstName(group.teacher.full_name) : 'основному учителю'
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Замена учителя"
      description={`${formatLessonWhen(lesson.lesson_date, lesson.planned_start)} · для истории: ЗП за занятие всё равно начисляется ${main}`}
    >
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Замена учителя"
        className="flex flex-col gap-3.5"
      >
        <Field id={id} label="Фактически вёл">
          <NativeSelect
            id={id}
            value={teacherId}
            onChange={(e) => {
              setTeacherId(e.target.value)
            }}
          >
            <option value="">Без замены</option>
            {teachers
              .filter((t) => t.id !== group.teacher_id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
          </NativeSelect>
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>Сохранить</SubmitButton>
      </form>
    </FormDialog>
  )
}

const sameDays = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort().every((d, i) => d === [...b].sort()[i])

/**
 * «Изменить» (А4): the group start (may be in the past, #60 — set_group_start generates the lessons
 * of the new stretch), status forming ↔ active, and the schedule from a date (today or later) —
 * reschedule_group closes the old rules, removes not-yet-started planned lessons by them and
 * generates the new ones. Two dates, two boxes: the start above, the schedule's date inside
 * «Новое расписание», so they are not mixed up.
 */
export function EditGroupDialog({
  open,
  onOpenChange,
  group,
  holidays,
  today,
  teachers,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: GroupRow
  holidays: readonly string[]
  today: string
  teachers: readonly TeacherRow[]
  /** «Удалить группу» (#73) — the page closes this dialog and opens the confirmation. */
  onDelete: () => void
}) {
  const ids = {
    start: useId(),
    startHint: useId(),
    days: useId(),
    time: useId(),
    from: useId(),
    fromHint: useId(),
  }
  const queryClient = useQueryClient()
  const rules = currentRules(group.schedule_rules, today)
  const initialDays = [...new Set(rules.map((r) => r.weekday))].sort()
  const initialTime = rules[0]?.start_time.slice(0, 5) ?? ''
  const [start, setStart] = useState(formatDateRu(group.start_date))
  const [status, setStatus] = useState<'forming' | 'active'>(
    group.status === 'forming' ? 'forming' : 'active',
  )
  const [weekdays, setWeekdays] = useState<number[]>(initialDays)
  const [time, setTime] = useState(initialTime)
  const [from, setFrom] = useState(
    formatDateRu(group.start_date > today ? group.start_date : today),
  )
  const [teacherId, setTeacherId] = useState(group.teacher_id)
  const [teacherFrom, setTeacherFrom] = useState(formatDateRu(group.start_date))
  const [error, setError] = useState<string | null>(null)

  const holidaySet = new Set(holidays)
  const until = horizon(today)
  const startIso = parseDateRu(start)
  const startNote = startIso ? groupStartNote(group, startIso, holidaySet) : null
  const scheduleChanged = !sameDays(weekdays, initialDays) || time.trim() !== initialTime
  const fromIso = parseDateRu(from)
  const count =
    fromIso && weekdays.length > 0
      ? planLessonDates({ weekdays, from: fromIso, until, holidays: holidaySet }).length
      : 0

  const mutation = useMutation({
    mutationFn: async () => {
      if (!startIso) throw new Error('Старт группы — дата в формате ДД.ММ.ГГГГ')
      // the teacher goes first: «с даты» is counted against the start as it is now
      if (teacherId !== group.teacher_id) {
        const from = parseDateRu(teacherFrom)
        if (!from) throw new Error('«С какой даты» — дата в формате ДД.ММ.ГГГГ')
        await changeGroupTeacher(group.id, teacherId, from)
      }
      const moved = startIso !== group.start_date ? await setGroupStart(group.id, startIso) : null
      if (status !== group.status) await setGroupStatus(group.id, status)
      if (!scheduleChanged) return { moved, rescheduled: null }
      const parsed = rescheduleForm.safeParse({ weekdays, time, validFrom: from })
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Проверьте поля')
      return { moved, rescheduled: await rescheduleGroup(group.id, parsed.data, until) }
    },
    onSettled: async () => {
      // the start may be saved even if the schedule step fails — show what is in the database
      // a new teacher changes payroll, «Сегодня» and «Мой месяц» — refresh everything on screen
      if (teacherId !== group.teacher_id) await queryClient.invalidateQueries()
      else
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: lessonsKey(group.id) }),
          queryClient.invalidateQueries({ queryKey: GROUPS_KEY }),
          queryClient.invalidateQueries({ queryKey: STUDENTS_KEY }),
          queryClient.invalidateQueries({ queryKey: [TEACHER_GROUPS_KEY] }),
        ])
    },
    onSuccess: ({ moved, rescheduled }) => {
      toast.success(
        [
          teacherId !== group.teacher_id ? 'Учитель группы изменён' : null,
          moved && startIso
            ? `Старт группы — ${formatDayMonth(startIso)}` +
              (moved.created > 0 ? ` · добавлено занятий: ${moved.created}` : '') +
              (moved.deleted > 0 ? ` · удалено занятий: ${moved.deleted}` : '')
            : null,
          rescheduled
            ? `Расписание изменено · удалено ${rescheduled.deleted}, создано ${rescheduled.created}`
            : null,
        ]
          .filter(Boolean)
          .join('. ') || 'Группа сохранена',
      )
      onOpenChange(false)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Изменить группу"
      description="Старт группы можно перенести задним числом. Новое расписание — с сегодняшнего дня или позже; проведённые и отменённые занятия не меняются."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          mutation.mutate()
        }}
        noValidate
        aria-label="Изменить группу"
        className="flex flex-col gap-3.5"
      >
        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>Статус</span>
          <Segmented
            label="Статус"
            options={[
              { value: 'forming', label: 'Набор' },
              { value: 'active', label: 'Активна' },
            ]}
            value={status}
            onChange={setStatus}
          />
        </div>
        <Field id={ids.start} label="Старт группы">
          <DateInput
            id={ids.start}
            className={inputClass}
            value={start}
            aria-invalid={!startIso || undefined}
            aria-describedby={ids.startHint}
            onChange={(v) => {
              setStart(v)
              setError(null)
            }}
          />
        </Field>
        <p id={ids.startHint} className="-mt-2 text-xs font-bold text-ink-muted">
          Можно задним числом — занятия достроятся
        </p>
        {startNote && (
          <p
            role="status"
            className="rounded-xl bg-accent px-3 py-2.5 text-xs font-bold text-warn-strong"
          >
            {startNote}
          </p>
        )}
        <GroupTeacherSection
          group={group}
          teachers={teachers}
          teacherId={teacherId}
          from={teacherFrom}
          onTeacherId={(id) => {
            setTeacherId(id)
            setError(null)
          }}
          onFrom={(v) => {
            setTeacherFrom(v)
            setError(null)
          }}
        />
        <fieldset className="flex min-w-0 flex-col gap-3.5 rounded-2xl border-[1.5px] border-line-strong p-3.5">
          <legend className="px-1.5 text-[13px] font-extrabold">Новое расписание</legend>
          <WeekdayPicker id={ids.days} value={weekdays} onChange={setWeekdays} />
          <div className="grid grid-cols-2 gap-2.5">
            <Field id={ids.time} label="Время">
              <input
                id={ids.time}
                className={inputClass}
                inputMode="numeric"
                placeholder="ЧЧ:ММ"
                autoComplete="off"
                value={time}
                onChange={(e) => {
                  setTime(maskTimeInput(e.target.value))
                }}
              />
            </Field>
            <Field id={ids.from} label="Действует с">
              <DateInput
                id={ids.from}
                className={inputClass}
                value={from}
                min={today}
                aria-describedby={ids.fromHint}
                onChange={(v) => {
                  setFrom(v)
                }}
              />
            </Field>
          </div>
          <p id={ids.fromHint} className="-mt-2 text-xs font-bold text-ink-muted">
            Не раньше сегодня — {formatDateRu(today)}
          </p>
          {scheduleChanged && (
            <p
              role="status"
              className="rounded-xl bg-accent px-3 py-2.5 text-xs font-bold text-warn-strong"
            >
              {fromIso
                ? `Запланированные занятия с ${formatDayMonth(fromIso)} по старому расписанию удалятся; по новому будет ${count} до ${formatDayMonth(until)}, праздники пропущены.`
                : 'Укажите дату, с которой действует новое расписание.'}
            </p>
          )}
        </fieldset>
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>Сохранить</SubmitButton>
        <SubmitButton variant="danger" onClick={onDelete}>
          Удалить группу
        </SubmitButton>
      </form>
    </FormDialog>
  )
}

/** «Архивировать» (А4): generation stops, future planned lessons are removed, history stays. */
export function ArchiveGroupDialog({
  open,
  onOpenChange,
  group,
  label,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: GroupRow
  label: ReactNode
}) {
  const { mutation, error } = useGroupMutation(
    group.id,
    () => archiveGroup(group.id),
    'Группа в архиве',
  )
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Архивировать группу?"
      description={
        <>
          {label}: будущие запланированные занятия удалятся, новые не создаются, зачисления учеников
          завершатся сегодняшним днём. Проведённые занятия и абонементы остаются.
        </>
      }
    >
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2.5">
        <SubmitButton
          variant="outline"
          onClick={() => {
            onOpenChange(false)
          }}
        >
          Не сейчас
        </SubmitButton>
        <SubmitButton
          variant="danger"
          pending={mutation.isPending}
          onClick={() => {
            mutation.mutate(undefined, {
              onSuccess: () => {
                onOpenChange(false)
              },
            })
          }}
        >
          Архивировать
        </SubmitButton>
      </div>
    </FormDialog>
  )
}
