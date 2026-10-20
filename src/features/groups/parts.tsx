import { chipClass, labelClass } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import { STATUS_LABEL, WEEKDAYS, type GroupStatus } from './model'

// Shared by А3 / А4; same look as А5–А9 (tariffs/parts.tsx, students/parts.tsx).

const STATUS_CHIP: Record<GroupStatus, string> = {
  active: 'bg-present-soft text-present-strong',
  forming: 'bg-warn-soft text-warn-strong',
  archived: 'bg-stone text-ink-muted',
}

export function GroupStatusChip({
  status,
  className,
}: {
  status: GroupStatus
  className?: string
}) {
  return (
    <span className={cn(chipClass, STATUS_CHIP[status], className)}>{STATUS_LABEL[status]}</span>
  )
}

/** «Дни недели»: ПН … ВС toggles (А3; Sunday — weekend groups, #100). */
export function WeekdayPicker({
  id,
  value,
  onChange,
}: {
  id: string
  value: readonly number[]
  onChange: (next: number[]) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className={labelClass}>
        Дни недели
      </span>
      <div role="group" aria-labelledby={id} className="flex gap-1.5">
        {WEEKDAYS.map((label, i) => {
          const day = i + 1
          const on = value.includes(day)
          return (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onChange(
                  on ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b),
                )
              }}
              className={cn(
                'min-h-11 flex-1 rounded-[10px] text-[13px]',
                on
                  ? 'bg-ink font-extrabold text-brand'
                  : 'border-[1.5px] border-line-strong bg-card font-bold text-ink-muted',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Segmented control (А3 «Активные / Набор / Архив»). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex rounded-xl border-[1.5px] border-line-strong bg-card p-[3px]', className)}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onChange(o.value)
            }}
            className={cn(
              'min-h-9 flex-1 rounded-[9px] px-3 text-[13px] whitespace-nowrap',
              on ? 'bg-ink font-extrabold text-brand' : 'font-bold text-ink-muted',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
