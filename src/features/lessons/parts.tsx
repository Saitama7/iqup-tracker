// Shared pieces of У2 / УД1: captions, status chip, «Вчера не подтверждено» banner.
import { Link } from '@tanstack/react-router'
import { AlertCircle, Check } from 'lucide-react'
import { groupLabel } from '@/features/students/model'
import { GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import { cn } from '@/lib/utils'
import type { TeacherLesson } from './api'
import { bishkekTime, lessonState, pluralRu, untilLabel, type LessonState } from './select'

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

/** «Вчера не подтверждено: Математика · 5 класс, 15:00 · Отметить →» */
export function YesterdayBanner({ lesson }: { lesson: TeacherLesson }) {
  return (
    <Link
      to="/lessons/$lessonId"
      params={{ lessonId: lesson.id }}
      className="flex min-h-11 items-center gap-2.5 rounded-[14px] bg-burned-soft px-3.5 py-2.5 text-burned-deep"
    >
      <AlertCircle
        className="size-[18px] shrink-0 text-burned-strong"
        strokeWidth={2.5}
        aria-hidden
      />
      <span className="flex-1 text-[13px] font-bold">
        Вчера не подтверждено: {lessonTitle(lesson)}, {lesson.planned_start.slice(0, 5)}
      </span>
      <span className="text-[13px] font-extrabold whitespace-nowrap">Отметить →</span>
    </Link>
  )
}
