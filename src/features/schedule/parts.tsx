// Pieces shared by А1 / АМ1 / А2: status colours, the week-grid card, the legend.
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { LessonState } from '@/features/lessons/select'
import { cn } from '@/lib/utils'
import { trialsCaption, type Trial } from '@/features/trials/model'
import type { AdminLesson } from './api'
import { cardText, cardTone, type CardTone } from './model'

/** Status is always colour + text (docs/02-architecture.md §3). */
export const CHIP: Record<LessonState, string> = {
  held: 'bg-present-soft text-present-strong',
  current: 'bg-brand text-ink',
  upcoming: 'text-ink-muted',
  ended_unconfirmed: 'bg-burned-soft text-burned-deep',
  cancelled: 'bg-stone text-ink-muted',
}

/** АМ1: a dot for finished states (+ sr text), a chip for «Идёт», plain text for «Далее». */
export const DOT: Partial<Record<LessonState, string>> = {
  held: 'bg-present',
  ended_unconfirmed: 'bg-burned',
  cancelled: 'bg-sand',
}

const CARD: Record<CardTone, string> = {
  held: 'bg-present-soft border-l-4 border-present',
  current: 'bg-brand border-l-4 border-ink',
  upcoming: 'bg-warn-soft border-l-4 border-brand',
  unconfirmed: 'bg-burned-soft border-l-4 border-burned text-burned-deep',
  cancelled: 'bg-stone border-l-4 border-sand text-ink-muted',
  extra: 'bg-teal-soft border-l-4 border-teal',
  forming: 'bg-trial-soft border-[1.5px] border-dashed border-trial text-trial-strong',
}

const CAPTION: Record<CardTone, string> = {
  held: 'text-ink-muted',
  current: 'opacity-70',
  upcoming: 'text-ink-muted',
  unconfirmed: '',
  cancelled: '',
  extra: 'text-ink-muted',
  forming: '',
}

/** А2 card: group · teacher · status by colour and words; opens the group (lesson screen — #12). */
export function LessonCard({
  lesson,
  now,
  trials = [],
}: {
  lesson: AdminLesson
  now: number
  /** Open trials of this lesson: «+1 пробный · Адема» under the caption (never in the «N уч» count). */
  trials?: readonly Trial[]
}) {
  const tone = cardTone(lesson, now, trials.length)
  const { title, caption } = cardText(lesson, now, trials.length)
  return (
    <Link
      to="/admin/groups/$groupId"
      params={{ groupId: lesson.group.id }}
      data-tone={tone}
      className={cn('block rounded-[10px] px-2.5 py-2 text-xs font-extrabold text-ink', CARD[tone])}
    >
      {title}
      <span className={cn('block font-bold', CAPTION[tone])}>{caption}</span>
      {trials.length > 0 && tone !== 'forming' && tone !== 'cancelled' && (
        <span
          className={cn(
            'mt-1 inline-block rounded-full border-[1.5px] border-dashed px-[7px] py-px text-[11px] leading-[1.3] font-extrabold whitespace-nowrap',
            tone === 'current' ? 'border-ink text-ink' : 'border-trial text-trial-strong',
          )}
        >
          {trialsCaption(trials)}
        </span>
      )}
    </Link>
  )
}

const LEGEND: { label: string; swatch: string }[] = [
  { label: 'проведено', swatch: 'bg-present' },
  { label: 'идёт / впереди', swatch: 'bg-brand' },
  { label: 'не подтверждено', swatch: 'bg-burned' },
  { label: 'отменено', swatch: 'bg-sand' },
  { label: 'доп. урок', swatch: 'bg-teal' },
  {
    label: 'пробный ученик / группа на пробном',
    swatch: 'border-[1.5px] border-dashed border-trial',
  },
]

export function Legend() {
  return (
    <ul
      aria-label="Легенда"
      className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs font-bold text-ink-muted"
    >
      {LEGEND.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={cn('inline-block size-2.5 rounded-[3px]', i.swatch)} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[18px] border border-dashed border-line-strong bg-card p-5 text-sm font-bold text-ink-muted">
      {children}
    </p>
  )
}

/** Debts, payments and trials come with R2 (issue #11 «Не делать») — same place, no numbers. */
export const R2_STUB = 'появится в R2'
