import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { useId, useState, type ReactNode, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import { releaseOverlayEntry } from '@/lib/use-back-close'
import { payrollImpactLines } from './delete-impact'
import { refreshAfterDelete } from './delete-refresh'
import { studentDeletedText, studentDeleteSummary, studentRefusals } from './delete-student'
import { deleteStudent, deleteStudentForm, studentDeletePreviewQuery } from './delete-student-api'
import { FormDialog } from './parts'

/** «⋯» in the student header: the only item is «Удалить ученика» (red). */
export function StudentMenu({
  name,
  onDelete,
  className,
}: {
  name: string
  onDelete: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Действия: ${name}`}
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-muted',
          className,
        )}
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-52 flex-col p-1.5">
        <button
          type="button"
          className="flex min-h-11 items-center rounded-xl px-3 text-left text-sm font-bold text-burned-strong hover:bg-muted"
          onClick={() => {
            setOpen(false)
            onDelete()
          }}
        >
          Удалить ученика
        </button>
      </PopoverContent>
    </Popover>
  )
}

/** «Удалить ученика» (#94, И85): what goes with him, what the teachers lose, a reason. */
export function DeleteStudentDialog({
  open,
  onOpenChange,
  studentId,
  studentName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  studentId: string
  studentName: string
}) {
  const id = useId()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const preview = useQuery(studentDeletePreviewQuery(studentId))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: deleteStudent,
    onSuccess: async () => {
      releaseOverlayEntry()
      onOpenChange(false)
      await navigate({ to: '/admin/students' })
      toast.success(studentDeletedText(studentName))
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
    const parsed = deleteStudentForm.safeParse({ studentId, reason })
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
    body = (
      <>
        <div
          role="alert"
          data-testid="student-delete-blockers"
          className="flex flex-col gap-1.5 rounded-xl bg-burned-soft px-3 py-2.5 text-sm font-bold text-burned-deep"
        >
          {studentRefusals(preview.data.preview.blockers).map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
        <SubmitButton variant="outline" onClick={close}>
          Закрыть
        </SubmitButton>
      </>
    )
  } else {
    const lines = payrollImpactLines(preview.data.impact)
    body = (
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Удалить ученика"
        className="flex flex-col gap-3.5"
      >
        <div
          role="status"
          data-testid="student-delete-impact"
          className="flex flex-col gap-1 rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong"
        >
          <p>{studentDeleteSummary(preview.data.preview)}</p>
          {lines.length > 0 ? lines.map((l) => <p key={l}>{l}</p>) : <p>начислений нет</p>}
        </div>
        <Field id={`${id}-reason`} label="Причина">
          <input
            id={`${id}-reason`}
            value={reason}
            maxLength={500}
            placeholder="обязательно, например «завели дубль»"
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
            Удалить ученика
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
      title={allowed ? `Удалить ученика «${studentName}»?` : 'Удалить ученика'}
      description={
        allowed
          ? 'Это нельзя отменить. Запись с причиной останется в журнале изменений.'
          : studentName
      }
    >
      {body}
    </FormDialog>
  )
}
