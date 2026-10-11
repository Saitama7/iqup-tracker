import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { maskPhoneInput } from '@/lib/phone-input'
import { createStudent, STUDENTS_KEY, studentForm, updateStudent } from './api'
import type { StudentRow } from './model'
import { FormDialog, NativeSelect } from './parts'

/** «+ Новый ученик» (А5) and «Изменить» (А6): name, class, parent, «бывший ученик», «привёл …». */
export function StudentFormDialog({
  open,
  onOpenChange,
  student,
  students,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing this student; omitted — a new one. */
  student?: StudentRow
  /** Everyone, for «Привёл». */
  students: readonly StudentRow[]
  onSaved?: (id: string) => void
}) {
  const ids = {
    name: useId(),
    grade: useId(),
    parent: useId(),
    phone: useId(),
    returning: useId(),
    referrer: useId(),
    notes: useId(),
  }
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState(student?.full_name ?? '')
  const [grade, setGrade] = useState(student?.grade != null ? String(student.grade) : '')
  const [parentName, setParentName] = useState(student?.parent_name ?? '')
  const [parentPhone, setParentPhone] = useState(
    student?.parent_phone ? maskPhoneInput(student.parent_phone) : '',
  )
  const [isReturning, setIsReturning] = useState(student?.is_returning ?? false)
  const [referredBy, setReferredBy] = useState(student?.referred_by_student_id ?? '')
  const [notes, setNotes] = useState(student?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const referrers = students
    .filter((s) => s.id !== student?.id)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'))

  const mutation = useMutation({
    mutationFn: async (input: ReturnType<typeof studentForm.parse>) => {
      if (student) {
        await updateStudent(student.id, input)
        return student.id
      }
      return createStudent(input)
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: STUDENTS_KEY })
      toast.success(student ? 'Сохранено' : 'Ученик добавлен')
      onOpenChange(false)
      onSaved?.(id)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = studentForm.safeParse({
      fullName,
      grade,
      parentName,
      parentPhone,
      isReturning,
      referredBy,
      notes,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  const title = student ? 'Изменить ученика' : 'Новый ученик'
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
      title={title}
      description={
        student ? student.full_name : 'Затем зачислите в группу — абонемент создастся сам.'
      }
    >
      <form onSubmit={onSubmit} noValidate aria-label={title} className="flex flex-col gap-3.5">
        <Field id={ids.name} label="Имя и фамилия">
          <input
            id={ids.name}
            className={inputClass}
            placeholder="Нурлан Асанов"
            autoComplete="off"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value)
            }}
          />
        </Field>
        <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2.5">
          <Field id={ids.grade} label="Класс">
            <input
              id={ids.grade}
              inputMode="numeric"
              className={inputClass}
              placeholder="8"
              autoComplete="off"
              value={grade}
              onChange={(e) => {
                setGrade(e.target.value.replace(/\D/g, '').slice(0, 2))
              }}
            />
          </Field>
          <Field id={ids.parent} label="Родитель">
            <input
              id={ids.parent}
              className={inputClass}
              placeholder="Асан Асанов"
              autoComplete="off"
              value={parentName}
              onChange={(e) => {
                setParentName(e.target.value)
              }}
            />
          </Field>
        </div>
        <Field id={ids.phone} label="Телефон родителя">
          <div className="flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 focus-within:border-ink">
            <span className="font-extrabold text-ink-muted">+996</span>
            <input
              id={ids.phone}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="555 000 000"
              className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:font-semibold placeholder:text-placeholder"
              value={parentPhone}
              onChange={(e) => {
                setParentPhone(maskPhoneInput(e.target.value))
              }}
            />
          </div>
        </Field>
        <div className="flex min-h-11 items-center gap-3 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 py-2">
          <input
            id={ids.returning}
            type="checkbox"
            className="size-5 shrink-0 accent-ink"
            checked={isReturning}
            onChange={(e) => {
              setIsReturning(e.target.checked)
            }}
          />
          <label htmlFor={ids.returning} className="flex flex-1 cursor-pointer flex-col">
            <span className="text-sm font-extrabold">Бывший ученик</span>
            <span className="text-xs font-bold text-ink-muted">
              скидка 15 % на первый абонемент
            </span>
          </label>
        </div>
        <Field id={ids.referrer} label="Привёл">
          <NativeSelect
            id={ids.referrer}
            value={referredBy}
            onChange={(e) => {
              setReferredBy(e.target.value)
            }}
          >
            <option value="">— никто —</option>
            {referrers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={ids.notes} label="Заметки">
          <textarea
            id={ids.notes}
            rows={3}
            className={`${inputClass} py-2.5`}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
            }}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>
          {student ? 'Сохранить' : 'Создать'}
        </SubmitButton>
      </form>
    </FormDialog>
  )
}
