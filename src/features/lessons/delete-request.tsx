// #94 · «⋯ → Удалить запрос» on the teacher's correction request (admin): a mistaken request goes
// away with a reason (delete_correction_request, audited).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AUDIT_KEY } from '@/features/audit/api'
import { FormDialog } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { CORRECTIONS_KEY, deleteCorrectionRequest, deleteRequestForm } from './corrections-api'

export function RequestMenu({ requestId }: { requestId: string }) {
  const [menu, setMenu] = useState(false)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger
          aria-label="Действия с запросом"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-warn-soft"
        >
          <MoreHorizontal className="size-5" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-56 flex-col p-1.5">
          <button
            type="button"
            className="flex min-h-11 items-center rounded-xl px-3 text-left text-sm font-bold text-burned-strong hover:bg-muted"
            onClick={() => {
              setMenu(false)
              setOpen(true)
            }}
          >
            Удалить запрос
          </button>
        </PopoverContent>
      </Popover>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Удалить запрос?"
        description="Запрос учителя исчезнет. Запись с причиной останется в журнале изменений."
      >
        {open && (
          <DeleteForm
            requestId={requestId}
            onClose={() => {
              setOpen(false)
            }}
          />
        )}
      </FormDialog>
    </>
  )
}

function DeleteForm({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const id = useId()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: deleteCorrectionRequest,
    onSuccess: () => {
      toast.success('Запрос удалён')
      onClose()
      void qc.invalidateQueries({ queryKey: [CORRECTIONS_KEY] })
      void qc.invalidateQueries({ queryKey: [AUDIT_KEY] })
    },
    onError: (e) => {
      setError(`Не удалось удалить: ${e.message}`)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = deleteRequestForm.safeParse({ requestId, reason })
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
      aria-label="Удалить запрос"
      className="flex flex-col gap-3.5"
    >
      <Field id={`${id}-reason`} label="Причина">
        <input
          id={`${id}-reason`}
          value={reason}
          maxLength={500}
          placeholder="обязательно, например «запрос по ошибке»"
          onChange={(e) => {
            setReason(e.target.value)
            setError(null)
          }}
          className={inputClass}
        />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2.5">
        <SubmitButton variant="outline" onClick={onClose}>
          Не удалять
        </SubmitButton>
        <SubmitButton variant="danger" pending={mutation.isPending}>
          Удалить запрос
        </SubmitButton>
      </div>
    </form>
  )
}
