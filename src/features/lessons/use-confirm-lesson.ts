// «Провести занятие»: optimistic — the lesson turns held in every cache at once; offline the mutation
// waits for the network (TanStack onlineManager, networkMode 'online') and is sent when it is back,
// even if the page is gone by then: callbacks live in the mutation options, not in mutate().
import { onlineManager, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { lessonsKey } from '@/features/groups/api'
import { TEACHER_GROUPS_KEY } from '@/features/groups/teacher-api'
import { PAYROLL_KEY } from '@/features/payroll/api'
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
import { bishkekTime } from './select'

interface Variables {
  marks: { student_id: string; status: Mark }[]
  /** useNow() at the tap — the optimistic confirmed_at until the database answers. */
  now: number
}

interface Snapshot {
  sheet: LessonSheet | null | undefined
  today: [readonly unknown[], TeacherLesson[] | undefined][]
}

const MAX_RETRIES = 3

function counts(marks: Variables['marks']): TeacherLesson['marks'] {
  const n = (s: Mark) => marks.filter((m) => m.status === s).length
  return { present: n('present'), frozen: n('absent_frozen'), burned: n('absent_burned') }
}

function applyHeld(qc: QueryClient, lessonId: string, v: Variables) {
  const confirmedAt = new Date(v.now).toISOString()
  qc.setQueryData<LessonSheet | null>(lessonKey(lessonId), (old) =>
    old
      ? {
          ...old,
          status: 'held',
          confirmed_at: confirmedAt,
          marks: new Map(v.marks.map((m) => [m.student_id, m.status])),
        }
      : old,
  )
  qc.setQueriesData<TeacherLesson[]>({ queryKey: [TODAY_KEY] }, (old) =>
    old?.map((l) =>
      l.id === lessonId
        ? { ...l, status: 'held', confirmed_at: confirmedAt, marks: counts(v.marks) }
        : l,
    ),
  )
}

async function refresh(qc: QueryClient, lessonId: string, groupId: string) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: lessonKey(lessonId) }),
    qc.invalidateQueries({ queryKey: [TODAY_KEY] }),
    qc.invalidateQueries({ queryKey: [TEACHER_GROUPS_KEY] }),
    qc.invalidateQueries({ queryKey: lessonsKey(groupId) }),
    qc.invalidateQueries({ queryKey: [PAYROLL_KEY] }),
  ])
}

export function useConfirmLesson(lessonId: string, groupId: string) {
  const qc = useQueryClient()
  return useMutation<string, Error, Variables, Snapshot>({
    mutationKey: ['confirm-lesson', lessonId],
    mutationFn: (v) => confirmLesson(lessonId, v.marks),
    retry: (count, error) =>
      error instanceof LessonsApiError && error.kind === 'offline' && count < MAX_RETRIES,
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: lessonKey(lessonId) })
      await qc.cancelQueries({ queryKey: [TODAY_KEY] })
      const snapshot: Snapshot = {
        sheet: qc.getQueryData<LessonSheet | null>(lessonKey(lessonId)),
        today: qc.getQueriesData<TeacherLesson[]>({ queryKey: [TODAY_KEY] }),
      }
      applyHeld(qc, lessonId, v)
      if (!onlineManager.isOnline()) {
        toast('Нет сети — занятие проведём, когда появится связь')
      }
      return snapshot
    },
    onSuccess: (confirmedAt) => {
      clearDraft(lessonId)
      toast.success(`Занятие проведено · ${bishkekTime(confirmedAt)}`)
    },
    onError: (error, _v, snapshot) => {
      // A retry after a lost response: the first call went through.
      if (error instanceof LessonsApiError && error.kind === 'already_confirmed') {
        clearDraft(lessonId)
        toast.success('Занятие проведено')
        return
      }
      if (snapshot) {
        qc.setQueryData(lessonKey(lessonId), snapshot.sheet)
        for (const [key, data] of snapshot.today) qc.setQueryData(key, data)
      }
      toast.error(error.message)
    },
    onSettled: () => refresh(qc, lessonId, groupId),
  })
}
