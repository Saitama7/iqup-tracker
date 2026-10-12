// А7 «Оплаты» view model: pure functions of (rows, today) — no fetching, no clock.
// Journal of a month (Г2: cash / Mbank apart), totals by group and teacher (Г4), the record panel.
import { pluralRu } from '@/features/lessons/select'
import { formatLessonPrice, formatSom } from '@/features/tariffs/model'
import { availableLessons, paidLessons, payState, type PayState } from './balance'
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
}

/** Lessons a refund paid back: amount / (price_final / lessons_total). */
export const refundLessons = (amount: number, lessonsTotal: number, priceFinal: number) =>
  priceFinal > 0 ? Math.round((Math.abs(amount) * lessonsTotal) / priceFinal) : 0

export function journalRow(p: PaymentRow, lookups: Lookups): JournalRow {
  const s = p.subscription
  const group = lookups.groups.get(s.enrollment.group_id)
  const refund = p.kind === 'refund'
  const tags = [
    p.createdByName ?? 'система',
    refund ? 'возврат' : p.amount < s.price_final ? 'частично' : null,
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
    package: refund
      ? `остаток ${refundLessons(p.amount, s.lessons_total, s.price_final)} ур`
      : `${s.lessons_total} ур · ${formatSom(s.price_final)}`,
    method: METHOD_LABEL[p.method],
    amount: p.amount,
    author: tags.join(' · '),
    refund,
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
      ? `осталось ${b.lessonsLeft} из ${b.lessonsTotal}`
      : `сверх абонемента ${-b.lessonsLeft} ${pluralRu(-b.lessonsLeft, LESSONS)}`
  const note =
    state === 'debt'
      ? `долг ${b.debtLessons} ${pluralRu(b.debtLessons, LESSONS)} · ${som(b.debtSom)}`
      : state === 'soon'
        ? 'пора оплачивать'
        : state === 'partial'
          ? `оплачено ${b.paidLessons} из ${b.lessonsTotal}`
          : 'оплачен'
  return { text: `Текущий: ${left}`, state, note }
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
  )
  const available = availableLessons({ paidLessons: paid, lessonsUsed: current.lessonsUsed })
  const debt = Math.max(0, -available)
  return debt > 0
    ? `После записи: оплачено ${Math.min(paid, current.lessonsTotal)} из ${current.lessonsTotal}, долг ${debt} ${pluralRu(debt, LESSONS)}`
    : `После записи: оплачено ${Math.min(paid, current.lessonsTotal)} из ${current.lessonsTotal}, доступно ${available} ${pluralRu(available, LESSONS)}`
}

/** «остаток 5 ур × 266,67» under the refund amount (В8). */
export function refundHint(b: StudentBalance): string {
  const lessons = Math.max(0, Math.min(b.paidLessons, b.lessonsTotal) - b.lessonsUsed)
  return `Остаток ${lessons} ${pluralRu(lessons, LESSONS)} × ${formatLessonPrice(b.priceFinal / b.lessonsTotal, true)} сом = ${som(b.refundSuggested)}`
}

/** Digits of the amount field: «3 200» → 3200; empty / junk → null. */
export function parseAmount(v: string): number | null {
  const d = v.replace(/\s/g, '')
  return /^\d+$/.test(d) ? Number(d) : null
}
