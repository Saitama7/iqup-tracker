import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { BALANCES_KEY } from '@/features/payments/api'
import { STUDENTS_KEY } from '@/features/students/api'
import { firstName, formatDayMonth, groupLabel, type GroupBrief } from '@/features/students/model'
import { FormDialog, NativeSelect } from '@/features/students/parts'
import { ErrorText, Field, inputClass, labelClass, SubmitButton } from '@/features/tariffs/parts'
import { formatDateLong, formatSom, GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import { DateInput } from '@/components/ui/date-picker'
import { formatDateRu, parseDateRu } from '@/lib/time'
import { cn } from '@/lib/utils'
import { groupLessonDatesQuery } from '@/features/afterschool/api'
import {
  defaultPlan,
  formatHours,
  formatQuote,
  invoiceQuote,
  monthPrepositional,
  monthQuote,
  monthStart,
  nextMonth,
  tariffHourPrice,
  validPlan,
} from '@/features/afterschool/model'
import { PlanEditor } from '@/features/afterschool/plan-editor'
import { tariffFor } from '@/features/tariffs/current'
import { enrollForm, enrollStudent, tariffsQuery, type EnrollInput, type TariffRow } from './api'
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
 * «+ Зачислить в группу» (А6) — one `student`, the group is picked; А4 «+ Зачислить ученика» —
 * fixed `groupId`, the student is picked from `students`.
 * The subscription is created with the enrollment: tariff of the group on the start date,
 * discount 0 / 5 / 15 % (В5) — enroll_student RPC, one transaction.
 */
export function EnrollDialog({
  open,
  onOpenChange,
  student: fixedStudent,
  students = [],
  groups,
  groupId: fixedGroupId,
  today,
  startDate,
  submit,
  description,
  notice,
  onEnrolled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  student?: EnrollStudent
  /** Students to pick from when `student` is not given (not yet in the group). */
  students?: readonly EnrollStudent[]
  /** Groups the student may join (not archived, not already enrolled). */
  groups: readonly GroupBrief[]
  groupId?: string
  today: string
  /** Prefilled start date (ISO); default — today or the group's first day. */
  startDate?: string
  /** Replaces enroll_student — «Оплатил → зачислить» enrolls a trial (enroll_trial, Ж5). */
  submit?: (input: EnrollInput) => Promise<unknown>
  description?: string
  /** A warning above «Зачислить» (e.g. the trial's phone belongs to another student). */
  notice?: string | null
  onEnrolled?: () => void
}) {
  const ids = { student: useId(), group: useId(), date: useId() }
  const queryClient = useQueryClient()
  const tariffs = useQuery(tariffsQuery())
  const [studentId, setStudentId] = useState(fixedStudent?.id ?? '')
  const [groupId, setGroupId] = useState(fixedGroupId ?? '')
  const fixedGroup = groups.find((g) => g.id === fixedGroupId)
  // a group that starts later: its first day, not today (enroll_student rejects earlier dates)
  const [date, setDate] = useState(
    formatDateRu(
      startDate ?? (fixedGroup && fixedGroup.start_date > today ? fixedGroup.start_date : today),
    ),
  )
  const student = fixedStudent ?? students.find((s) => s.id === studentId) ?? null
  const [discount, setDiscount] = useState<DiscountPct>(() =>
    student ? defaultDiscount(student) : 0,
  )
  const [error, setError] = useState<string | null>(null)

  const group = groups.find((g) => g.id === groupId) ?? null
  const startIso = parseDateRu(date)
  const afterschool = group?.group_type === 'afterschool'
  const weekdays = group ? groupWeekdays(group, startIso ?? today) : []
  // the plan follows the picked group until the admin touches it
  const [plan, setPlan] = useState<number[] | null>(null)
  const hours = plan ?? defaultPlan(weekdays)
  const billMonth = monthStart(startIso ?? today)
  const lessonDates = useQuery({
    ...groupLessonDatesQuery(group?.id ?? '', billMonth, nextMonth(nextMonth(billMonth))),
    enabled: afterschool && !!startIso,
  })
  const options = discountAvailability(
    student ?? { isReturning: false, subscriptions: [], friendsBrought: 0 },
  )
  const quote =
    group && startIso && tariffs.data
      ? quoteSubscription(group.group_type, startIso, tariffs.data, discount)
      : null
  const hourBill =
    afterschool && startIso && lessonDates.data && tariffs.data
      ? afterschoolBill(lessonDates.data, hours, startIso, tariffs.data, discount)
      : null

  const mutation = useMutation({
    mutationFn: (input: EnrollInput) => (submit ?? enrollStudent)(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: STUDENTS_KEY }),
        queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] }),
      ])
      toast.success(`${student?.fullName ?? 'Ученик'} зачислен(а) в группу`)
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
      studentId: student?.id ?? '',
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
    if (afterschool && !validPlan(hours)) {
      setError('График: часы хотя бы на один день')
      return
    }
    setError(null)
    mutation.mutate(afterschool && !submit ? { ...parsed.data, plan: hours } : parsed.data)
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
      title="Зачислить в группу"
      description={
        description ??
        (fixedStudent
          ? `${fixedStudent.fullName} · абонемент создаётся сразу по тарифу группы на дату начала`
          : 'Абонемент создаётся сразу по тарифу группы на дату начала')
      }
    >
      <form
        onSubmit={onSubmit}
        noValidate
        aria-label="Зачислить в группу"
        className="flex flex-col gap-3.5"
      >
        {!fixedStudent && (
          <Field id={ids.student} label="Ученик">
            <NativeSelect
              id={ids.student}
              value={studentId}
              onChange={(e) => {
                const next = students.find((s) => s.id === e.target.value)
                setStudentId(e.target.value)
                setDiscount(next ? defaultDiscount(next) : 0)
                setError(null)
              }}
            >
              <option value="">Выберите ученика</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field id={ids.group} label="Группа">
          <NativeSelect
            id={ids.group}
            value={groupId}
            disabled={!!fixedGroupId}
            onChange={(e) => {
              setGroupId(e.target.value)
              setPlan(null)
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
          <DateInput
            id={ids.date}
            className={inputClass}
            value={date}
            min={group?.start_date}
            max={group?.end_date}
            onChange={(v) => {
              setDate(v)
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

        {afterschool && !submit && (
          <PlanEditor hours={hours} onChange={setPlan} groupWeekdays={weekdays} />
        )}
        {afterschool && submit && (
          <p className="text-xs font-bold text-ink-muted">
            График — по расписанию группы, 3 ч в день; изменить можно на карточке ученика.
          </p>
        )}

        <div
          aria-label="Абонемент"
          role="status"
          className="flex flex-col gap-1.5 rounded-[14px] bg-muted px-4 py-3 text-sm font-bold"
        >
          {afterschool && startIso ? (
            hourBill ? (
              <>
                <div className="flex justify-between gap-3">
                  <span className="text-ink-muted">Абонемент</span>
                  <span className="text-right">помесячно · с {formatDayMonth(hourBill.from)}</span>
                </div>
                <p className="text-xs text-ink-muted">{formatQuote(hourBill.month)}</p>
                <div className="flex justify-between gap-3">
                  <span className="text-ink-muted">
                    {formatHours(hourBill.invoice.hours)} ч ×{' '}
                    {formatSom(hourBill.invoice.hourPrice)} сом
                  </span>
                  <span className="text-right whitespace-nowrap">
                    {formatSom(hourBill.invoice.priceFull)} сом
                  </span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-muted">Скидка {discount} %</span>
                    <span className="whitespace-nowrap">
                      −{formatSom(hourBill.invoice.priceFull - hourBill.invoice.priceFinal)} сом
                    </span>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-3 border-t border-line-strong pt-2">
                  <span>
                    ≈ {formatHours(hourBill.invoice.hours)} ч в{' '}
                    {monthPrepositional(hourBill.monthStart)}
                  </span>
                  <span className="font-display text-lg font-bold whitespace-nowrap">
                    {formatSom(hourBill.invoice.priceFinal)} сом
                  </span>
                </div>
              </>
            ) : (
              <p className="text-ink-muted">
                {lessonDates.isPending || tariffs.isPending
                  ? 'Считаем часы…'
                  : 'По графику нет часов — выберите дни'}
              </p>
            )
          ) : quote && group && startIso ? (
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

        {notice && (
          <p
            role="note"
            className="rounded-xl bg-warn-soft px-3 py-2 text-xs font-bold text-warn-strong"
          >
            {notice}
          </p>
        )}
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

/** ISO weekdays the group meets on `date` (rules in effect, else all its rules). */
function groupWeekdays(group: GroupBrief, date: string): number[] {
  const rules = group.schedule_rules
  const live = rules.filter(
    (r) => r.valid_from <= date && (r.valid_to === null || r.valid_to >= date),
  )
  return [...new Set((live.length > 0 ? live : rules).map((r) => r.weekday))].sort((a, b) => a - b)
}

/**
 * After-school (#82): the first monthly invoice enroll_student creates — the start month from the
 * start date, or the next month when the start month has no planned hours left.
 */
function afterschoolBill(
  lessonDates: readonly string[],
  hours: readonly number[],
  start: string,
  tariffs: readonly TariffRow[],
  discount: number,
) {
  const plans = [{ valid_from: start, hours }]
  let first = monthStart(start)
  let month = monthQuote(lessonDates, plans, first, start)
  if (month.hours === 0) {
    first = nextMonth(first)
    month = monthQuote(lessonDates, plans, first, start)
  }
  if (month.hours === 0) return null
  const tariff = tariffFor('afterschool', first < start ? start : first, tariffs)
  if (!tariff) return null
  return {
    from: first < start ? start : first,
    monthStart: first,
    month,
    invoice: invoiceQuote(month.hours, 0, tariffHourPrice(tariff), discount),
  }
}
