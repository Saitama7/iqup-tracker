// А9 «Праздники и выходные центра». Writes go through save_holiday / delete_holidays (#94): a past
// day too, then with a reason; the lessons of the day are cancelled / brought back by the database.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { DateInput } from '@/components/ui/date-picker'
import { AUDIT_KEY } from '@/features/audit/api'
import { TEACHER_GROUPS_KEY } from '@/features/groups/teacher-api'
import { TODAY_KEY } from '@/features/lessons/api'
import { ADMIN_LESSONS_KEY } from '@/features/schedule/api'
import { parseDateRu } from '@/lib/time'
import { cn } from '@/lib/utils'
import { holidayForm, settingsQuery } from './api'
import { deleteHolidays, holidayLessons, lessonsWord, saveHoliday } from './edit-api'
import type { HolidayItem } from './model'
import { cardClass, ErrorText, Field, inputClass, SmallDialog, SubmitButton } from './parts'

function useInvalidate() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: settingsQuery().queryKey }),
      // lessons appear / go away with a holiday
      ...[ADMIN_LESSONS_KEY, TEACHER_GROUPS_KEY, TODAY_KEY].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
      queryClient.invalidateQueries({ queryKey: [AUDIT_KEY] }),
    ])
}

const hintClass = 'rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-ink-muted'

function ReasonInput({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string
  value: string
  placeholder: string
  onChange: (v: string) => void
}) {
  return (
    <Field id={id} label="Причина">
      <input
        id={id}
        value={value}
        maxLength={500}
        autoComplete="off"
        placeholder={placeholder}
        className={inputClass}
        onChange={(e) => {
          onChange(e.target.value)
        }}
      />
    </Field>
  )
}

export function HolidaysSection({ items, today }: { items: HolidayItem[]; today: string }) {
  const [adding, setAdding] = useState(false)
  // Kept after closing so the dialog does not go blank during its exit animation.
  const [deleting, setDeleting] = useState<HolidayItem | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <section aria-label="Праздники и выходные центра" className={cn(cardClass, 'flex flex-col')}>
      <div className="flex flex-nowrap items-center justify-between gap-2.5 border-b border-line px-[18px] py-3.5">
        <div>
          <h2 className="text-[15px] font-extrabold">Праздники и выходные центра</h2>
          <p className="text-xs font-bold text-ink-muted">
            в эти дни занятия не создаются; уже созданные — отменяются
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
      {items.length === 0 ? (
        <p className="px-[18px] py-4 text-sm font-bold text-ink-muted">Праздников пока нет</p>
      ) : (
        <ul aria-label="Праздники">
          {items.map((h) => (
            <li
              key={h.days[0]}
              className={cn(
                'flex min-h-12 items-center justify-between gap-3 border-b border-line py-1.5 pr-2 pl-[18px] text-sm last:border-0',
                h.past && 'text-ink-muted',
              )}
            >
              <span className="font-extrabold whitespace-nowrap">{h.label}</span>
              <span className="flex min-w-0 items-center gap-1">
                <span className="line-clamp-2 text-right font-bold text-ink-muted">{h.name}</span>
                <button
                  type="button"
                  aria-label={`Удалить: ${h.label}, ${h.name}`}
                  onClick={() => {
                    setDeleting(h)
                    setDeleteOpen(true)
                  }}
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-burned-strong"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <AddHolidayDialog open={adding} onOpenChange={setAdding} today={today} />
      <DeleteHolidayDialog
        item={deleting}
        today={today}
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false)
        }}
      />
    </section>
  )
}

function AddHolidayDialog({
  open,
  onOpenChange,
  today,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  today: string
}) {
  const invalidate = useInvalidate()
  const dayId = useId()
  const nameId = useId()
  const reasonId = useId()
  const [day, setDay] = useState('')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const iso = parseDateRu(day)
  const past = iso !== null && iso < today

  const preview = useQuery({
    queryKey: ['holiday-lessons', iso],
    queryFn: () => holidayLessons(iso ?? ''),
    enabled: open && iso !== null,
    staleTime: 0,
  })

  const mutation = useMutation({
    mutationFn: saveHoliday,
    onSuccess: async (cancelled) => {
      await invalidate()
      toast.success(`Праздник добавлен · отменено ${lessonsWord(cancelled)}`)
      setDay('')
      setName('')
      setReason('')
      onOpenChange(false)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = holidayForm(today).safeParse({ day, name, reason })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  return (
    <SmallDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
      title="Новый праздник"
      description="В этот день занятия не создаются."
    >
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Новый праздник"
        className="flex flex-col gap-3.5"
      >
        <Field id={dayId} label="Дата">
          <DateInput
            id={dayId}
            className={inputClass}
            value={day}
            onChange={(v) => {
              setDay(v)
              setError(null)
            }}
          />
        </Field>
        <Field id={nameId} label="Название">
          <input
            id={nameId}
            placeholder="Нооруз"
            autoComplete="off"
            className={inputClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
            }}
          />
        </Field>
        {past && (
          <ReasonInput
            id={reasonId}
            value={reason}
            placeholder="обязательно, например «забыли внести»"
            onChange={(v) => {
              setReason(v)
              setError(null)
            }}
          />
        )}
        <p className={hintClass}>
          Запланированные занятия этого дня будут отменены (праздник), проведённые останутся
        </p>
        {preview.data && (
          <p role="status" className="text-sm font-bold">
            Будут отменены {lessonsWord(preview.data.planned)}
            {preview.data.held > 0 && ` · Проведённые (${preview.data.held}) останутся`}
          </p>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>Добавить</SubmitButton>
      </form>
    </SmallDialog>
  )
}

function DeleteHolidayDialog({
  item,
  today,
  open,
  onClose,
}: {
  item: HolidayItem | null
  today: string
  open: boolean
  onClose: () => void
}) {
  const invalidate = useInvalidate()
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const needReason = item?.days.some((d) => d < today) ?? false

  const preview = useQuery({
    queryKey: ['holiday-lessons', 'restore', item?.days],
    queryFn: async () => {
      const all = await Promise.all((item?.days ?? []).map(holidayLessons))
      return all.reduce((n, r) => n + r.restored, 0)
    },
    enabled: open && item !== null,
    staleTime: 0,
  })

  const mutation = useMutation({
    mutationFn: deleteHolidays,
    onSuccess: async (planned) => {
      await invalidate()
      toast.success(`Праздник удалён · в расписании снова ${lessonsWord(planned)}`)
      setReason('')
      onClose()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function submit() {
    if (!item) return
    const trimmed = reason.trim()
    if (needReason && trimmed === '') {
      setError('Укажите причину')
      return
    }
    setError(null)
    mutation.mutate({ days: item.days, reason: trimmed === '' ? null : trimmed })
  }

  return (
    <SmallDialog
      open={open && item !== null}
      onOpenChange={(o) => {
        if (!o) {
          setError(null)
          onClose()
        }
      }}
      title="Удалить праздник?"
      description={item ? `${item.label} — ${item.name}` : ''}
    >
      {preview.data !== undefined && (
        <p role="status" className="text-sm font-bold">
          Вернутся в расписание {lessonsWord(preview.data)}
        </p>
      )}
      {needReason && (
        <ReasonInput
          id={reasonId}
          value={reason}
          placeholder="обязательно, например «внесли по ошибке»"
          onChange={(v) => {
            setReason(v)
            setError(null)
          }}
        />
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex gap-2">
        <SubmitButton variant="outline" className="flex-1" onClick={onClose}>
          Отмена
        </SubmitButton>
        <SubmitButton
          variant="danger"
          className="flex-1"
          pending={mutation.isPending}
          onClick={submit}
        >
          Удалить
        </SubmitButton>
      </div>
    </SmallDialog>
  )
}
