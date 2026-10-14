// #84 · «Предупредил о пропуске»: the admin's «Заморозка» set before the lesson (attendance_presets,
// 0023). Not a mark — the teacher sees it prefilled and may change it; confirm_lesson takes it as the
// default. Pure: callers pass rows they already have.
import { addDays, dayShort } from '@/features/groups/model'
import { freezeBlocked, type Mark, type RosterRow } from '@/features/lessons/attendance'
import { lessonStartMs, type LessonTiming } from '@/features/lessons/select'

export interface PresetInfo {
  comment: string | null
}

/**
 * Marks with the presets filled in for students not marked yet — an explicit mark (the student
 * came after all) wins; a subscription with no freezes left gets no prefill (В2), like a draft.
 */
export function applyPresets(
  marks: ReadonlyMap<string, Mark>,
  presets: ReadonlyMap<string, PresetInfo>,
  roster: readonly Pick<RosterRow, 'studentId' | 'balance'>[],
): ReadonlyMap<string, Mark> {
  if (presets.size === 0) return marks
  const next = new Map(marks)
  for (const row of roster) {
    if (next.has(row.studentId) || !presets.has(row.studentId)) continue
    if (freezeBlocked(row, undefined)) continue
    next.set(row.studentId, 'absent_frozen')
  }
  return next
}

/**
 * What goes to the draft (И27): the teacher's own marks only. A mark equal to what the preset
 * prefilled is not the teacher's — if the admin removes the preset, the student is unmarked again,
 * not left with a «Заморозка» nobody signed.
 */
export function draftMarks(
  next: ReadonlyMap<string, Mark>,
  own: ReadonlyMap<string, Mark>,
  shown: ReadonlyMap<string, Mark>,
): Map<string, Mark> {
  const out = new Map<string, Mark>()
  for (const [id, mark] of next) if (own.has(id) || shown.get(id) !== mark) out.set(id, mark)
  return out
}

/** «Админ: предупредил · мама написала» — under the student on У3 / УД2. */
export const presetCaption = (p: PresetInfo) =>
  p.comment ? `Админ: предупредил · ${p.comment}` : 'Админ: предупредил'

/**
 * A preset can be set: a planned lesson outside a closed period that has not started yet — after
 * the start it is not «in advance» anymore, the teacher marks (И56).
 */
export function presetEditable(
  lesson: { status: 'planned' | 'held' | 'cancelled'; is_locked: boolean } & Pick<
    LessonTiming,
    'lesson_date' | 'planned_start'
  >,
  now: number,
): boolean {
  return lesson.status === 'planned' && !lesson.is_locked && now < lessonStartMs(lesson)
}

/** A preset can be removed until the lesson is held — a cancelled lesson's too (И56). */
export function presetClearable(lesson: {
  status: 'planned' | 'held' | 'cancelled'
  is_locked: boolean
}): boolean {
  return lesson.status !== 'held' && !lesson.is_locked
}

/** set_ / clear_attendance_preset error → why (0023). Lower case — it follows a colon. */
export function presetErrorReason(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (!error.code) return 'нет связи с сервером — проверьте интернет'
  if (error.code === '42501') return 'заморозку заранее ставит только администратор'
  if (error.code === 'PGRST202' || error.code === '42883')
    return 'сервер не обновлён — сообщите администратору'
  if (m.includes('freeze limit'))
    return m.includes('month')
      ? 'лимит заморозок 2 на месяц исчерпан'
      : 'лимит заморозок 2 на абонемент исчерпан'
  if (m.includes('in the past')) return 'занятие уже прошло'
  if (m.includes('already started')) return 'занятие уже началось — это не «заранее»'
  if (m.includes('closed period')) return 'период закрыт'
  if (m.includes('is held')) return 'занятие уже проведено'
  if (m.includes('not planned')) return 'занятие уже проведено или отменено'
  if (m.includes('not enrolled')) return 'ученик не в группе на дату занятия'
  if (m.includes('no after-school hours')) return 'по графику продлёнки у ученика в этот день 0 ч'
  if (m.includes('500')) return 'комментарий длиннее 500 символов'
  return 'ошибка сервера — попробуйте ещё раз'
}

/** «Сегодня» / «Завтра» / «15 окт» — the day of a preset on the dashboard list. */
export function dayWord(date: string, today: string): string {
  if (date === today) return 'Сегодня'
  if (date === addDays(today, 1)) return 'Завтра'
  return dayShort(date)
}
