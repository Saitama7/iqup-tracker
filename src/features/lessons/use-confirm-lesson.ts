// «Провести / Подтвердить занятие»: the lesson turns held in the caches only after the database
// answered (#41 — a silent failure looked like success). Offline the mutation waits for the network
// (TanStack onlineManager, networkMode 'online') and is sent when it is back, even if the page is gone
// by then: these callbacks live in the mutation options, not in mutate().
import { onlineManager, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { lessonsKey } from '@/features/groups/api'
import { TEACHER_GROUPS_KEY } from '@/features/groups/teacher-api'
import { BALANCES_KEY } from '@/features/payments/api'
import { PAYROLL_KEY } from '@/features/payroll/api'
import { ADMIN_LESSONS_KEY } from '@/features/schedule/api'
import { STUDENTS_KEY } from '@/features/students/api'
import {
  confirmLesson,
  lessonKey,
  LessonsApiError,
  TODAY_KEY,
  type LessonSheet,
  type TeacherLesson,
} from './api'
import type { Mark } from './attendance'
import { clearDraft } from './draft'
import { bishkekTime, type ConfirmCopy } from './select'

interface Variables {
  marks: { student_id: string; status: Mark }[]
  /** Toast texts by the verb of the button. */
  copy: ConfirmCopy
}

const MAX_RETRIES = 3

function counts(marks: Variables['marks']): TeacherLesson['marks'] {
  const n = (s: Mark) => marks.filter((m) => m.status === s).length
  return { present: n('present'), frozen: n('absent_frozen'), burned: n('absent_burned') }
}

/** The database said held — show it at once, the refetch below brings the rest. */
function applyHeld(qc: QueryClient, lessonId: string, v: Variables, confirmedAt: string | null) {
  qc.setQueryData<LessonSheet | null>(lessonKey(lessonId), (old) =>
    old
      ? {
          ...old,
          status: 'held',
          confirmed_at: confirmedAt ?? old.confirmed_at,
          marks: new Map(v.marks.map((m) => [m.student_id, m.status])),
        }
      : old,
  )
  qc.setQueriesData<TeacherLesson[]>({ queryKey: [TODAY_KEY] }, (old) =>
    old?.map((l) =>
      l.id === lessonId
        ? {
            ...l,
            status: 'held',
            confirmed_at: confirmedAt ?? l.confirmed_at,
            marks: counts(v.marks),
          }
        : l,
    ),
  )
}

/** «Сегодня», «Требует внимания» (У2 / УД1 / А1), «Мой месяц», ЗП, балансы учеников. */
export function refreshAfterLesson(qc: QueryClient, lessonId: string, groupId: string) {
  for (const queryKey of [
    lessonKey(lessonId),
    [TODAY_KEY],
    [TEACHER_GROUPS_KEY],
    lessonsKey(groupId),
    [ADMIN_LESSONS_KEY],
    [PAYROLL_KEY],
    STUDENTS_KEY,
    [BALANCES_KEY],
    ['teacher-summary'],
    ['student-attendance'],
  ]) {
    void qc.invalidateQueries({ queryKey })
  }
}

export function useConfirmLesson(lessonId: string, groupId: string) {
  const qc = useQueryClient()
  return useMutation<string | null, Error, Variables>({
    mutationKey: ['confirm-lesson', lessonId],
    mutationFn: (v) => confirmLesson(lessonId, v.marks),
    retry: (count, error) =>
      error instanceof LessonsApiError && error.kind === 'offline' && count < MAX_RETRIES,
    onMutate: () => {
      if (!onlineManager.isOnline()) {
        toast('Нет сети — отправим отметки, когда появится связь')
      }
    },
    onSuccess: (confirmedAt, v) => {
      applyHeld(qc, lessonId, v, confirmedAt)
      clearDraft(lessonId)
      toast.success(confirmedAt ? `${v.copy.done} · ${bishkekTime(confirmedAt)}` : v.copy.done)
    },
    onError: (error, v) => {
      const reason = error instanceof LessonsApiError ? error.message : 'попробуйте ещё раз'
      toast.error(`${v.copy.failed}: ${reason}`)
    },
    onSettled: () => {
      refreshAfterLesson(qc, lessonId, groupId)
    },
  })
}
