import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { DateInput } from '@/components/ui/date-picker'
import { firstName } from '@/features/students/model'
import { NativeSelect } from '@/features/students/parts'
import { Field, inputClass } from '@/features/tariffs/parts'
import { parseDateRu } from '@/lib/time'
import { teacherPreviewQuery } from './undo-api'
import type { GroupRow, TeacherRow } from './model'

const noteClass = 'rounded-xl bg-accent px-3 py-2.5 text-xs font-bold text-warn-strong'

/** «N занятий (из них M проведено) перейдут к Асель; ЗП пересчитается». */
export function lessonsMoveText(total: number, held: number, teacher: string): string {
  return `${total} занятий (из них ${held} проведено) перейдут к ${teacher}; ЗП пересчитается`
}

/**
 * «Учитель» + «С какой даты» of «Изменить группу» (#73). The default date is the group start, so a
 * wrong assignment is corrected for the whole group; the preview counts what would move.
 */
export function GroupTeacherSection({
  group,
  teachers,
  teacherId,
  from,
  onTeacherId,
  onFrom,
}: {
  group: GroupRow
  teachers: readonly TeacherRow[]
  teacherId: string
  from: string
  onTeacherId: (id: string) => void
  onFrom: (value: string) => void
}) {
  const ids = { teacher: useId(), from: useId(), hint: useId() }
  const fromIso = parseDateRu(from)
  const differs = teacherId !== group.teacher_id
  const preview = useQuery({
    ...teacherPreviewQuery(group.id, teacherId, fromIso ?? ''),
    enabled: differs && fromIso !== null,
  })
  const target = teachers.find((t) => t.id === teacherId)

  return (
    <fieldset className="flex min-w-0 flex-col gap-3.5 rounded-2xl border-[1.5px] border-line-strong p-3.5">
      <legend className="px-1.5 text-[13px] font-extrabold">Учитель</legend>
      <Field id={ids.teacher} label="Учитель группы">
        <NativeSelect
          id={ids.teacher}
          value={teacherId}
          onChange={(e) => {
            onTeacherId(e.target.value)
          }}
        >
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.full_name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {differs && (
        <>
          <Field id={ids.from} label="С какой даты">
            <DateInput
              id={ids.from}
              className={inputClass}
              value={from}
              aria-invalid={!fromIso || undefined}
              aria-describedby={ids.hint}
              onChange={onFrom}
            />
          </Field>
          <p id={ids.hint} className="-mt-2 text-xs font-bold text-ink-muted">
            По умолчанию — старт группы: ошибочное назначение исправится целиком. Занятия до этой
            даты остаются у прежнего учителя.
          </p>
          {!fromIso ? (
            <p role="status" className={noteClass}>
              Укажите дату в формате ДД.ММ.ГГГГ.
            </p>
          ) : preview.isError ? (
            <p role="status" className={noteClass}>
              {preview.error.message}
            </p>
          ) : preview.data ? (
            <div role="status" className="flex flex-col gap-1.5">
              <p className={noteClass}>
                {lessonsMoveText(
                  preview.data.total,
                  preview.data.held,
                  target ? firstName(target.full_name) : 'новому учителю',
                )}
                .
              </p>
              {preview.data.locked > 0 && (
                <p className="rounded-xl bg-burned-soft px-3 py-2.5 text-xs font-bold text-burned-deep">
                  С этой даты есть занятия в закрытом периоде — выберите дату позже.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs font-bold text-ink-muted">Считаем занятия…</p>
          )}
        </>
      )}
    </fieldset>
  )
}
