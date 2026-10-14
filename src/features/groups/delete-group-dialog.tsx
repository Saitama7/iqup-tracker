import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { STUDENTS_KEY } from '@/features/students/api'
import { FormDialog } from '@/features/students/parts'
import { ErrorText, SubmitButton } from '@/features/tariffs/parts'
import { GROUPS_KEY } from './api'
import { TEACHER_GROUPS_KEY } from './teacher-api'
import { DELETE_BLOCKER_LABEL, deleteBlockersQuery, deleteGroup } from './undo-api'

/**
 * «Удалить группу» (#73): only an empty group (no marks, enrollments, trials, payments, closed
 * periods). Otherwise the dialog lists what stands in the way and points to «Архивировать».
 */
export function DeleteGroupDialog({
  open,
  onOpenChange,
  groupId,
  groupName,
  lessonsCount,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  groupName: string
  lessonsCount: number
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const blockers = useQuery(deleteBlockersQuery(groupId))
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => deleteGroup(groupId),
    onSuccess: async () => {
      onOpenChange(false)
      await navigate({ to: '/admin/groups' })
      queryClient.removeQueries({ queryKey: ['group-lessons', groupId] })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: GROUPS_KEY }),
        queryClient.invalidateQueries({ queryKey: STUDENTS_KEY }),
        queryClient.invalidateQueries({ queryKey: [TEACHER_GROUPS_KEY] }),
      ])
      toast.success(`Группа «${groupName}» удалена`)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  const close = () => {
    onOpenChange(false)
  }
  let body: ReactNode
  if (blockers.isPending) {
    body = <div className="h-16 animate-pulse rounded-xl bg-muted" aria-label="Загрузка" />
  } else if (blockers.isError) {
    body = <ErrorText>{blockers.error.message}</ErrorText>
  } else if (blockers.data.length > 0) {
    body = (
      <>
        <div role="status" className="flex flex-col gap-1.5">
          <p className="text-sm font-bold">Группу нельзя удалить:</p>
          <ul className="list-disc pl-5 text-sm font-bold text-burned-strong">
            {blockers.data.map((b) => (
              <li key={b}>{DELETE_BLOCKER_LABEL[b]}</li>
            ))}
          </ul>
          <p className="text-xs font-bold text-ink-muted">
            Архивируйте группу вместо удаления — история и оплаты останутся.
          </p>
        </div>
        <SubmitButton variant="outline" onClick={close}>
          Закрыть
        </SubmitButton>
      </>
    )
  } else {
    body = (
      <>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="grid grid-cols-2 gap-2.5">
          <SubmitButton variant="outline" onClick={close}>
            Не сейчас
          </SubmitButton>
          <SubmitButton
            variant="danger"
            pending={mutation.isPending}
            onClick={() => {
              setError(null)
              mutation.mutate()
            }}
          >
            Удалить группу
          </SubmitButton>
        </div>
      </>
    )
  }

  const empty = blockers.data?.length === 0
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={empty ? `Удалить группу «${groupName}»?` : 'Удалить группу'}
      description={
        empty
          ? `Расписание и ${lessonsCount} занятий будут удалены. Это нельзя отменить.`
          : `Группа «${groupName}»`
      }
    >
      {body}
    </FormDialog>
  )
}
