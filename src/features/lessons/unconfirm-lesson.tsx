// #95 · «Отменить проведение» — the admin returns a held lesson to planned (0027 unconfirm_lesson):
// the marks are deleted, the teacher's pending requests rejected; the dialog shows what the teacher
// loses (lesson_payroll_impact). A closed period refuses — the button in the dialog is off.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { AUDIT_KEY } from '@/features/audit/api'
import { FormDialog } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { releaseOverlayEntry } from '@/lib/use-back-close'
import type { LessonSheet } from './api'
import { unconfirmDoneText, unconfirmImpactText, unconfirmRequestsText } from './unconfirm'
import { lessonPayrollImpactQuery, unconfirmForm, unconfirmLesson } from './unconfirm-api'
import { refreshAfterLesson } from './use-confirm-lesson'

const outline =
  'flex min-h-11 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-card px-3 text-sm font-extrabold'

export function UnconfirmLesson({
  sheet,
  pendingRequests,
  onDone,
}: {
  sheet: LessonSheet
  /** Pending correction requests of the lesson — rejected with it. */
  pendingRequests: number
  /** Replace the sheet by the screen it came from (И64), at once — not after a history.back(). */
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={outline}
        onClick={() => {
          setOpen(true)
        }}
      >
        Отменить проведение
      </button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Отменить проведение?"
        description="Занятие вернётся в запланированные. Запись с причиной останется в журнале изменений."
      >
        {open && (
          <UnconfirmForm
            sheet={sheet}
            pendingRequests={pendingRequests}
            onCancel={() => {
              setOpen(false)
            }}
            onDone={() => {
              // The refetched sheet is «planned» and unmounts this button, and a history.back()
              // from the dialog's close would race the navigation: the dialog gives its phone
              // history entry up (no back on close) and the source replaces it right away.
              releaseOverlayEntry()
              setOpen(false)
              onDone()
            }}
          />
        )}
      </FormDialog>
    </>
  )
}

function UnconfirmForm({
  sheet,
  pendingRequests,
  onCancel,
  onDone,
}: {
  sheet: LessonSheet
  pendingRequests: number
  onCancel: () => void
  onDone: () => void
}) {
  const id = useId()
  const qc = useQueryClient()
  const impact = useQuery({ ...lessonPayrollImpactQuery(sheet.id), enabled: !sheet.is_locked })
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const requests = unconfirmRequestsText(pendingRequests)

  const mutation = useMutation({
    mutationFn: unconfirmLesson,
    onSuccess: () => {
      // the RPC is done: leave first, then the lists, payroll, balances and А10 refetch in the
      // background (as in #92) — the navigation does not wait for them
      toast.success(unconfirmDoneText(sheet.group.name, sheet.lesson_date))
      onDone()
      refreshAfterLesson(qc, sheet.id, sheet.group.id)
      void qc.invalidateQueries({ queryKey: [AUDIT_KEY] })
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (sheet.is_locked) return
    const parsed = unconfirmForm.safeParse({ lessonId: sheet.id, reason })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Укажите причину')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Отменить проведение"
      className="flex flex-col gap-3.5"
    >
      {sheet.is_locked ? (
        <p
          role="status"
          className="rounded-xl bg-line px-3 py-2.5 text-sm font-extrabold text-ink-muted"
        >
          Период закрыт — отменить нельзя
        </p>
      ) : impact.data ? (
        <p
          role="status"
          data-testid="unconfirm-impact"
          className="rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong"
        >
          {unconfirmImpactText(sheet.marks.size, impact.data, sheet.lesson_date)}
        </p>
      ) : impact.isError ? (
        <p role="status" className="text-xs font-bold text-ink-muted">
          Не удалось посчитать ЗП — база всё равно проверит при отмене.
          <span className="sr-only"> {impact.error.message}</span>
        </p>
      ) : (
        <div className="h-10 animate-pulse rounded-xl bg-muted" aria-hidden />
      )}
      {requests && !sheet.is_locked && (
        <p className="rounded-xl bg-warn-soft px-3 py-2.5 text-sm font-bold text-warn-strong">
          {requests}
        </p>
      )}
      <Field id={`${id}-reason`} label="Причина">
        <input
          id={`${id}-reason`}
          value={reason}
          maxLength={500}
          disabled={sheet.is_locked}
          placeholder="обязательно, например «провели не ту дату»"
          onChange={(e) => {
            setReason(e.target.value)
            setError(null)
          }}
          className={inputClass}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2.5">
        <SubmitButton variant="outline" onClick={onCancel}>
          Не отменять
        </SubmitButton>
        <SubmitButton
          variant="danger"
          pending={mutation.isPending}
          disabled={sheet.is_locked}
          className="text-center whitespace-normal"
        >
          Отменить проведение
        </SubmitButton>
      </div>
    </form>
  )
}
