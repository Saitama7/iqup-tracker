// #94 · «⋯ → Изменить занятие» on the lesson card (admin): date, time, duration, teacher, substitute
// with a reason; a held lesson shows what the move does to the teachers' payroll before saving.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { DateInput } from '@/components/ui/date-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AUDIT_KEY } from '@/features/audit/api'
import { teacherOptionsQuery } from '@/features/schedule/api'
import { FormDialog, NativeSelect } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { maskTimeInput } from '@/lib/date-input'
import { formatDateRu, parseDateRu } from '@/lib/time'
import type { LessonSheet } from './api'
import {
  editLessonForm,
  impactLines,
  lessonEditImpactQuery,
  parseTimeInput,
  updateLesson,
} from './edit-lesson-api'
import { refreshAfterLesson } from './use-confirm-lesson'

/** «⋯» of the lesson card: one entry, «Изменить занятие» (admin; not for a cancelled lesson). */
export function LessonMenu({ sheet }: { sheet: LessonSheet }) {
  const [menu, setMenu] = useState(false)
  const [open, setOpen] = useState(false)
  if (sheet.status === 'cancelled') return null
  return (
    <>
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger
          aria-label="Действия с занятием"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-muted"
        >
          <MoreHorizontal className="size-5" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-56 flex-col p-1.5">
          <button
            type="button"
            className="flex min-h-11 items-center rounded-xl px-3 text-left text-sm font-bold hover:bg-muted"
            onClick={() => {
              setMenu(false)
              setOpen(true)
            }}
          >
            Изменить занятие
          </button>
        </PopoverContent>
      </Popover>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Изменить занятие"
        description="Запись с причиной останется в журнале изменений."
      >
        {open && (
          <EditLessonForm
            sheet={sheet}
            onCancel={() => {
              setOpen(false)
            }}
          />
        )}
      </FormDialog>
    </>
  )
}

function EditLessonForm({ sheet, onCancel }: { sheet: LessonSheet; onCancel: () => void }) {
  const id = useId()
  const qc = useQueryClient()
  const teachers = useQuery(teacherOptionsQuery())
  const [date, setDate] = useState(formatDateRu(sheet.lesson_date))
  const [start, setStart] = useState(sheet.planned_start.slice(0, 5))
  const [duration, setDuration] = useState(String(sheet.duration_min))
  const [teacherId, setTeacherId] = useState(sheet.teacher_id)
  const [substituteId, setSubstituteId] = useState(sheet.substitute_teacher_id ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isoDate = parseDateRu(date)
  const held = sheet.status === 'held'
  const impact = useQuery({
    ...lessonEditImpactQuery(sheet.id, isoDate ?? sheet.lesson_date, teacherId),
    enabled: held && !sheet.is_locked && isoDate !== null && teacherId !== '',
  })
  const lines = impact.data ? impactLines(impact.data) : []

  const mutation = useMutation({
    mutationFn: updateLesson,
    onSuccess: () => {
      toast.success('Занятие изменено')
      onCancel()
      refreshAfterLesson(qc, sheet.id, sheet.group.id)
      void qc.invalidateQueries({ queryKey: [AUDIT_KEY] })
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  const touch =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v)
      setError(null)
    }

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (sheet.is_locked) return
    const parsed = editLessonForm.safeParse({
      lessonId: sheet.id,
      date,
      start,
      durationMin: duration,
      teacherId,
      substituteId,
      reason,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  const options = teachers.data ?? []
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Изменить занятие"
      className="flex flex-col gap-3.5"
    >
      {sheet.is_locked && (
        <p
          role="status"
          className="rounded-xl bg-line px-3 py-2.5 text-sm font-extrabold text-ink-muted"
        >
          Период закрыт — изменить нельзя
        </p>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <Field id={`${id}-date`} label="Дата">
          <DateInput
            id={`${id}-date`}
            value={date}
            disabled={sheet.is_locked}
            onChange={touch(setDate)}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-start`} label="Начало">
          <input
            id={`${id}-start`}
            value={start}
            inputMode="numeric"
            placeholder="14:00"
            disabled={sheet.is_locked}
            onChange={(e) => {
              touch(setStart)(maskTimeInput(e.target.value))
            }}
            className={inputClass}
          />
        </Field>
      </div>
      <Field id={`${id}-duration`} label="Длительность, мин">
        <input
          id={`${id}-duration`}
          value={duration}
          inputMode="numeric"
          disabled={sheet.is_locked}
          onChange={(e) => {
            touch(setDuration)(e.target.value.replace(/\D/g, '').slice(0, 3))
          }}
          className={inputClass}
        />
      </Field>
      <Field id={`${id}-teacher`} label="Учитель (получает ЗП)">
        <NativeSelect
          id={`${id}-teacher`}
          value={teacherId}
          disabled={sheet.is_locked}
          onChange={(e) => {
            touch(setTeacherId)(e.target.value)
          }}
        >
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-substitute`} label="Замена (только пометка)">
        <NativeSelect
          id={`${id}-substitute`}
          value={substituteId}
          disabled={sheet.is_locked}
          onChange={(e) => {
            touch(setSubstituteId)(e.target.value)
          }}
        >
          <option value="">Без замены</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {held && !sheet.is_locked && (
        <div role="status" data-testid="edit-lesson-impact" aria-live="polite">
          {impact.isError ? (
            <p className="text-xs font-bold text-ink-muted">
              Не удалось посчитать ЗП — база всё равно проверит при сохранении.
            </p>
          ) : impact.data ? (
            <p className="rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong">
              {lines.length > 0 ? `ЗП: ${lines.join('; ')}` : 'ЗП учителей не изменится'}
            </p>
          ) : (
            <div className="h-10 animate-pulse rounded-xl bg-muted" aria-hidden />
          )}
        </div>
      )}
      <Field id={`${id}-reason`} label="Причина">
        <input
          id={`${id}-reason`}
          value={reason}
          maxLength={500}
          disabled={sheet.is_locked}
          placeholder="обязательно, например «ошиблись датой»"
          onChange={(e) => {
            touch(setReason)(e.target.value)
          }}
          className={inputClass}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2.5">
        <SubmitButton variant="outline" onClick={onCancel}>
          Отмена
        </SubmitButton>
        <SubmitButton
          variant="danger"
          pending={mutation.isPending}
          disabled={sheet.is_locked || parseTimeInput(start) === null}
        >
          Изменить занятие
        </SubmitButton>
      </div>
    </form>
  )
}
