// Shared pieces of У2 / УД1: captions, status chip, «не подтверждено» banner.
import { Link } from '@tanstack/react-router'
import { AlertCircle, Check } from 'lucide-react'
import { groupLabel } from '@/features/students/model'
import { GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import { addDays } from '@/features/groups/model'
import { formatDayMonth } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { TeacherLesson } from './api'
import {
  bishkekTime,
  lessonState,
  pluralRu,
  UNCONFIRMED_SHOWN,
  unconfirmedTitle,
  untilLabel,
  type LessonState,
  type Unconfirmed,
} from './select'

export const lessonTitle = (l: TeacherLesson) => groupLabel(l.group)

const STUDENTS = ['ученик', 'ученика', 'учеников'] as const
export const studentsWord = (n: number) => `${n} ${pluralRu(n, STUDENTS)}`

/** «Групповая · 8 учеников · каб. 2» — on the deck card. */
export function groupCaption(l: TeacherLesson): string {
  return [
    GROUP_TYPE_LABEL[l.group.group_type],
    studentsWord(l.students),
    l.group.room ? `каб. ${l.group.room}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** «Был 7 · Заморозка 1 · 10:02» (held) or «8 учеников · групповая» — second line of a day row. */
export function rowCaption(l: TeacherLesson, { desktop = false } = {}): string {
  if (l.status === 'held') {
    const { present, frozen, burned } = l.marks
    const parts = [
      present ? `Был ${present}` : null,
      frozen ? `Заморозка ${frozen}` : null,
      burned ? `Не был ${burned}` : null,
    ]
    if (l.confirmed_at) {
      const time = bishkekTime(l.confirmed_at)
      parts.push(desktop ? `подтверждено в ${time}` : time)
    }
    return parts.filter(Boolean).join(' · ')
  }
  return [
    studentsWord(l.students),
    GROUP_TYPE_LABEL[l.group.group_type].toLowerCase(),
    desktop && l.group.room ? `каб. ${l.group.room}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

const CHIP: Record<LessonState, string> = {
  held: 'bg-present-soft text-present-strong',
  current: 'bg-brand text-ink',
  upcoming: 'bg-muted text-ink-muted',
  ended_unconfirmed: 'bg-burned-soft text-burned-deep',
  cancelled: 'bg-stone text-ink-muted',
}

export function chipLabel(l: TeacherLesson, state: LessonState, now: number): string {
  if (state === 'held') return 'Проведено'
  if (state === 'current') return 'Сейчас'
  if (state === 'upcoming') return untilLabel(l, now)
  if (state === 'ended_unconfirmed') return 'Не подтверждено'
  return 'Отменено'
}

/** Status is always colour + text (docs/02-architecture.md §3). */
export function StatusChip({ lesson, now }: { lesson: TeacherLesson; now: number }) {
  const state = lessonState(lesson, now)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-extrabold whitespace-nowrap',
        CHIP[state],
      )}
    >
      {state === 'held' && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
      {chipLabel(lesson, state, now)}
    </span>
  )
}

/** «Вчера, 15:00» / «5 октября, 15:00» — an unconfirmed lesson of an earlier day. */
export function pastLessonWhen(l: TeacherLesson, today: string): string {
  const day = l.lesson_date === addDays(today, -1) ? 'Вчера' : formatDayMonth(l.lesson_date)
  return `${day}, ${l.planned_start.slice(0, 5)}`
}

const ALERT_ICON = (
  <AlertCircle className="size-[18px] shrink-0 text-burned-strong" strokeWidth={2.5} aria-hidden />
)

/**
 * У2: one lesson from yesterday — «Вчера не подтверждено: Математика · 5 класс, 15:00 · Отметить →»;
 * more — «Не подтверждено: 12 занятий», the nearest three and «ещё 9».
 */
export function UnconfirmedBanner({
  unconfirmed,
  today,
}: {
  unconfirmed: Unconfirmed<TeacherLesson>
  today: string
}) {
  const { lessons, onlyYesterday } = unconfirmed
  const [only] = lessons
  if (lessons.length === 1 && onlyYesterday && only) {
    return (
      <Link
        to="/lessons/$lessonId"
        params={{ lessonId: only.id }}
        className="flex min-h-11 items-center gap-2.5 rounded-[14px] bg-burned-soft px-3.5 py-2.5 text-burned-deep"
      >
        {ALERT_ICON}
        <span className="flex-1 text-[13px] font-bold">
          Вчера не подтверждено: {lessonTitle(only)}, {only.planned_start.slice(0, 5)}
        </span>
        <span className="text-[13px] font-extrabold whitespace-nowrap">Отметить →</span>
      </Link>
    )
  }

  const title = unconfirmedTitle(unconfirmed)
  const more = lessons.length - UNCONFIRMED_SHOWN
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-1 rounded-[14px] bg-burned-soft px-3.5 py-2.5 text-burned-deep"
    >
      <h2 className="flex min-h-7 items-center gap-2.5 text-[13px] font-extrabold">
        {ALERT_ICON}
        {title}
      </h2>
      <ul className="flex flex-col">
        {lessons.slice(0, UNCONFIRMED_SHOWN).map((l) => (
          <li key={l.id}>
            <Link
              to="/lessons/$lessonId"
              params={{ lessonId: l.id }}
              className="flex min-h-11 items-center gap-2.5 border-t border-burned-deep/10 pl-7"
            >
              <span className="flex-1 text-[13px] font-bold">
                {pastLessonWhen(l, today)} · {lessonTitle(l)}
              </span>
              <span className="text-[13px] font-extrabold whitespace-nowrap">Отметить →</span>
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="pl-7 text-xs font-bold">ещё {more}</p>}
    </section>
  )
}
