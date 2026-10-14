// #84 · А1 / АМ1: «Предупредили о пропуске» — freezes set in advance for today and tomorrow.
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { addDays } from '@/features/groups/model'
import { cn } from '@/lib/utils'
import { presetsQuery, usePresetsRealtime, type PresetRow } from './api'
import { dayWord } from './model'

/** «Завтра 11:00 · Математика · 8 класс А — Айжан Б. · заболел». */
export function presetLine(r: PresetRow, today: string): string {
  const when = `${dayWord(r.lesson.lesson_date, today)} ${r.lesson.planned_start.slice(0, 5)}`
  const who = r.comment ? `${r.studentName} · ${r.comment}` : r.studentName
  return `${when} · ${r.lesson.group.subject} · ${r.lesson.group.name} — ${who}`
}

/** Shown only while there are presets for today / tomorrow. */
export function PresetsWidget({ today, compact = false }: { today: string; compact?: boolean }) {
  usePresetsRealtime()
  const { data } = useQuery(presetsQuery(today, addDays(today, 1)))
  if (!data || data.length === 0) return null
  return (
    <section
      aria-label="Предупредили о пропуске"
      className={cn(
        'flex flex-col gap-2.5 border border-line bg-card',
        compact ? 'rounded-[18px] px-4 py-3.5' : 'rounded-[20px] px-5 py-4',
      )}
    >
      <div className="flex items-center gap-2">
        <h2 className={cn('font-extrabold', compact ? 'text-sm' : 'text-[15px]')}>
          Предупредили о пропуске
        </h2>
        <span className="rounded-full bg-teal-soft px-[9px] py-[3px] text-xs font-extrabold whitespace-nowrap text-teal-strong">
          {data.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {data.map((r) => (
          <li key={r.id}>
            <Link
              to="/lessons/$lessonId"
              params={{ lessonId: r.lesson.id }}
              className="flex min-h-11 items-center text-[13px] font-bold"
            >
              {presetLine(r, today)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
