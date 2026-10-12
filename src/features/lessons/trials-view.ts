// Trials on the teacher screens (У2 / УД1 / У3 / УД2): pure helpers, a trial never joins the roster counts.
import {
  plusTrials,
  shortPerson,
  trialsByLesson,
  trialsCaption,
  type Trial,
} from '@/features/trials/model'

/** Trials of the teacher's own lessons (an admin+teacher reads every trial under RLS), grouped by lesson. */
export function ownTrialsByLesson(
  trials: readonly Trial[],
  lessons: readonly { id: string }[],
): Map<string, Trial[]> {
  const ids = new Set(lessons.map((l) => l.id))
  return trialsByLesson(
    trials.filter((t) => ids.has(t.lesson_id) && t.lessonStatus !== 'cancelled'),
  )
}

/** «+1 пробный · Нурай Ж. · первый раз» (Завтра); several — «+2 пробных». */
export function tomorrowTrialCaption(list: readonly Trial[]): string {
  const [only] = list
  if (list.length !== 1 || !only) return trialsCaption(list)
  const firstTime = only.student_id === null ? ' · первый раз' : ''
  return `${plusTrials(1)} · ${shortPerson(only.full_name)}${firstTime}`
}

/** «РБ» for «Розаина Бекова». */
export function trialInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/** «Отмечено 5 из 8» + the trial suffix kept apart: trials never count in «из 8». */
export const trialsSuffix = (count: number) => (count > 0 ? ` · ${plusTrials(count)}` : '')
