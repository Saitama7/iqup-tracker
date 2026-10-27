// #74 · Исправление отметок проведённого занятия: admin correction (correct_attendance) and the
// teacher's request (attendance_correction_requests, 0021). Pure: (roster, saved, edited, requests).
import { MARK_LABEL, type Mark, type RosterRow } from './attendance'

export interface MarkChange {
  studentId: string
  fullName: string
  from: Mark | null
  to: Mark
}

/**
 * Marks that differ from the saved ones, in roster order; an unmarked student (#107) only once a
 * mark was chosen for them — untouched ones are not sent and get no mark.
 */
export function markChanges(
  roster: readonly Pick<RosterRow, 'studentId' | 'fullName'>[],
  saved: ReadonlyMap<string, Mark>,
  edited: ReadonlyMap<string, Mark>,
): MarkChange[] {
  return roster.flatMap((r) => {
    const to = edited.get(r.studentId)
    const from = saved.get(r.studentId) ?? null
    return to && to !== from ? [{ studentId: r.studentId, fullName: r.fullName, from, to }] : []
  })
}

/** p_marks of correct_attendance / attendance_correction_requests.marks. */
export const changesPayload = (changes: readonly MarkChange[]) =>
  changes.map((c) => ({ student_id: c.studentId, status: c.to }))

/** «Айжан Б.: был → не был»; a student without a mark (#107) — «Айзат К.: — → был». */
export function changeLine(c: Pick<MarkChange, 'fullName' | 'from' | 'to'>): string {
  const from = c.from ? MARK_LABEL[c.from].toLowerCase() : '—'
  return `${c.fullName}: ${from} → ${MARK_LABEL[c.to].toLowerCase()}`
}

export type RequestStatus = 'pending' | 'approved' | 'rejected'

export interface CorrectionRequest {
  id: string
  lesson_id: string
  status: RequestStatus
  marks: { student_id: string; status: Mark }[]
  comment: string
  created_at: string
  decided_at: string | null
  decision_comment: string | null
}

/**
 * A request's proposed marks against the saved ones («было → стало»); students gone from the roster
 * by id. Marks already equal to the saved ones (the admin fixed them by hand meanwhile) are dropped —
 * empty → «Уже исправлено».
 */
export function requestChanges(
  request: Pick<CorrectionRequest, 'marks'>,
  roster: readonly Pick<RosterRow, 'studentId' | 'fullName'>[],
  saved: ReadonlyMap<string, Mark>,
): MarkChange[] {
  return request.marks.flatMap((m) => {
    const from = saved.get(m.student_id) ?? null
    if (from === m.status) return []
    const fullName = roster.find((r) => r.studentId === m.student_id)?.fullName ?? 'Ученик'
    return [{ studentId: m.student_id, fullName, from, to: m.status }]
  })
}

/** The newest request of the lesson (requests come newest first). */
export const latestRequest = <T extends Pick<CorrectionRequest, 'created_at'>>(
  requests: readonly T[],
): T | null =>
  requests.reduce<T | null>((a, r) => (!a || r.created_at > a.created_at ? r : a), null)

/** What the teacher sees on the lesson card. */
export function requestStatusText(
  r: Pick<CorrectionRequest, 'status' | 'decision_comment'>,
): string {
  if (r.status === 'pending') return 'Ждёт решения администратора'
  if (r.status === 'approved') return 'Исправлено'
  return r.decision_comment ? `Отклонено: ${r.decision_comment}` : 'Отклонено'
}

/** correct_attendance / requests error → why (lower case, follows a colon). */
export function correctionErrorReason(error: { code?: string; message?: string }): string {
  const m = error.message ?? ''
  if (!error.code) return 'нет связи с сервером — проверьте интернет'
  if (error.code === '42501') return 'недостаточно прав'
  if (error.code === 'PGRST202' || error.code === '42883')
    return 'сервер не обновлён — сообщите администратору'
  if (error.code === '23505') return 'запрос по этому занятию уже ждёт решения'
  if (m.includes('closed period')) return 'период закрыт — исправления только корректировкой ЗП'
  if (m.includes('freeze limit'))
    return m.includes('month')
      ? 'лимит заморозок 2 на месяц — отметьте «Не был»'
      : 'лимит заморозок 2 на абонемент — отметьте «Не был»'
  if (m.includes('reason is required')) return 'укажите причину'
  if (m.includes('reason is too long')) return 'причина — не длиннее 500 символов'
  if (m.includes('not found')) return 'запрос уже удалён — обновите страницу'
  if (m.includes('not held')) return 'занятие не проведено'
  if (m.includes('is rejected')) return 'запрос уже отклонён'
  if (m.includes('already approved') || m.includes('already decided')) return 'запрос уже применён'
  if (m.includes('not enrolled')) return 'состав группы изменился — обновите страницу'
  return 'ошибка сервера — попробуйте ещё раз'
}
