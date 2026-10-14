// #84 · «Предупредил о пропуске»: the admin's «Заморозка» set before the lesson (attendance_presets,
// 0099). Not a mark — the teacher sees it prefilled and may change it; confirm_lesson takes it as the
// default. Pure: callers pass rows they already have.
import { addDays, dayShort } from '@/features/groups/model'
import { freezeBlocked, type Mark, type RosterRow } from '@/features/lessons/attendance'

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

/** «Админ: предупредил · мама написала» — under the student on У3 / УД2. */
export const presetCaption = (p: PresetInfo) =>
  p.comment ? `Админ: предупредил · ${p.comment}` : 'Админ: предупредил'

/** A preset can be set / removed: a planned lesson of today or later outside a closed period. */
export function presetEditable(
  lesson: { status: 'planned' | 'held' | 'cancelled'; lesson_date: string; is_locked: boolean },
  today: string,
): boolean {
  return lesson.status === 'planned' && !lesson.is_locked && lesson.lesson_date >= today
}

/** set_ / clear_attendance_preset error → why (0099). Lower case — it follows a colon. */
export function presetErrorReason(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (!error.code) return 'нет связи с сервером — проверьте интернет'
  if (error.code === '42501') return 'заморозку заранее ставит только администратор'
  if (error.code === 'PGRST202' || error.code === '42883')
    return 'сервер не обновлён — сообщите администратору'
  if (m.includes('freeze limit')) return 'лимит заморозок 2 на абонемент исчерпан'
  if (m.includes('in the past')) return 'занятие уже прошло'
  if (m.includes('closed period')) return 'период закрыт'
  if (m.includes('not planned')) return 'занятие уже проведено или отменено'
  if (m.includes('not enrolled')) return 'ученик не в группе на дату занятия'
  if (m.includes('500')) return 'комментарий длиннее 500 символов'
  return 'ошибка сервера — попробуйте ещё раз'
}

/** «Сегодня» / «Завтра» / «15 окт» — the day of a preset on the dashboard list. */
export function dayWord(date: string, today: string): string {
  if (date === today) return 'Сегодня'
  if (date === addDays(today, 1)) return 'Завтра'
  return dayShort(date)
}
