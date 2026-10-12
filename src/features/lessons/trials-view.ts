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

/**
 * «+1 пробный · Нурай Ж. · первый раз» (Завтра); several — «+2 пробных · Нурай Ж., Адема К.»: the
 * teacher learns who comes, not only how many (Ж3). A long list — the count only.
 */
export function tomorrowTrialCaption(list: readonly Trial[]): string {
  const [only] = list
  if (!only) return ''
  if (list.length === 1) {
    const firstTime = only.student_id === null ? ' · первый раз' : ''
    return `${plusTrials(1)} · ${shortPerson(only.full_name)}${firstTime}`
  }
  if (list.length > 3) return trialsCaption(list)
  return `${plusTrials(list.length)} · ${list.map((t) => shortPerson(t.full_name)).join(', ')}`
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
