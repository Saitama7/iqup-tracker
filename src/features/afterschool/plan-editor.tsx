// «График» продлёнки (#82): six weekdays, hours per day — the enrollment form and «Изменить с даты».
import { useId } from 'react'
import { NativeSelect } from '@/features/students/parts'
import { labelClass } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import { formatHours, HOUR_OPTIONS, WEEKDAY_SHORT, type PlanHours } from './model'

/** Mon–Sat; Sunday only when the group has Sunday lessons or the plan already has hours there. */
const days = (groupWeekdays: readonly number[], hours: PlanHours) =>
  groupWeekdays.includes(7) || (hours[6] ?? 0) > 0 ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6]

export function PlanEditor({
  hours,
  onChange,
  groupWeekdays,
  label = 'График',
}: {
  hours: PlanHours
  onChange: (next: number[]) => void
  /** ISO weekdays of the group's schedule — other days get «нет занятий». */
  groupWeekdays: readonly number[]
  label?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelClass} id={id}>
        {label}
      </span>
      <div role="group" aria-labelledby={id} className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {days(groupWeekdays, hours).map((d) => {
          const name = WEEKDAY_SHORT[d - 1] ?? ''
          const off = groupWeekdays.length > 0 && !groupWeekdays.includes(d)
          const value = hours[d - 1] ?? 0
          return (
            <label key={d} className="flex min-w-0 flex-col gap-1">
              <span
                className={cn('text-xs font-extrabold', value > 0 ? 'text-ink' : 'text-ink-muted')}
              >
                {name}
                {off && <span className="font-bold text-ink-muted"> · нет занятий</span>}
              </span>
              <NativeSelect
                aria-label={`${name}, часов`}
                value={String(value)}
                onChange={(e) => {
                  const next = Array.from({ length: 7 }, (_, i) => hours[i] ?? 0)
                  next[d - 1] = Number(e.target.value)
                  onChange(next)
                }}
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={String(h)}>
                    {h === 0 ? '—' : `${formatHours(h)} ч`}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )
        })}
      </div>
    </div>
  )
}
