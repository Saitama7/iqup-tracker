import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { STUDENTS_KEY } from '@/features/students/api'
import { firstName, formatDayMonth, groupLabel, type GroupBrief } from '@/features/students/model'
import { FormDialog, NativeSelect } from '@/features/students/parts'
import { ErrorText, Field, inputClass, labelClass, SubmitButton } from '@/features/tariffs/parts'
import { formatDateLong, formatSom, GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import { formatDateRu, parseDateRu } from '@/lib/time'
import { cn } from '@/lib/utils'
import { enrollForm, enrollStudent, tariffsQuery } from './api'
import {
  defaultDiscount,
  discountAvailability,
  discountByPct,
  quoteSubscription,
  type DiscountHistory,
  type DiscountPct,
} from './model'

export interface EnrollStudent extends DiscountHistory {
  id: string
  fullName: string
}

/**
 * «+ Зачислить в группу» (А6; А4 «+ Зачислить ученика» reuses it with `groupId`).
 * The subscription is created with the enrollment: tariff of the group on the start date,
 * discount 0 / 5 / 15 % (В5) — enroll_student RPC, one transaction.
 */
export function EnrollDialog({
  open,
  onOpenChange,
  student,
  groups,
  groupId: fixedGroupId,
  today,
  onEnrolled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  student: EnrollStudent
  /** Groups the student may join (not archived, not already enrolled). */
  groups: readonly GroupBrief[]
  groupId?: string
  today: string
  onEnrolled?: () => void
}) {
  const ids = { group: useId(), date: useId() }
  const queryClient = useQueryClient()
  const tariffs = useQuery(tariffsQuery())
  const [groupId, setGroupId] = useState(fixedGroupId ?? '')
  const [date, setDate] = useState(formatDateRu(today))
  const [discount, setDiscount] = useState<DiscountPct>(() => defaultDiscount(student))
  const [error, setError] = useState<string | null>(null)

  const group = groups.find((g) => g.id === groupId) ?? null
  const startIso = parseDateRu(date)
  const options = discountAvailability(student)
  const quote =
    group && startIso && tariffs.data
      ? quoteSubscription(group.group_type, startIso, tariffs.data, discount)
      : null

  const mutation = useMutation({
    mutationFn: enrollStudent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STUDENTS_KEY })
      toast.success(`${student.fullName} зачислен(а) в группу`)
      onOpenChange(false)
      onEnrolled?.()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = enrollForm(group?.start_date ?? null).safeParse({
      studentId: student.id,
      groupId,
      startDate: date,
      discount,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    if (!quote) {
      setError('На эту дату нет тарифа для группы')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
      title="Зачислить в группу"
      description={`${student.fullName} · абонемент создаётся сразу по тарифу группы на дату начала`}
    >
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Зачислить в группу"
        className="flex flex-col gap-3.5"
      >
        <Field id={ids.group} label="Группа">
          <NativeSelect
            id={ids.group}
            value={groupId}
            disabled={!!fixedGroupId}
            onChange={(e) => {
              setGroupId(e.target.value)
              setError(null)
            }}
          >
            <option value="">Выберите группу</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {groupLabel(g)}
                {g.teacher ? ` · ${firstName(g.teacher.full_name)}` : ''}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={ids.date} label="Дата начала">
          <input
            id={ids.date}
            inputMode="numeric"
            placeholder="ДД.ММ.ГГГГ"
            autoComplete="off"
            className={inputClass}
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
            }}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className={labelClass} id={`${ids.group}-discount`}>
            Скидка
          </span>
          <div
            role="group"
            aria-labelledby={`${ids.group}-discount`}
            className="grid grid-cols-3 gap-1.5"
          >
            {options.map((o) => {
              const d = discountByPct(o.pct)
              const on = discount === o.pct
              return (
                <button
                  key={o.pct}
                  type="button"
                  aria-pressed={on}
                  disabled={!o.available}
                  onClick={() => {
                    setDiscount(o.pct)
                  }}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center rounded-xl border-[1.5px] px-1.5 py-1.5 text-center leading-tight disabled:opacity-45',
                    on ? 'border-ink bg-ink text-brand' : 'border-line-strong bg-card text-ink',
                  )}
                >
                  <span className="text-sm font-extrabold">
                    {o.pct === 0 ? '0 %' : `${o.pct} %`}
                  </span>
                  <span
                    className={cn('text-[11px] font-bold', on ? 'text-paper/75' : 'text-ink-muted')}
                  >
                    {o.available || !o.hint ? reasonShort(d.reason) : o.hint}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div
          aria-label="Абонемент"
          role="status"
          className="flex flex-col gap-1.5 rounded-[14px] bg-muted px-4 py-3 text-sm font-bold"
        >
          {quote && group && startIso ? (
            <>
              <div className="flex justify-between gap-3">
                <span className="text-ink-muted">Абонемент</span>
                <span className="text-right">
                  {quote.lessonsTotal} уроков · с {formatDayMonth(startIso)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-ink-muted">Тариф · {GROUP_TYPE_LABEL[group.group_type]}</span>
                <span className="text-right whitespace-nowrap">
                  {formatSom(quote.priceFull)} сом
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                действует с {formatDateLong(quote.tariff.valid_from)}
              </p>
              {discount > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-ink-muted">Скидка {discount} %</span>
                  <span className="whitespace-nowrap">
                    −{formatSom(quote.priceFull - quote.priceFinal)} сом
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 border-t border-line-strong pt-2">
                <span>Цена абонемента</span>
                <span className="font-display text-lg font-bold whitespace-nowrap">
                  {formatSom(quote.priceFinal)} сом
                </span>
              </div>
            </>
          ) : (
            <p className="text-ink-muted">
              {!group
                ? 'Выберите группу — цена по тарифу группы на дату начала'
                : !startIso
                  ? 'Укажите дату начала'
                  : tariffs.isPending
                    ? 'Загружаем тарифы…'
                    : 'На эту дату нет тарифа для группы'}
            </p>
          )}
        </div>
        <p className="text-xs font-bold text-ink-muted">
          Скидка — только на цену для ученика; ЗП учителя считается от полной цены.
        </p>

        {error && <ErrorText>{error}</ErrorText>}
        <SubmitButton pending={mutation.isPending}>Зачислить</SubmitButton>
      </form>
    </FormDialog>
  )
}

function reasonShort(reason: 'none' | 'returning' | 'referral'): string {
  if (reason === 'returning') return 'бывший ученик'
  if (reason === 'referral') return 'привёл друга'
  return 'без скидки'
}
