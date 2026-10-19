import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DateInput } from '@/components/ui/date-picker'
import { AUDIT_KEY } from '@/features/audit/api'
import { tariffHourPrice } from '@/features/afterschool/model'
import { formatDateRu } from '@/lib/time'
import { cn } from '@/lib/utils'
import { planTariffs, planTariffsForm, planTariffsFromToday, settingsQuery } from './api'
import { GROUP_TYPES, lessonPrice, tariffFor, teacherShare, type GroupType } from './current'
import {
  formatDateLong,
  formatLessonPrice,
  formatSom,
  GROUP_TYPE_LABEL,
  planMinDate,
  planMinDateHint,
  type PlanMinDate,
  type SubscriptionRef,
  type Tariff,
} from './model'
import { ErrorText, Field, inputClass, SubmitButton } from './parts'

function useInvalidateSettings() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: settingsQuery().queryKey }),
      queryClient.invalidateQueries({ queryKey: [AUDIT_KEY] }),
    ])
}

// ─── Plan a new version ─────────────────────────────────────────────────────

/** «Новая версия тарифов» / «Запланировать новый тариф с даты…»: one date, all group types. */
export function PlanTariffsDialog({
  open,
  onOpenChange,
  tariffs,
  subscriptions,
  today,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tariffs: Tariff[]
  subscriptions: SubscriptionRef[]
  today: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto rounded-[20px] border-line bg-card p-6 sm:max-w-lg">
        <div className="flex flex-col gap-1.5 pr-6">
          <DialogTitle className="font-display text-lg font-bold">Новая версия тарифов</DialogTitle>
          <DialogDescription className="text-sm font-bold text-ink-muted">
            Действующие тарифы не меняются: занятия до этой даты считаются по ним.
          </DialogDescription>
        </div>
        {/* Remount on open: fresh defaults from the tariffs in effect. */}
        {open && (
          <PlanForm
            tariffs={tariffs}
            today={today}
            min={planMinDate({ tariffs, subscriptions }, today)}
            onDone={() => {
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function PlanForm({
  tariffs,
  today,
  min,
  onDone,
}: {
  tariffs: Tariff[]
  today: string
  min: PlanMinDate
  onDone: () => void
}) {
  const invalidate = useInvalidateSettings()
  const dateId = useId()
  const hintId = useId()
  const priceId = useId()
  const [validFrom, setValidFrom] = useState(() => formatDateRu(min.date))
  const hint = planMinDateHint(min)
  const [prices, setPrices] = useState(
    () =>
      Object.fromEntries(
        GROUP_TYPES.map((t) => [t, String(tariffFor(t, today, tariffs)?.package_price ?? '')]),
      ) as Record<GroupType, string>,
  )
  const currentAfterschool = tariffFor('afterschool', today, tariffs)
  const [hourPrice, setHourPrice] = useState(() =>
    currentAfterschool ? String(tariffHourPrice(currentAfterschool)) : '',
  )
  // «Применить с сегодняшнего дня» (#94): lifts К6 «с 1-го числа следующего месяца» for this version.
  const [fromToday, setFromToday] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof planTariffs>[0]) =>
      fromToday ? planTariffsFromToday(input, tariffs, today) : planTariffs(input, tariffs),
    onSuccess: async (_res, input) => {
      await invalidate()
      toast.success(
        fromToday
          ? 'Тариф применён с сегодняшнего дня'
          : `Тариф запланирован с ${formatDateLong(input.validFrom)}`,
      )
      onDone()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = planTariffsForm(fromToday ? { date: today, paid: false } : min).safeParse({
      validFrom: fromToday ? formatDateRu(today) : validFrom,
      prices,
      hourPrice,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте дату и цены')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Новая версия тарифов"
      className="flex flex-col gap-3.5"
    >
      <Field id={dateId} label="Действует с">
        <DateInput
          id={dateId}
          className={inputClass}
          value={fromToday ? formatDateRu(today) : validFrom}
          min={min.date}
          disabled={fromToday}
          aria-describedby={hint && !fromToday ? hintId : undefined}
          onChange={(v) => {
            setValidFrom(v)
          }}
        />
        {hint && !fromToday && (
          <p id={hintId} className="text-xs font-bold text-ink-muted">
            {hint}
          </p>
        )}
      </Field>
      <label className="flex min-h-11 items-center gap-2.5 text-sm font-extrabold">
        <input
          type="checkbox"
          checked={fromToday}
          onChange={(e) => {
            setFromToday(e.target.checked)
            setError(null)
          }}
          className="size-5 accent-ink"
        />
        Применить с сегодняшнего дня
      </label>
      {fromToday && (
        <p className="rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong">
          Действующие абонементы не пересчитываются — ЗП по ним не меняется (К6). Новые абонементы —
          по новой цене с сегодняшнего дня.
        </p>
      )}
      <div className="flex flex-col gap-2.5">
        {GROUP_TYPES.map((type) => {
          const base = tariffFor(type, today, tariffs)
          const price = Number(prices[type].replace(/\s/g, ''))
          const preview =
            base && Number.isInteger(price) && price > 0 ? { ...base, package_price: price } : null
          return (
            <div key={type} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3">
              <div className="flex min-w-0 flex-col">
                <label htmlFor={`${priceId}-${type}`} className="text-sm font-extrabold">
                  {GROUP_TYPE_LABEL[type]}
                </label>
                <span className="text-xs font-bold text-ink-muted">
                  {preview
                    ? `${preview.lessons_in_package} ур. · урок ${formatLessonPrice(lessonPrice(preview))} · учителю ${teacherShare(preview, 45)} / ${teacherShare(preview, 50)}`
                    : base
                      ? `сейчас ${formatSom(base.package_price)}`
                      : ''}
                </span>
              </div>
              <input
                id={`${priceId}-${type}`}
                inputMode="numeric"
                autoComplete="off"
                className={cn(inputClass, 'text-right tabular-nums')}
                value={prices[type]}
                onChange={(e) => {
                  setPrices((p) => ({ ...p, [type]: e.target.value }))
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3">
        <div className="flex min-w-0 flex-col">
          <label htmlFor={`${priceId}-hour`} className="text-sm font-extrabold">
            Продлёнка · цена часа
          </label>
          <span className="text-xs font-bold text-ink-muted">
            счёт за месяц = часы по графику × цена часа
            {currentAfterschool
              ? ` · сейчас ${formatSom(tariffHourPrice(currentAfterschool))}`
              : ''}
          </span>
        </div>
        <input
          id={`${priceId}-hour`}
          inputMode="numeric"
          autoComplete="off"
          className={cn(inputClass, 'text-right tabular-nums')}
          value={hourPrice}
          onChange={(e) => {
            setHourPrice(e.target.value)
          }}
        />
      </div>
      <p className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-ink-muted">
        Мест, уроков в пакете, длительность и заморозки переносятся из действующего тарифа.
      </p>
      {error && <ErrorText>{error}</ErrorText>}
      <SubmitButton pending={mutation.isPending}>
        {fromToday ? 'Применить' : 'Запланировать'}
      </SubmitButton>
    </form>
  )
}
