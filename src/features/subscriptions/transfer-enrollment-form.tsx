import { useMutation } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { DateInput } from '@/components/ui/date-picker'
import { groupLabel, type GroupBrief } from '@/features/students/model'
import { NativeSelect } from '@/features/students/parts'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { formatDateRu, parseDateRu } from '@/lib/time'
import { transferEnrollment } from './undo-api'

/** Active groups of the same type, other than the current one — the transfer keeps the tariff. */
export function transferTargets(groups: readonly GroupBrief[], from: GroupBrief | null) {
  if (!from) return []
  return groups
    .filter((g) => g.id !== from.id && g.group_type === from.group_type && g.status !== 'archived')
    .sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), 'ru'))
}

/** «Перевести в другую группу»: target group and start (default — the later of the two starts). */
export function TransferEnrollmentForm({
  enrollmentId,
  startDate,
  targets,
  onDone,
  onBack,
}: {
  enrollmentId: string
  startDate: string
  targets: readonly GroupBrief[]
  onDone: (target: GroupBrief) => void | Promise<void>
  onBack: () => void
}) {
  const ids = { group: useId(), date: useId(), hint: useId() }
  const [groupId, setGroupId] = useState('')
  const [typed, setTyped] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const target = targets.find((g) => g.id === groupId) ?? null
  const defaultIso = target && target.start_date > startDate ? target.start_date : startDate
  const date = typed ?? formatDateRu(defaultIso)
  const iso = parseDateRu(date)

  const mutation = useMutation({
    mutationFn: (input: { group: GroupBrief; date: string }) =>
      transferEnrollment(enrollmentId, input.group.id, input.date),
    onSuccess: async (_, input) => {
      await onDone(input.group)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!target) {
      setError('Выберите группу')
      return
    }
    if (!iso) {
      setError('Дата в формате ДД.ММ.ГГГГ')
      return
    }
    setError(null)
    mutation.mutate({ group: target, date: iso })
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Перевести в другую группу"
      className="flex flex-col gap-3.5"
    >
      {targets.length === 0 ? (
        <p
          role="status"
          className="rounded-xl bg-accent px-3 py-2.5 text-xs font-bold text-warn-strong"
        >
          Нет другой действующей группы того же типа. Для группы другого типа сначала оформите
          возврат.
        </p>
      ) : (
        <>
          <Field id={ids.group} label="Новая группа">
            <NativeSelect
              id={ids.group}
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value)
                setTyped(null)
                setError(null)
              }}
            >
              <option value="">Выберите группу</option>
              {targets.map((g) => (
                <option key={g.id} value={g.id}>
                  {groupLabel(g)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id={ids.date} label="Зачислен с">
            <DateInput
              id={ids.date}
              className={inputClass}
              value={date}
              min={target?.start_date}
              max={target?.end_date}
              aria-describedby={ids.hint}
              onChange={(v) => {
                setTyped(v)
                setError(null)
              }}
            />
          </Field>
          <p id={ids.hint} className="-mt-2 text-xs font-bold text-ink-muted">
            Абонемент и оплаты переедут вместе с зачислением. Не раньше старта новой группы.
          </p>
        </>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2.5">
        <SubmitButton variant="outline" onClick={onBack}>
          Назад
        </SubmitButton>
        {targets.length > 0 && <SubmitButton pending={mutation.isPending}>Перевести</SubmitButton>}
      </div>
    </form>
  )
}
