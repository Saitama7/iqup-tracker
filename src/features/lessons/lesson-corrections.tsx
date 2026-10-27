// #74 · A held lesson on У3 / УД2: the admin corrects its marks («Исправить отметки», reason
// required) and decides a teacher's request left from before #110 («Применить» / «Отклонить»).
// #110 (К10): the teacher of the lesson corrects own marks too — «Исправить отметки», the comment
// is optional — and sees the status of an old request. Closed period — no changes; a request left
// open there can only be rejected (reject_correction_request works on it).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { LessonSheet } from './api'
import { RequestMenu } from './delete-request'
import type { Mark, RosterRow } from './attendance'
import {
  applyRequest,
  correctAttendance,
  lessonRequestsQuery,
  rejectRequest,
  teacherCorrectAttendance,
  useCorrectionsRealtime,
} from './corrections-api'
import {
  changeLine,
  changesPayload,
  latestRequest,
  markChanges,
  requestChanges,
  requestStatusText,
  type CorrectionRequest,
  type MarkChange,
} from './corrections'

export interface Corrections {
  isAdmin: boolean
  /** The admin, or the teacher of the lesson (lessons.teacher_id, #110). */
  canFix: boolean
  locked: boolean
  /** Marks being corrected; null — showing the saved ones. */
  fix: ReadonlyMap<string, Mark> | null
  setFixMark: (studentId: string, mark: Mark) => void
  changes: MarkChange[]
  note: string
  setNote: (note: string) => void
  start: () => void
  cancel: () => void
  submit: () => void
  busy: boolean
  latest: CorrectionRequest | null
  /** The open request with «было → стало» (admin decides). */
  pending: { request: CorrectionRequest; changes: MarkChange[] } | null
  apply: (id: string) => void
  reject: (id: string, reason: string) => void
  deciding: boolean
}

export function useCorrections(
  sheet: LessonSheet,
  roster: readonly RosterRow[],
  isAdmin: boolean,
  /** The teacher of the lesson (lessons.teacher_id) — corrects own marks (#110). */
  ownLesson: boolean,
  /** The fix is saved — back to the screen the sheet came from (#89, #110). */
  onFixed?: () => void,
): Corrections {
  const queryClient = useQueryClient()
  const held = sheet.status === 'held'
  const requests = useQuery({ ...lessonRequestsQuery(sheet.id), enabled: held })
  useCorrectionsRealtime(held)
  const [fix, setFix] = useState<Map<string, Mark> | null>(null)
  const [note, setNote] = useState('')

  const changes = fix ? markChanges(roster, sheet.marks, fix) : []
  const latest = latestRequest(requests.data ?? [])
  const open = (requests.data ?? []).find((r) => r.status === 'pending') ?? null

  // Payroll, balances, debts, «Мой месяц», the journal — all derived from attendance: refetch all.
  const refresh = () => queryClient.invalidateQueries()
  const done = (text: string) => {
    toast.success(text)
    setFix(null)
    setNote('')
    void refresh()
  }
  const failed = (title: string) => (e: Error) => {
    toast.error(`${title}: ${e.message}`)
  }

  const canFix = isAdmin || ownLesson
  // the admin — a reason is required; the teacher — the comment is optional (К10)
  const ready = changes.length > 0 && (!isAdmin || note.trim() !== '')

  const save = useMutation({
    mutationFn: async () => {
      const payload = changesPayload(changes)
      if (isAdmin) await correctAttendance(sheet.id, payload, note)
      else await teacherCorrectAttendance(sheet.id, payload, note)
    },
    onSuccess: () => {
      done('Отметки исправлены')
      onFixed?.()
    },
    onError: failed('Не удалось исправить отметки'),
  })
  const apply = useMutation({
    mutationFn: applyRequest,
    onSuccess: (changed) => {
      done(
        changed > 0
          ? 'Запрос применён — отметки исправлены'
          : 'Запрос закрыт — отметки уже исправлены',
      )
    },
    onError: failed('Не удалось применить запрос'),
  })
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectRequest(id, reason),
    onSuccess: () => {
      done('Запрос отклонён')
    },
    onError: failed('Не удалось отклонить запрос'),
  })

  return {
    isAdmin,
    canFix,
    locked: sheet.is_locked,
    fix,
    setFixMark: (studentId, mark) => {
      if (fix && !save.isPending) setFix(new Map(fix).set(studentId, mark))
    },
    changes,
    note,
    setNote,
    start: () => {
      setFix(new Map(sheet.marks))
      setNote('')
    },
    cancel: () => {
      setFix(null)
      setNote('')
    },
    submit: () => {
      if (ready && !save.isPending) save.mutate()
    },
    busy: save.isPending,
    latest,
    pending: open ? { request: open, changes: requestChanges(open, roster, sheet.marks) } : null,
    apply: (id) => {
      apply.mutate(id)
    },
    reject: (id, reason) => {
      reject.mutate({ id, reason })
    },
    deciding: apply.isPending || reject.isPending,
  }
}

// ─── UI ─────────────────────────────────────────────────────────────────────

const outline =
  'flex min-h-11 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-card px-4 text-sm font-extrabold'
const primary =
  'flex min-h-11 items-center justify-center rounded-xl bg-ink px-4 text-sm font-extrabold text-brand disabled:opacity-50'
const field =
  'min-h-20 w-full rounded-xl border-[1.5px] border-line-strong bg-card px-3 py-2 text-base font-bold placeholder:text-placeholder'

const STATUS_TONE = {
  pending: 'bg-warn-soft text-warn-strong',
  approved: 'bg-present-soft text-present-strong',
  rejected: 'bg-burned-soft text-burned-deep',
} as const

function Changes({ changes, empty }: { changes: readonly MarkChange[]; empty?: string }) {
  if (changes.length === 0) {
    return empty ? <p className="text-[13px] font-bold text-ink-muted">{empty}</p> : null
  }
  return (
    <ul aria-label="Изменения" className="flex flex-col gap-1 text-[13px] font-extrabold">
      {changes.map((c) => (
        <li key={c.studentId}>{changeLine(c)}</li>
      ))}
    </ul>
  )
}

/**
 * Under the marks of a held lesson, instead of «Провести занятие». `unconfirm` — the admin's
 * «Отменить проведение» (#95), next to «Исправить отметки».
 */
export function HeldPanel({ c, unconfirm }: { c: Corrections; unconfirm?: ReactNode }) {
  const noteId = useId()
  if (c.locked) {
    return (
      <div className="flex flex-col gap-2.5">
        {c.isAdmin && c.pending && <RequestReview c={c} pending={c.pending} />}
        <p className="rounded-2xl bg-line px-4 py-3 text-center text-sm font-extrabold text-ink-muted">
          {c.isAdmin
            ? 'Период закрыт — отметки не меняются. Исправления — корректировкой ЗП'
            : 'Период закрыт — отметки не меняются'}
        </p>
        {c.isAdmin && unconfirm}
      </div>
    )
  }

  if (c.fix) {
    const label = c.isAdmin ? 'Причина исправления' : 'Комментарий (необязательно)'
    return (
      <div className="flex flex-col gap-2.5" aria-label="Исправление отметок">
        <Changes changes={c.changes} empty="Измените отметки в списке учеников" />
        <label htmlFor={noteId} className="text-xs font-extrabold text-ink-muted">
          {label}
        </label>
        <textarea
          id={noteId}
          value={c.note}
          maxLength={500}
          disabled={c.busy}
          onChange={(e) => {
            c.setNote(e.target.value)
          }}
          placeholder={
            c.isAdmin
              ? 'Например: перепутали, ученик не пришёл'
              : 'Например: Айжан не было, отметила по ошибке'
          }
          className={field}
        />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={outline} disabled={c.busy} onClick={c.cancel}>
            Отмена
          </button>
          <button
            type="button"
            className={primary}
            disabled={c.busy || c.changes.length === 0 || (c.isAdmin && !c.note.trim())}
            onClick={c.submit}
          >
            {c.busy ? 'Сохраняем…' : c.isAdmin ? 'Сохранить исправление' : 'Сохранить'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {c.isAdmin && c.pending && <RequestReview c={c} pending={c.pending} />}
      {!c.isAdmin && c.latest && (
        <p
          className={cn(
            'rounded-xl px-3.5 py-2.5 text-[13px] font-extrabold',
            STATUS_TONE[c.latest.status],
          )}
          data-testid="correction-status"
        >
          Запрос на исправление: {requestStatusText(c.latest)}
        </p>
      )}
      {c.canFix && (
        <div className={cn('grid gap-2', c.isAdmin && unconfirm && 'grid-cols-2')}>
          <button type="button" className={outline} onClick={c.start}>
            Исправить отметки
          </button>
          {c.isAdmin && unconfirm}
        </div>
      )}
    </div>
  )
}

function RequestReview({
  c,
  pending,
}: {
  c: Corrections
  pending: NonNullable<Corrections['pending']>
}) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const reasonId = useId()
  const { request } = pending
  // Fixed by hand meanwhile: nothing left to change — «Закрыть запрос» = apply → 0 (И52).
  const fixed = pending.changes.length === 0
  return (
    <section
      aria-label="Запрос учителя"
      className="flex flex-col gap-2 rounded-2xl bg-warn-soft p-3.5 text-warn-strong"
    >
      <div className="-my-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold">Учитель просит исправить отметки</h3>
        <RequestMenu requestId={request.id} />
      </div>
      <Changes changes={pending.changes} empty="Уже исправлено — отметки совпадают с запросом" />
      <p className="text-[13px] font-bold">«{request.comment}»</p>
      {c.locked && (
        <p className="text-[13px] font-extrabold">Период закрыт — можно только отклонить</p>
      )}
      {rejecting ? (
        <>
          <label htmlFor={reasonId} className="text-xs font-extrabold">
            Причина отказа — её увидит учитель
          </label>
          <textarea
            id={reasonId}
            value={reason}
            maxLength={500}
            disabled={c.deciding}
            onChange={(e) => {
              setReason(e.target.value)
            }}
            className={cn(field, 'text-ink')}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={outline}
              disabled={c.deciding}
              onClick={() => {
                setRejecting(false)
              }}
            >
              Назад
            </button>
            <button
              type="button"
              className={cn(primary, 'bg-burned text-white')}
              disabled={c.deciding || !reason.trim()}
              onClick={() => {
                c.reject(request.id, reason)
              }}
            >
              Отклонить запрос
            </button>
          </div>
        </>
      ) : (
        <div className={cn('grid gap-2', !c.locked && 'grid-cols-2')}>
          <button
            type="button"
            className={cn(outline, 'text-burned-strong')}
            disabled={c.deciding}
            onClick={() => {
              setRejecting(true)
            }}
          >
            Отклонить
          </button>
          {!c.locked && (
            <button
              type="button"
              className={primary}
              disabled={c.deciding}
              onClick={() => {
                c.apply(request.id)
              }}
            >
              {fixed ? 'Закрыть запрос' : 'Применить'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
