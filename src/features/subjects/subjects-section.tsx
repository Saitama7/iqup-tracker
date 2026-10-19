import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import {
  cardClass,
  chipClass,
  ErrorText,
  Field,
  inputClass,
  SmallDialog,
  SubmitButton,
} from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import { AUDIT_KEY } from '@/features/audit/api'
import { FormDialog } from '@/features/students/parts'
import {
  createSubject,
  deleteSubject,
  deleteSubjectForm,
  subjectForm,
  subjectsQuery,
  updateSubject,
  type Subject,
} from './api'

/**
 * «Предметы» on А9 (#42): the list «Новая группа» offers. Hiding keeps the subject on existing
 * groups and only drops it from the form; renaming shows everywhere at once (groups embed it).
 */
export function SubjectsSection() {
  const query = useQuery(subjectsQuery())
  const subjects = query.data ?? []
  const [adding, setAdding] = useState(false)
  // Kept after closing so the dialog does not go blank during its exit animation.
  const [renaming, setRenaming] = useState<Subject | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [removing, setRemoving] = useState<Subject | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const queryClient = useQueryClient()

  const toggle = useMutation({
    mutationFn: (s: Subject) => updateSubject(s.id, { is_active: !s.is_active }),
    onSuccess: async (_, s) => {
      await queryClient.invalidateQueries()
      toast.success(s.is_active ? `«${s.name}» скрыт из новых групп` : `«${s.name}» снова в списке`)
    },
    onError: (e) => {
      toast.error(e.message)
    },
  })

  return (
    <section aria-label="Предметы" className={cn(cardClass, 'flex flex-col')}>
      <div className="flex flex-nowrap items-center justify-between gap-2.5 border-b border-line px-[18px] py-3.5">
        <div>
          <h2 className="text-[15px] font-extrabold">Предметы</h2>
          <p className="text-xs font-bold text-ink-muted">
            список в «Новой группе»; скрытый предмет остаётся у существующих групп
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAdding(true)
          }}
          className="flex min-h-11 shrink-0 items-center gap-1 rounded-[10px] border-[1.5px] border-line-strong bg-card px-3.5 text-xs font-extrabold whitespace-nowrap"
        >
          <Plus className="size-3.5" aria-hidden />
          Добавить
        </button>
      </div>
      {query.isPending ? (
        <div className="h-24 animate-pulse" aria-label="Загрузка" />
      ) : query.isError ? (
        <p role="alert" className="px-[18px] py-4 text-sm font-bold text-burned">
          Не удалось загрузить предметы
        </p>
      ) : (
        <ul aria-label="Список предметов">
          {subjects.map((s) => (
            <li
              key={s.id}
              className={cn(
                'flex min-h-12 items-center justify-between gap-3 border-b border-line py-1.5 pr-2 pl-[18px] text-sm last:border-0',
                !s.is_active && 'text-ink-muted',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-extrabold">{s.name}</span>
                {!s.is_active && <span className={cn(chipClass, 'bg-muted')}>скрыт</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Переименовать: ${s.name}`}
                  onClick={() => {
                    setRenaming(s)
                    setRenameOpen(true)
                  }}
                  className="flex size-11 items-center justify-center rounded-full text-ink-muted hover:text-ink"
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`${s.is_active ? 'Скрыть' : 'Показать'}: ${s.name}`}
                  disabled={toggle.isPending}
                  onClick={() => {
                    toggle.mutate(s)
                  }}
                  className="min-h-11 min-w-24 rounded-[10px] border-[1.5px] border-line-strong bg-card px-3 text-xs font-extrabold whitespace-nowrap disabled:opacity-50"
                >
                  {s.is_active ? 'Скрыть' : 'Показать'}
                </button>
                <button
                  type="button"
                  aria-label={`Удалить: ${s.name}`}
                  onClick={() => {
                    setRemoving(s)
                    setRemoveOpen(true)
                  }}
                  className="min-h-11 rounded-[10px] border-[1.5px] border-line-strong bg-card px-3 text-xs font-extrabold whitespace-nowrap text-burned-strong"
                >
                  Удалить
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <SubjectDialog open={adding} onOpenChange={setAdding} subject={null} subjects={subjects} />
      <SubjectDialog
        open={renameOpen && renaming !== null}
        onOpenChange={setRenameOpen}
        subject={renaming}
        subjects={subjects}
      />
      <DeleteSubjectDialog
        subject={removing}
        open={removeOpen}
        onClose={() => {
          setRemoveOpen(false)
        }}
      />
    </section>
  )
}

/** «Удалить предмет?»: only a subject no group uses; otherwise the database says «скройте». */
function DeleteSubjectDialog({
  subject,
  open,
  onClose,
}: {
  subject: Subject | null
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: deleteSubject,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: subjectsQuery().queryKey }),
        queryClient.invalidateQueries({ queryKey: [AUDIT_KEY] }),
      ])
      toast.success(`Предмет «${subject?.name ?? ''}» удалён`)
      setReason('')
      onClose()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = deleteSubjectForm.safeParse({ id: subject?.id, reason })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Укажите причину')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  return (
    <FormDialog
      open={open && subject !== null}
      onOpenChange={(o) => {
        if (!o) {
          setError(null)
          onClose()
        }
      }}
      title="Удалить предмет?"
      description={
        subject
          ? `«${subject.name}». Удалить можно, только если ни одна группа его не использует. Запись с причиной останется в журнале.`
          : ''
      }
    >
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Удалить предмет"
        className="flex flex-col gap-3.5"
      >
        <Field id={reasonId} label="Причина">
          <input
            id={reasonId}
            value={reason}
            maxLength={500}
            autoComplete="off"
            placeholder="обязательно, например «завели по ошибке»"
            className={inputClass}
            onChange={(e) => {
              setReason(e.target.value)
              setError(null)
            }}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="grid grid-cols-2 gap-2.5">
          <SubmitButton variant="outline" onClick={onClose}>
            Не удалять
          </SubmitButton>
          <SubmitButton variant="danger" pending={mutation.isPending}>
            Удалить предмет
          </SubmitButton>
        </div>
      </form>
    </FormDialog>
  )
}

/** «Новый предмет» (subject = null) or «Переименовать предмет». */
function SubjectDialog({
  open,
  onOpenChange,
  subject,
  subjects,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  subject: Subject | null
  subjects: readonly Subject[]
}) {
  const queryClient = useQueryClient()
  const nameId = useId()
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const value = name ?? subject?.name ?? ''

  const mutation = useMutation({
    mutationFn: async (next: string) => {
      if (subject) await updateSubject(subject.id, { name: next })
      else await createSubject(next, subjects)
    },
    onSuccess: async () => {
      // Groups embed the subject name — every screen may show it.
      await queryClient.invalidateQueries()
      toast.success(subject ? 'Предмет переименован' : 'Предмет добавлен')
      close()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function close() {
    setName(null)
    setError(null)
    onOpenChange(false)
  }

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = subjectForm.safeParse({ name: value })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте название')
      return
    }
    if (subject && parsed.data.name === subject.name) {
      close()
      return
    }
    setError(null)
    mutation.mutate(parsed.data.name)
  }

  const title = subject ? 'Переименовать предмет' : 'Новый предмет'
  return (
    <SmallDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close()
        else onOpenChange(o)
      }}
      title={title}
      description={
        subject
          ? 'Новое название появится у всех групп этого предмета.'
          : 'Предмет появится в списке «Новой группы».'
      }
    >
      <form onSubmit={onSubmit} noValidate aria-label={title} className="flex flex-col gap-3.5">
        <Field id={nameId} label="Название">
          <input
            id={nameId}
            placeholder="Физика"
            autoComplete="off"
            className={inputClass}
            value={value}
            onChange={(e) => {
              setName(e.target.value)
            }}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>
          {subject ? 'Сохранить' : 'Добавить'}
        </SubmitButton>
      </form>
    </SmallDialog>
  )
}
