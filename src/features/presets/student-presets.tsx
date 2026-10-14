// #84 · А6 student card: «Предупредил о пропуске» — the student's freezes set in advance + the button.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { cardClass } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import { studentPresetsQuery, upcomingLessonsQuery, usePresetsRealtime } from './api'
import { PresetDialog, presetLessonLabel, useClearPreset } from './preset-dialog'

export function StudentPresets({
  studentId,
  studentName,
  groupIds,
  today,
}: {
  studentId: string
  studentName: string
  /** Groups the student is active in now. */
  groupIds: readonly string[]
  today: string
}) {
  usePresetsRealtime()
  const presets = useQuery(studentPresetsQuery(studentId, today))
  const lessons = useQuery(upcomingLessonsQuery(groupIds, today))
  const clear = useClearPreset()
  const [open, setOpen] = useState(false)
  const rows = presets.data ?? []
  const taken = new Set(rows.map((r) => r.lesson.id))
  const free = (lessons.data ?? []).filter((l) => !taken.has(l.id))

  return (
    <section
      aria-label="Предупредил о пропуске"
      className={cn(cardClass, 'flex flex-col gap-2.5 px-[18px] py-4')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-extrabold">Предупредил о пропуске</h2>
        <button
          type="button"
          disabled={!lessons.data}
          onClick={() => {
            setOpen(true)
          }}
          className="flex min-h-11 items-center rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 text-[13px] font-extrabold whitespace-nowrap disabled:opacity-50"
        >
          + Заморозка заранее
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] font-bold text-ink-muted">
          Ученик предупредил заранее — поставьте «Заморозку» на занятие, учитель увидит её при
          отметке.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2.5 rounded-xl bg-teal-soft px-3 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-extrabold text-teal-strong">
                  Заморозка · {presetLessonLabel(r.lesson)}
                </span>
                {r.comment && <span className="text-xs font-bold text-ink-muted">{r.comment}</span>}
              </span>
              <button
                type="button"
                disabled={clear.isPending}
                onClick={() => {
                  clear.mutate({ lessonId: r.lesson.id, studentId, name: studentName })
                }}
                className="min-h-11 shrink-0 px-2 text-[13px] font-extrabold text-burned-strong"
                aria-label={`Снять заморозку: ${presetLessonLabel(r.lesson)}`}
              >
                Снять
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <PresetDialog
          open
          onOpenChange={setOpen}
          studentId={studentId}
          studentName={studentName}
          lessons={free}
        />
      )}
    </section>
  )
}
