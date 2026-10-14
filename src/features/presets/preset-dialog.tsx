// #84 · «Предупредил о пропуске»: the admin sets «Заморозка» before the lesson, with a comment.
// From the student card (pick one of the upcoming lessons) and from the lesson sheet (fixed lesson).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { lessonWhen } from '@/features/payroll/model'
import { FormDialog, NativeSelect } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import { clearPreset, PRESETS_KEY, setPreset, type PresetLesson } from './api'

/** «15 окт, ср · 11:00 · Математика · 8 класс А». */
export const presetLessonLabel = (l: PresetLesson) =>
  `${lessonWhen(l)} · ${l.group.subject} · ${l.group.name}`

/** Presets, lesson sheets and the dashboard follow a change. */
export function usePresetRefresh() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [PRESETS_KEY] }),
      queryClient.invalidateQueries({ queryKey: ['lesson'] }),
    ])
}

export function PresetDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
  lessons,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  studentId: string
  studentName: string
  /** One lesson — fixed (the lesson sheet); several — a picker (the student card). */
  lessons: readonly PresetLesson[]
}) {
  const refresh = usePresetRefresh()
  const lessonId = useId()
  const commentId = useId()
  const [picked, setPicked] = useState(lessons[0]?.id ?? '')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lesson = lessons.find((l) => l.id === picked) ?? null

  const save = useMutation({
    mutationFn: () => setPreset(picked, studentId, comment),
    onSuccess: async () => {
      await refresh()
      toast.success(`Заморозка заранее: ${studentName}${lesson ? `, ${lessonWhen(lesson)}` : ''}`)
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
      title="Предупредил о пропуске"
      description={`${studentName} — «Заморозка» на занятие. Учитель увидит её при отметке и сможет поменять, если ученик всё-таки придёт. Не более 2 заморозок на абонемент.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!picked || save.isPending) return
          setError(null)
          save.mutate()
        }}
      >
        {lessons.length === 0 ? (
          <p className="text-sm font-bold text-ink-muted">
            Нет запланированных занятий на ближайшие дни.
          </p>
        ) : lessons.length === 1 && lesson ? (
          <p className="rounded-xl bg-stone px-3.5 py-2.5 text-sm font-bold">
            {presetLessonLabel(lesson)}
          </p>
        ) : (
          <Field id={lessonId} label="Занятие">
            <NativeSelect
              id={lessonId}
              value={picked}
              onChange={(e) => {
                setPicked(e.target.value)
              }}
            >
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {presetLessonLabel(l)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field id={commentId} label="Комментарий">
          <textarea
            id={commentId}
            value={comment}
            maxLength={500}
            onChange={(e) => {
              setComment(e.target.value)
            }}
            placeholder="Например: мама написала, заболел"
            className={cn(inputClass, 'min-h-20 py-2')}
          />
        </Field>
        {error && <ErrorText>Не удалось поставить заморозку: {error}</ErrorText>}
        {lessons.length > 0 && (
          <SubmitButton pending={save.isPending}>Поставить заморозку</SubmitButton>
        )}
      </form>
    </FormDialog>
  )
}

/** «Снять»: removes the preset; the toast says what happened. */
export function useClearPreset() {
  const refresh = usePresetRefresh()
  return useMutation({
    mutationFn: ({ lessonId, studentId }: { lessonId: string; studentId: string; name: string }) =>
      clearPreset(lessonId, studentId),
    onSuccess: async (_removed, { name }) => {
      await refresh()
      toast.success(`Заморозка заранее снята: ${name}`)
    },
    onError: (e) => {
      toast.error(`Не удалось снять заморозку: ${e.message}`)
    },
  })
}
