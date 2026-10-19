// #94 · «⋯ → Изменить / Вернуть в воронку» of a trial on А11 (admin). One menu on every row / card,
// two dialogs; the state lives in useTrialEditor() of the page.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { AUDIT_KEY } from '@/features/audit/api'
import { ADMIN_LESSONS_KEY } from '@/features/schedule/api'
import { FormDialog, NativeSelect } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { maskPhoneInput } from '@/lib/phone-input'
import { cn } from '@/lib/utils'
import { groupLessonsQuery, pastLessonsQuery, TRIALS_KEY } from './api'
import {
  editTrialForm,
  lessonPickerKind,
  REOPEN_LABEL,
  reopenTarget,
  reopenTrial,
  reopenTrialForm,
  updateTrial,
} from './edit-api'
import {
  lessonOptionLabel,
  SOURCE_LABEL,
  TRIAL_SOURCES,
  trialGroupLabel,
  trialWhen,
  type Trial,
  type TrialSource,
} from './model'

export type TrialAction = 'edit' | 'reopen'

/** «⋯» of a trial row: «Изменить» always, «Вернуть в воронку» for a closed one. */
export function TrialMenu({
  trial,
  onAction,
  className,
}: {
  trial: Pick<Trial, 'full_name' | 'status'>
  onAction: (action: TrialAction) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const item =
    'flex min-h-11 items-center rounded-xl px-3 text-left text-sm font-bold hover:bg-muted'
  const pick = (action: TrialAction) => {
    setOpen(false)
    onAction(action)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Действия: ${trial.full_name}`}
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-muted',
          className,
        )}
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-56 flex-col p-1.5">
        <button
          type="button"
          className={item}
          onClick={() => {
            pick('edit')
          }}
        >
          Изменить
        </button>
        {trial.status === 'closed' && (
          <button
            type="button"
            className={item}
            onClick={() => {
              pick('reopen')
            }}
          >
            Вернуть в воронку
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      [TRIALS_KEY, ADMIN_LESSONS_KEY, AUDIT_KEY].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    )
}

/** State of the menu and both dialogs on the page. */
export function useTrialEditor(today: string) {
  const [state, setState] = useState<{ trial: Trial; action: TrialAction } | null>(null)
  const close = () => {
    setState(null)
  }
  return {
    open: (trial: Trial, action: TrialAction) => {
      setState({ trial, action })
    },
    dialogs: state ? (
      state.action === 'edit' ? (
        <EditTrialDialog key={state.trial.id} trial={state.trial} today={today} onClose={close} />
      ) : (
        <ReopenTrialDialog key={state.trial.id} trial={state.trial} today={today} onClose={close} />
      )
    ) : null,
  }
}

function EditTrialDialog({
  trial,
  today,
  onClose,
}: {
  trial: Trial
  today: string
  onClose: () => void
}) {
  const id = useId()
  const invalidate = useInvalidate()
  const kind = lessonPickerKind(trial.status)
  const groupId = kind ? trial.group_id : null
  const ahead = useQuery(groupLessonsQuery(kind === 'ahead' ? groupId : null, today, 20))
  const past = useQuery(pastLessonsQuery(kind === 'past' ? groupId : null, today, 20))
  const lessons = kind === 'ahead' ? ahead : past
  const options = (lessons.data ?? []).filter((l) => l.id !== trial.lesson_id)

  const [fullName, setFullName] = useState(trial.full_name)
  const [grade, setGrade] = useState(trial.grade ? String(trial.grade) : '')
  const [phone, setPhone] = useState(trial.parent_phone ? maskPhoneInput(trial.parent_phone) : '')
  const [source, setSource] = useState<TrialSource | ''>(trial.source ?? '')
  const [note, setNote] = useState(trial.note ?? '')
  const [lessonId, setLessonId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const currentLesson = lessonOptionLabel(trial.lessonDate, trial.lessonStart, today)

  const mutation = useMutation({
    mutationFn: updateTrial,
    onSuccess: () => {
      void invalidate()
      toast.success('Пробное изменено')
      onClose()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = editTrialForm.safeParse({
      trialId: trial.id,
      fullName,
      grade,
      phone,
      source,
      note,
      lessonId,
      reason,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  const clear = () => {
    setError(null)
  }

  return (
    <FormDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title="Изменить пробное"
      description={`${trial.full_name} · ${trialGroupLabel(trial.group)}`}
    >
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Изменить пробное"
        className="flex flex-col gap-3.5"
      >
        <Field id={`${id}-name`} label="Имя">
          <input
            id={`${id}-name`}
            value={fullName}
            maxLength={200}
            autoComplete="off"
            disabled={trial.student_id !== null}
            onChange={(e) => {
              setFullName(e.target.value)
              clear()
            }}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-grade`} label="Класс">
          <NativeSelect
            id={`${id}-grade`}
            value={grade}
            onChange={(e) => {
              setGrade(e.target.value)
              clear()
            }}
          >
            <option value="">—</option>
            {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={`${id}-phone`} label="Телефон родителя">
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold text-ink-muted">+996</span>
            <input
              id={`${id}-phone`}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="555 123 456"
              value={phone}
              onChange={(e) => {
                setPhone(maskPhoneInput(e.target.value))
                clear()
              }}
              className={inputClass}
            />
          </div>
        </Field>
        <Field id={`${id}-source`} label="Откуда узнали">
          <NativeSelect
            id={`${id}-source`}
            value={source}
            onChange={(e) => {
              setSource(e.target.value as TrialSource | '')
              clear()
            }}
          >
            <option value="">—</option>
            {TRIAL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={`${id}-note`} label="Заметка">
          <input
            id={`${id}-note`}
            value={note}
            maxLength={500}
            autoComplete="off"
            onChange={(e) => {
              setNote(e.target.value)
              clear()
            }}
            className={inputClass}
          />
        </Field>
        {kind ? (
          <Field id={`${id}-lesson`} label="Занятие">
            <NativeSelect
              id={`${id}-lesson`}
              value={lessonId}
              onChange={(e) => {
                setLessonId(e.target.value)
                clear()
              }}
            >
              <option value="">
                {lessons.isPending ? 'Загружаем занятия…' : `Оставить: ${currentLesson}`}
              </option>
              {options.map((l) => (
                <option key={l.id} value={l.id}>
                  {lessonOptionLabel(l.date, l.start, today)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold">Занятие</span>
            <p className="rounded-xl bg-muted px-3 py-2.5 text-sm font-bold text-ink-muted">
              {trialWhen(trial.lessonDate, trial.lessonStart, today)} · по решённому пробному
              занятие не меняется
            </p>
          </div>
        )}
        <Field id={`${id}-reason`} label="Причина">
          <input
            id={`${id}-reason`}
            value={reason}
            maxLength={500}
            placeholder="обязательно, например «опечатка в номере»"
            onChange={(e) => {
              setReason(e.target.value)
              clear()
            }}
            className={inputClass}
          />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending} className="min-h-12">
          Сохранить
        </SubmitButton>
      </form>
    </FormDialog>
  )
}

function ReopenTrialDialog({
  trial,
  today,
  onClose,
}: {
  trial: Trial
  today: string
  onClose: () => void
}) {
  const id = useId()
  const invalidate = useInvalidate()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const target = reopenTarget(trial, today)

  const mutation = useMutation({
    mutationFn: reopenTrial,
    onSuccess: (status) => {
      void invalidate()
      toast.success(`Пробное возвращено: ${REOPEN_LABEL[status]}`)
      onClose()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = reopenTrialForm.safeParse({ trialId: trial.id, reason })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Укажите причину')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  return (
    <FormDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title="Вернуть в воронку?"
      description={`${trial.full_name} · ${trialGroupLabel(trial.group)}`}
    >
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Вернуть в воронку"
        className="flex flex-col gap-3.5"
      >
        <p
          role="status"
          data-testid="reopen-target"
          className="rounded-xl bg-accent px-3 py-2.5 text-sm font-bold"
        >
          Пробное вернётся: {REOPEN_LABEL[target]}.
        </p>
        <ul className="list-disc pl-5 text-xs font-bold text-ink-muted">
          <li>был на пробном → «Оплатил → зачислить»</li>
          <li>не пришёл → «Позвонить»</li>
          <li>не отмечен и занятие впереди → «Записан»</li>
        </ul>
        <Field id={`${id}-reason`} label="Причина">
          <input
            id={`${id}-reason`}
            value={reason}
            maxLength={500}
            placeholder="обязательно, например «закрыли по ошибке»"
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
            Не возвращать
          </SubmitButton>
          <SubmitButton pending={mutation.isPending}>Вернуть</SubmitButton>
        </div>
      </form>
    </FormDialog>
  )
}
