import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useId, useState, type ReactNode, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { payrollImpactLines } from '@/features/students/delete-impact'
import { refreshAfterDelete } from '@/features/students/delete-refresh'
import { FormDialog } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { releaseOverlayEntry } from '@/lib/use-back-close'
import { deleteGroup, deleteGroupForm, groupDeletePreviewQuery } from './delete-group-api'
import { groupDeleteSummary, groupDeletedText, groupRefusals } from './delete-group'

/**
 * «Удалить группу» (#94): the group goes with its lessons, marks, enrollments and trials, with a
 * reason; the payroll the teachers lose is shown first. Student payments stop it — transfer or archive.
 */
export function DeleteGroupDialog({
  open,
  onOpenChange,
  groupId,
  groupName,
  onArchive,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  groupName: string
  /** Opens «Архивировать» instead of this dialog (the way out when payments stop the delete). */
  onArchive?: () => void
}) {
  const id = useId()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const preview = useQuery(groupDeletePreviewQuery(groupId))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: deleteGroup,
    onSuccess: async () => {
      // leave first: the group page would refetch a group that no longer exists
      releaseOverlayEntry()
      onOpenChange(false)
      qc.removeQueries({ queryKey: ['group-lessons', groupId] })
      await navigate({ to: '/admin/groups' })
      toast.success(groupDeletedText(groupName))
      void refreshAfterDelete(qc)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  const close = () => {
    onOpenChange(false)
  }

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = deleteGroupForm.safeParse({ groupId, reason })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Укажите причину')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  let body: ReactNode
  if (preview.isPending) {
    body = <div className="h-16 animate-pulse rounded-xl bg-muted" aria-label="Загрузка" />
  } else if (preview.isError) {
    body = <ErrorText>{preview.error.message}</ErrorText>
  } else if (preview.data.preview.blockers.length > 0) {
    const refusals = groupRefusals(preview.data.preview)
    body = (
      <>
        <div
          role="alert"
          data-testid="group-delete-blockers"
          className="flex flex-col gap-1.5 rounded-xl bg-burned-soft px-3 py-2.5 text-sm font-bold text-burned-deep"
        >
          {refusals.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <SubmitButton variant="outline" onClick={close}>
            Закрыть
          </SubmitButton>
          {onArchive && (
            <SubmitButton variant="outline" onClick={onArchive}>
              Архивировать
            </SubmitButton>
          )}
        </div>
      </>
    )
  } else {
    const lines = payrollImpactLines(preview.data.impact)
    body = (
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Удалить группу"
        className="flex flex-col gap-3.5"
      >
        <div
          role="status"
          data-testid="group-delete-impact"
          className="flex flex-col gap-1 rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong"
        >
          <p>{groupDeleteSummary(preview.data.preview)}</p>
          {lines.length > 0 ? (
            lines.map((l) => <p key={l}>{l}</p>)
          ) : (
            <p>начислений по группе нет</p>
          )}
        </div>
        <Field id={`${id}-reason`} label="Причина">
          <input
            id={`${id}-reason`}
            value={reason}
            maxLength={500}
            placeholder="обязательно, например «создали по ошибке»"
            onChange={(e) => {
              setReason(e.target.value)
              setError(null)
            }}
            className={inputClass}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="grid grid-cols-2 gap-2.5">
          <SubmitButton variant="outline" onClick={close}>
            Не сейчас
          </SubmitButton>
          <SubmitButton variant="danger" pending={mutation.isPending}>
            Удалить группу
          </SubmitButton>
        </div>
      </form>
    )
  }

  const allowed = preview.data?.preview.blockers.length === 0
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={allowed ? `Удалить группу «${groupName}»?` : 'Удалить группу'}
      description={
        allowed
          ? 'Это нельзя отменить. Запись с причиной останется в журнале изменений.'
          : `Группа «${groupName}»`
      }
    >
      {body}
    </FormDialog>
  )
}
