// А7 «Оплаты» view model: pure functions of (rows, today) — no fetching, no clock.
// Journal of a month (Г2: cash / Mbank apart), totals by group and teacher (Г4), the record panel.
import { formatHours, monthAccusative } from '@/features/afterschool/model'
import { pluralRu } from '@/features/lessons/select'
import { formatLessonPrice, formatSom } from '@/features/tariffs/model'
import {
  groupLabel,
  type GroupBrief,
  type StudentRow,
  type SubscriptionRow,
} from '@/features/students/model'
import { availableLessons, debtOverLimit, paidLessons, payState, type PayState } from './balance'
import type { PaymentMethod, PaymentRow, StudentBalance } from './api'

export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'наличные', mbank: 'Mbank' }
/** Buttons «Наличные / Mbank» (А7 panel). */
export const METHOD_BUTTON: Record<PaymentMethod, string> = { cash: 'Наличные', mbank: 'Mbank' }

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]
const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]
const MONTHS_PREP = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
]

const LESSONS = ['урок', 'урока', 'уроков'] as const

/** «3 урока» — or «2,5 ч» for an after-school month in hours (#82). */
const unitCount = (b: Pick<StudentBalance, 'unit'>, n: number) =>
  b.unit === 'hour' ? `${formatHours(n)} ч` : `${n} ${pluralRu(n, LESSONS)}`
/** «4 из 12» / «4 из 21 ч». */
const unitOf = (b: Pick<StudentBalance, 'unit'>, n: number, total: number) =>
  b.unit === 'hour' ? `${formatHours(n)} из ${formatHours(total)} ч` : `${n} из ${total}`
const PAYMENTS = ['платёж', 'платежа', 'платежей'] as const

export const som = (n: number) => `${formatSom(n)} сом`
/** «− 1 333» — a refund in the journal and on the cards. */
export const signedSom = (n: number) => (n < 0 ? `− ${formatSom(-n)}` : formatSom(n))

// ─── Months ─────────────────────────────────────────────────────────────────

/** '2026-10-13' → '2026-10'. */
export const monthOf = (today: string) => today.slice(0, 7)

export function shiftMonth(month: string, by: number): string {
  const [y = 0, m = 1] = month.split('-').map(Number)
  const i = y * 12 + (m - 1) + by
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}

/** «Октябрь»; another year — «Октябрь 2025». */
export function monthLabel(month: string, today: string): string {
  const [y = '', m = 1] = month.split('-')
  const name = MONTHS[Number(m) - 1] ?? ''
  return y === today.slice(0, 4) ? name : `${name} ${y}`
}

/** «за октябрь» → the card «Всего за октябрь». */
export const monthPrep = (month: string) => MONTHS_PREP[Number(month.slice(5, 7)) - 1] ?? ''

/** [from, to) of a calendar month in Bishkek (UTC+6, invariant 8) — for paid_at. */
export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01T00:00:00+06:00`, to: `${shiftMonth(month, 1)}-01T00:00:00+06:00` }
}

/** The 12 months up to the current one, newest first — «Период…». */
export const recentMonths = (today: string, n = 12) =>
  Array.from({ length: n }, (_, i) => shiftMonth(monthOf(today), -i))

/** paid_at → «8 окт 13:40» (Asia/Bishkek). */
export function formatPaidAt(paidAt: string): string {
  const local = new Date(Date.parse(paidAt) + 6 * 60 * 60 * 1000)
  const time = local.toISOString().slice(11, 16)
  return `${local.getUTCDate()} ${MONTHS_SHORT[local.getUTCMonth()]} ${time}`
}

// ─── Journal ────────────────────────────────────────────────────────────────

export interface Lookups {
  students: ReadonlyMap<string, { full_name: string }>
  groups: ReadonlyMap<string, { label: string; teacher: string | null }>
}

export interface JournalRow {
  id: string
  studentId: string
  groupId: string
  paidAt: string
  date: string
  student: string
  /** «Математика · 8 класс А · скидка 15 %». */
  caption: string
  /** «12 ур · 3 200»; a refund — «остаток 5 ур». */
  package: string
  method: string
  amount: number
  /** «Алишка · частично», «Каныкей · возврат». */
  author: string
  refund: boolean
  /** «перенос в / из <группа>» (#81) — money moved between subscriptions, not paid. */
  transfer: boolean
}

/** Lessons a refund paid back: amount / (price_final / lessons_total). */
export const refundLessons = (amount: number, lessonsTotal: number, priceFinal: number) =>
  priceFinal > 0 ? Math.round((Math.abs(amount) * lessonsTotal) / priceFinal) : 0

export function journalRow(p: PaymentRow, lookups: Lookups): JournalRow {
  const s = p.subscription
  const group = lookups.groups.get(s.enrollment.group_id)
  const refund = p.kind === 'refund'
  const transfer = p.kind === 'transfer'
  const tags = [
    p.createdByName ?? 'система',
    transfer ? p.reason : refund ? 'возврат' : p.amount < s.price_final ? 'частично' : null,
  ].filter(Boolean)
  return {
    id: p.id,
    studentId: s.enrollment.student_id,
    groupId: s.enrollment.group_id,
    paidAt: p.paid_at,
    date: formatPaidAt(p.paid_at),
    student: lookups.students.get(s.enrollment.student_id)?.full_name ?? 'Ученик',
    caption: [
      group?.label ?? 'Группа',
      s.discount_percent > 0 ? `скидка ${s.discount_percent} %` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    package: s.hours_total
      ? refund
        ? `остаток ${formatHours(refundLessons(p.amount, s.hours_total * 2, s.price_final) / 2)} ч`
        : `${formatHours(s.hours_total)} ч${s.period_month ? ` за ${monthAccusative(s.period_month)}` : ''} · ${formatSom(s.price_final)}`
      : refund
        ? `остаток ${refundLessons(p.amount, s.lessons_total, s.price_final)} ур`
        : `${s.lessons_total} ур · ${formatSom(s.price_final)}`,
    method: p.method ? METHOD_LABEL[p.method] : 'перенос',
    amount: p.amount,
    author: tags.join(' · '),
    refund,
    transfer,
  }
}

export interface JournalFilter {
  method?: PaymentMethod
  group?: string
}

export function filterPayments(rows: readonly PaymentRow[], f: JournalFilter): PaymentRow[] {
  return rows.filter(
    (p) =>
      (!f.method || p.method === f.method) &&
      (!f.group || p.subscription.enrollment.group_id === f.group),
  )
}

// ─── Totals (Г2, Г4) ────────────────────────────────────────────────────────

export interface Totals {
  /** Payments only — cash + Mbank (А7 «Всего за октябрь»). */
  total: number
  cash: number
  mbank: number
  /** Σ refunds, negative. */
  refunds: number
  /** Money kept: total + refunds. */
  net: number
  payments: number
  /** Distinct subscriptions paid for. */
  subscriptions: number
}

export function totals(rows: readonly PaymentRow[]): Totals {
  const t: Totals = {
    total: 0,
    cash: 0,
    mbank: 0,
    refunds: 0,
    net: 0,
    payments: 0,
    subscriptions: 0,
  }
  const subs = new Set<string>()
  for (const p of rows) {
    // a transfer pair (#81) moves money already counted when it was paid
    if (p.kind === 'transfer' || !p.method) continue
    if (p.kind === 'refund') {
      t.refunds += p.amount
      continue
    }
    t.total += p.amount
    t[p.method] += p.amount
    t.payments += 1
    subs.add(p.subscription.id)
  }
  t.net = t.total + t.refunds
  t.subscriptions = subs.size
  return t
}

/** «Октябрь · 148 200 сом · 47 платежей». */
export function journalCaption(
  month: string,
  today: string,
  t: Pick<Totals, 'total' | 'payments'>,
) {
  return `${monthLabel(month, today)} · ${som(t.total)} · ${t.payments} ${pluralRu(t.payments, PAYMENTS)}`
}

export interface TotalsRow extends Totals {
  key: string
  label: string
  /** Teacher of the group; groups count on the teachers tab. */
  sub: string
}

/** By group (MoneyReport columns): biggest first. */
export function totalsByGroup(rows: readonly PaymentRow[], lookups: Lookups): TotalsRow[] {
  const by = new Map<string, PaymentRow[]>()
  for (const p of rows) {
    const k = p.subscription.enrollment.group_id
    by.set(k, [...(by.get(k) ?? []), p])
  }
  return [...by.entries()]
    .map(([key, list]) => {
      const g = lookups.groups.get(key)
      return { key, label: g?.label ?? 'Группа', sub: g?.teacher ?? '—', ...totals(list) }
    })
    .sort((a, b) => b.net - a.net || a.label.localeCompare(b.label, 'ru'))
}

const GROUPS = ['группа', 'группы', 'групп'] as const

/** By the group's teacher (Г4). */
export function totalsByTeacher(rows: readonly PaymentRow[], lookups: Lookups): TotalsRow[] {
  const by = new Map<string, { groups: Set<string>; list: PaymentRow[] }>()
  for (const p of rows) {
    const gid = p.subscription.enrollment.group_id
    const k = lookups.groups.get(gid)?.teacher ?? '—'
    const e = by.get(k) ?? { groups: new Set<string>(), list: [] }
    e.groups.add(gid)
    e.list.push(p)
    by.set(k, e)
  }
  return [...by.entries()]
    .map(([key, e]) => ({
      key,
      label: key,
      sub: `${e.groups.size} ${pluralRu(e.groups.size, GROUPS)}`,
      ...totals(e.list),
    }))
    .sort((a, b) => b.net - a.net || a.label.localeCompare(b.label, 'ru'))
}

// ─── Record panel ───────────────────────────────────────────────────────────

/** Short state of the current subscription for the panel and А5: «осталось 1 из 12». */
export function balanceLine(b: StudentBalance): { text: string; state: PayState; note: string } {
  const state = payState(b)
  const left =
    b.lessonsLeft >= 0
      ? `осталось ${unitOf(b, b.lessonsLeft, b.lessonsTotal)}`
      : `сверх абонемента ${unitCount(b, -b.lessonsLeft)}`
  const note =
    state === 'debt'
      ? `долг ${unitCount(b, b.debtLessons)} · ${som(b.debtSom)}`
      : state === 'soon'
        ? 'пора оплачивать'
        : state === 'partial'
          ? `оплачено ${unitOf(b, b.paidLessons, b.lessonsTotal)}`
          : 'оплачен'
  const head =
    b.unit === 'hour' && b.periodMonth ? `Счёт за ${monthAccusative(b.periodMonth)}` : 'Текущий'
  return { text: `${head}: ${left}`, state, note }
}

/** Lessons «в долг» of the current subscription the next one takes over (И37). */
export const carryToNext = (
  b: Pick<StudentBalance, 'lessonsUsed' | 'lessonsTotal' | 'paidLessons'>,
) => Math.max(0, b.lessonsUsed - Math.max(b.lessonsTotal, b.paidLessons))

/** Amount presets: the rest / the debt on the current one; half / full on a new one. */
export function amountPresets(
  target: 'current' | 'new',
  price: number,
  current: StudentBalance | null,
): { label: string; amount: number }[] {
  if (target === 'new') {
    const half = Math.round(price / 2)
    return [
      { label: `${formatSom(half)} · половина`, amount: half },
      { label: `${formatSom(price)} · полностью`, amount: price },
    ]
  }
  if (!current) return []
  const presets: { label: string; amount: number }[] = []
  const rest = current.priceFinal - current.paidSom
  if (current.debtSom > 0)
    presets.push({ label: `${formatSom(current.debtSom)} · закрыть долг`, amount: current.debtSom })
  if (rest > 0 && rest !== current.debtSom)
    presets.push({ label: `${formatSom(rest)} · остаток`, amount: rest })
  return presets
}

/** The green line above «Записать»: what the payment opens (В7.1, И37). */
export function paymentHint(
  target: 'current' | 'new',
  amount: number | null,
  terms: { lessonsTotal: number; priceFinal: number; priceFull: number },
  current: StudentBalance | null,
): string {
  if (target === 'new') {
    const carried = current ? carryToNext(current) : 0
    const opened = amount
      ? Math.min(terms.lessonsTotal, paidLessons(amount, terms.lessonsTotal, terms.priceFinal))
      : 0
    const parts = [`Откроется ${opened} ${pluralRu(opened, LESSONS)}`]
    if (carried > 0) {
      parts.push(
        `${carried} ${pluralRu(carried, LESSONS)} уйдут на погашение долга, доступно ${Math.max(0, opened - carried)}`,
      )
    }
    parts.push(`полная цена ${formatSom(terms.priceFull)} · ЗП учителя считается от полной цены`)
    return parts.join(' · ')
  }
  if (!current) return ''
  const paid = paidLessons(
    current.paidSom + (amount ?? 0),
    current.lessonsTotal,
    current.priceFinal,
    current.unit,
  )
  const available = availableLessons({ paidLessons: paid, lessonsUsed: current.lessonsUsed })
  const debt = Math.max(0, -available)
  if (current.unit === 'hour') {
    const of = unitOf(current, Math.min(paid, current.lessonsTotal), current.lessonsTotal)
    return debt > 0
      ? `После записи: оплачено ${of}, долг ${unitCount(current, debt)}`
      : `После записи: оплачено ${of}, доступно ${unitCount(current, available)}`
  }
  return debt > 0
    ? `После записи: оплачено ${Math.min(paid, current.lessonsTotal)} из ${current.lessonsTotal}, долг ${debt} ${pluralRu(debt, LESSONS)}`
    : `После записи: оплачено ${Math.min(paid, current.lessonsTotal)} из ${current.lessonsTotal}, доступно ${available} ${pluralRu(available, LESSONS)}`
}

/** «остаток 5 ур × 266,67» under the refund amount (В8). */
export function refundHint(b: StudentBalance): string {
  const lessons = Math.max(0, Math.min(b.paidLessons, b.lessonsTotal) - b.lessonsUsed)
  // the paid price of a unit: of a billed hour, not of the capacity with its credit (#82)
  return `Остаток ${unitCount(b, lessons)} × ${formatLessonPrice(b.priceFinal / b.pricedTotal, true)} сом = ${som(b.refundSuggested)}`
}

/** Digits of the amount field: «3 200» → 3200; empty / junk → null. */
export function parseAmount(v: string): number | null {
  const d = v.replace(/\s/g, '')
  return /^\d+$/.test(d) ? Number(d) : null
}

// ─── Duplicate guard of «Записать оплату» (#93) ────────────────────────────

/** paid_at → its Bishkek date '2026-10-05' (invariant 8). */
export const paidOnDate = (paidAt: string) =>
  new Date(Date.parse(paidAt) + 6 * 60 * 60 * 1000).toISOString().slice(0, 10)

/** '2026-10-05' → «05.10». */
export const dayMonth = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

const dayIndex = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000

/** A payment like the last one within this many days is likely a repeat (И75). */
export const REPEAT_DAYS = 14

/** What a subscription is: «абонемент с 01.10» / «счёт за октябрь» (after-school month, #82). */
export function subscriptionCaption(s: {
  started_at?: string | null
  period_month?: string | null
  /** «абонемент 8 уроков с 20.10» — the toast of a new package (И89). */
  lessons_total?: number | null
}): string {
  if (s.period_month) return `счёт за ${monthAccusative(s.period_month)}`
  const size = s.lessons_total ? ` ${s.lessons_total} ${pluralRu(s.lessons_total, LESSONS)}` : ''
  return s.started_at ? `абонемент${size} с ${dayMonth(s.started_at)}` : `абонемент${size}`
}

/** The student's subscriptions by id — payment rows do not carry started_at. */
export function subscriptionsOf(
  student: Pick<StudentRow, 'enrollments'>,
): Map<string, SubscriptionRow> {
  return new Map(student.enrollments.flatMap((e) => e.subscriptions.map((s) => [s.id, s])))
}

/** Payments of one student (optionally in one group), newest first. */
export function paymentsOf(
  payments: readonly PaymentRow[],
  studentId: string,
  groupId?: string,
): PaymentRow[] {
  return payments
    .filter(
      (p) =>
        p.subscription.enrollment.student_id === studentId &&
        (!groupId || p.subscription.enrollment.group_id === groupId),
    )
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
}

export interface DuplicateTarget {
  kind: 'current' | 'new'
  groupId: string
  /** The subscription paid on («current»), or the enrollment's current one («new»). */
  balance: StudentBalance | null
}

/**
 * «Похоже на повтор» (#93, И75): reasons to think the payment about to be recorded was already
 * made — a payment in the group in the last 14 days, a new package while the current one is paid
 * with ≥ 3 lessons left, an after-school invoice already paid. Empty — no warning. Never a block:
 * a second payment in a month happens (a top-up, a sibling with the same phone, И47).
 */
export function duplicateWarning(
  student: Pick<StudentRow, 'id' | 'enrollments'>,
  target: DuplicateTarget,
  payments: readonly PaymentRow[],
  today: string,
): string[] {
  const reasons: string[] = []
  const subs = subscriptionsOf(student)
  const b = target.balance
  const paid = paymentsOf(payments, student.id, target.groupId).filter((p) => p.kind === 'payment')

  const recent = paid.find((p) => {
    const days = dayIndex(today) - dayIndex(paidOnDate(p.paid_at))
    return days >= 0 && days < REPEAT_DAYS
  })
  if (recent) {
    const s = subs.get(recent.subscription.id)
    const what = subscriptionCaption({
      started_at: s?.started_at,
      period_month: s?.period_month ?? recent.subscription.period_month,
    })
    const left =
      b && b.subscriptionId === recent.subscription.id && !b.refunded
        ? `, осталось ${unitOf(b, Math.max(0, b.lessonsLeft), b.lessonsTotal)}`
        : ''
    reasons.push(
      `Оплата ${som(recent.amount)} уже внесена ${dayMonth(paidOnDate(recent.paid_at))} (${what}${left})`,
    )
  }

  if (
    target.kind === 'new' &&
    b &&
    !b.refunded &&
    b.unit === 'lesson' &&
    b.debtLessons === 0 &&
    b.paidLessons >= b.lessonsTotal &&
    b.lessonsLeft >= 3
  ) {
    reasons.push(
      `Текущий абонемент оплачен, осталось ${b.lessonsLeft} ${pluralRu(b.lessonsLeft, LESSONS)} — новый ещё не нужен`,
    )
  }

  if (
    target.kind === 'current' &&
    b &&
    b.unit === 'hour' &&
    b.periodMonth &&
    b.paidSom >= b.priceFinal
  ) {
    const last = paid.find((p) => p.subscription.id === b.subscriptionId)
    reasons.push(
      `Счёт за ${monthAccusative(b.periodMonth)} уже оплачен${last ? ` ${dayMonth(paidOnDate(last.paid_at))}` : ''}`,
    )
  }
  return reasons
}

/** PayState of the picker, plus «Нет оплат» — nothing paid in the group yet. */
export type PickerPayState = PayState | 'none'

export interface GroupPayStatus {
  groupId: string
  group: string
  state: PickerPayState
  /** «Оплачено 05.10 · 3 200» / «Частично» / «Пора оплачивать» / «Долг 2 ур. · 533 сом» / «Нет оплат». */
  label: string
  /** «абонемент с 01.10 · осталось 9 из 12» / «оплачено 6 из 12 · внесено 1 600 из 3 200». */
  detail: string | null
  tone: 'ok' | 'warn' | 'burned' | 'muted'
}

/**
 * Payment status of a student per active enrollment — rows of the student picker (#93). The current
 * subscription's state as payState (А5), the last payment's date and amount.
 */
export function groupPayStatuses(
  student: StudentRow,
  groups: ReadonlyMap<string, GroupBrief>,
  balances: readonly StudentBalance[],
  payments: readonly PaymentRow[],
): GroupPayStatus[] {
  const subs = subscriptionsOf(student)
  const seen = new Set<string>()
  return student.enrollments
    .filter((e) => e.status === 'active' && !seen.has(e.group_id) && seen.add(e.group_id))
    .map((e): GroupPayStatus => {
      const g = groups.get(e.group_id)
      const group = g ? groupLabel(g) : 'Группа'
      const b =
        balances.find(
          (x) => x.studentId === student.id && x.groupId === e.group_id && x.isCurrent,
        ) ?? null
      const money = paymentsOf(payments, student.id, e.group_id).filter((p) => p.kind !== 'refund')
      const last = money.find((p) => p.kind === 'payment') ?? null
      const base = { groupId: e.group_id, group }
      if (!b || (money.length === 0 && b.debtLessons === 0)) {
        return { ...base, state: 'none', label: 'Нет оплат', detail: null, tone: 'muted' }
      }
      const state = payState(b)
      const lastText = last
        ? `${dayMonth(paidOnDate(last.paid_at))} · ${formatSom(last.amount)}`
        : null
      if (state === 'paid') {
        const s = subs.get(b.subscriptionId)
        return {
          ...base,
          state,
          label: lastText ? `Оплачено ${lastText}` : 'Оплачено',
          detail:
            b.unit === 'hour' && b.periodMonth
              ? `счёт за ${monthAccusative(b.periodMonth)} оплачен`
              : `${subscriptionCaption({ started_at: s?.started_at })} · осталось ${unitOf(b, Math.max(0, b.lessonsLeft), b.lessonsTotal)}`,
          tone: 'ok',
        }
      }
      if (state === 'partial') {
        return {
          ...base,
          state,
          label: 'Частично',
          detail: `оплачено ${unitOf(b, Math.max(0, b.paidLessons), b.lessonsTotal)} · внесено ${formatSom(b.paidSom)} из ${formatSom(b.priceFinal)}`,
          tone: 'warn',
        }
      }
      if (state === 'soon') {
        return {
          ...base,
          state,
          label: 'Пора оплачивать',
          detail: lastText ? `последняя оплата ${lastText}` : null,
          tone: 'warn',
        }
      }
      return {
        ...base,
        state,
        label: `Долг ${unitCount(b, b.debtLessons)} · ${som(b.debtSom)}`,
        detail: lastText ? `последняя оплата ${lastText}` : null,
        tone: debtOverLimit(b.debtLessons) ? 'burned' : 'warn',
      }
    })
}

/** «Не оплатили» of the picker: any group in debt, due, partly paid or with nothing paid. */
export const unpaidStatus = (rows: readonly Pick<GroupPayStatus, 'state'>[]) =>
  rows.some((r) => r.state !== 'paid')

/** A line of «Оплаты ученика»: «05.10 · 3 200 сом · Mbank · Математика · 8 класс А · абонемент с 01.10 · Алишка». */
export function historyLine(
  p: PaymentRow,
  subs: ReadonlyMap<string, SubscriptionRow>,
  groups: ReadonlyMap<string, GroupBrief>,
): { date: string; amount: string; caption: string } {
  const s = subs.get(p.subscription.id)
  const g = groups.get(p.subscription.enrollment.group_id)
  return {
    date: dayMonth(paidOnDate(p.paid_at)),
    amount: `${signedSom(p.amount)} сом`,
    caption: [
      p.method ? METHOD_LABEL[p.method] : 'перенос',
      g ? groupLabel(g) : null,
      subscriptionCaption({
        started_at: s?.started_at,
        period_month: s?.period_month ?? p.subscription.period_month,
      }),
      p.kind === 'refund' ? 'возврат' : null,
      p.createdByName,
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

/** The toast: «Оплата записана: Айжан Б. · 3 200 сом · 8 класс А · абонемент с 01.10». */
export function recordedToast(
  studentName: string,
  amount: number,
  groupName: string | null,
  what: string,
): string {
  return ['Оплата записана: ' + studentName, som(amount), groupName, what]
    .filter(Boolean)
    .join(' · ')
}
