// А6 subscription card of one enrollment: desktop tiles and the phone block (АМ2).
import type { ReactNode } from 'react'
import { formatHours, monthAccusative } from '@/features/afterschool/model'
import { availableLessons, debtOverLimit, payState } from '@/features/payments/balance'
import { formatSom } from '@/features/tariffs/model'
import { cardClass, chipClass } from '@/features/tariffs/parts'
import { EnrollmentMenu, type ExitAction } from '@/features/subscriptions/enrollment-exit'
import { pluralRu } from '@/features/lessons/select'
import { cn } from '@/lib/utils'
import {
  discountCaption,
  firstName,
  formatDayMonth,
  priceCaption,
  scheduleCaption,
  type Balance,
  type EnrollmentView,
} from './model'
import { chipTone, debtCaption, debtTone, payChipLabel, type PayTone } from './pay-view'

const TONE_CLASS: Record<PayTone, string> = {
  ok: 'bg-present-soft text-present-strong',
  warn: 'bg-warn-soft text-warn-strong',
  burned: 'bg-burned-soft text-burned-deep',
}

export function enrollmentCaption(e: EnrollmentView, today: string): string {
  return [
    e.group?.teacher ? firstName(e.group.teacher.full_name) : null,
    e.group ? scheduleCaption(e.group.schedule_rules, today) || null : null,
    `зачислен ${formatDayMonth(e.startDate)}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Lessons, or hours of an after-school month (#82): «12», «20,5 ч». */
const units = (b: Pick<Balance, 'unit'>, n: number) =>
  b.unit === 'hour' ? `${formatHours(n)} ч` : String(n)

/** «Оплачено 6 из 12 · долг 2 ур. · 533 сом» — the one-line summary of the subscription. */
export function paySummary(b: Balance): string {
  const paid =
    b.unit === 'hour'
      ? `Оплачено ${formatHours(b.paidLessons)} из ${formatHours(b.lessonsTotal)} ч`
      : `Оплачено ${b.paidLessons} из ${b.lessonsTotal}`
  return b.debtLessons > 0 ? `${paid} · ${debtCaption(b.debtLessons, b.debtSom, b.unit)}` : paid
}

/** Colour + text: «Оплачено» / «Частично · 6 ур» / «Пора оплачивать» / «Долг». */
export function BalanceChip({ b, className }: { b: Balance; className?: string }) {
  const state = payState(b)
  return (
    <span className={cn(chipClass, TONE_CLASS[chipTone(state, b.debtLessons)], className)}>
      {payChipLabel(state, b.paidLessons, b.unit)}
    </span>
  )
}

export function RefundedChip({ className }: { className?: string }) {
  return <span className={cn(chipClass, 'bg-stone text-ink-muted', className)}>Возврат</span>
}

export const debtTextClass = (debtLessons: number) =>
  debtTone(debtLessons) === 'burned' ? 'text-burned' : 'text-warn'

function Tile({ label, value, caption }: { label: string; value: ReactNode; caption: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[14px] bg-muted px-3.5 py-3">
      <div className="text-[11px] font-extrabold tracking-[0.06em] text-ink-muted uppercase">
        {label}
      </div>
      <div className="font-display text-lg leading-tight font-bold">{value}</div>
      <div className="text-xs font-bold text-ink-muted">{caption}</div>
    </div>
  )
}

/** One segment per lesson: used and paid — green, used on debt — yellow/red, paid ahead — soft, unpaid — line. */
function UsageBar({ b, thin }: { b: Balance; thin?: boolean }) {
  const over = debtOverLimit(b.debtLessons)
  return (
    <div
      className={cn('flex gap-[3px]', thin ? 'h-2' : 'h-2.5')}
      role="img"
      aria-label={`Использовано ${units(b, b.lessonsUsed)} из ${units(b, b.lessonsTotal)}, оплачено ${units(b, b.paidLessons)}`}
    >
      {Array.from({ length: Math.ceil(b.lessonsTotal) }, (_, i) => {
        const used = i < b.lessonsUsed
        const paid = i < b.paidLessons
        return (
          <div
            key={i}
            className={cn(
              'flex-1 rounded-[3px]',
              used
                ? paid
                  ? 'bg-present'
                  : over
                    ? 'bg-burned'
                    : 'bg-warn'
                : paid
                  ? 'bg-present-soft'
                  : 'bg-line',
            )}
          />
        )
      })}
    </div>
  )
}

function Legend({ b, extra }: { b: Balance; extra?: string | null }) {
  const item = (cls: string, text: string) => (
    <span className="flex items-center gap-1.5">
      <span className={cn('inline-block size-2.5 rounded-[3px]', cls)} /> {text}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs font-bold text-ink-muted">
      {item('bg-present', 'использован')}
      {item('bg-present-soft', 'оплачен')}
      {item('bg-line', 'не оплачен')}
      {b.debtLessons > 0 && item(debtOverLimit(b.debtLessons) ? 'bg-burned' : 'bg-warn', 'в долг')}
      {extra && <span className="ml-auto">{extra}</span>}
    </div>
  )
}

function RefundedBody({ e }: { e: EnrollmentView }) {
  return (
    <p className="text-sm font-bold text-ink-muted">
      Абонемент возвращён
      {e.refunded ? ` · ${lessonsCaption(e.refunded.subscription.lessons_total)}` : ''}. Новый
      создаётся при оплате или зачислении.
    </p>
  )
}

/** «Изменить дату зачисления» (#60) — under the caption «… · зачислен 18 сентября». */
function EditStartButton({ e, onClick }: { e: EnrollmentView; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Изменить дату зачисления: ${e.groupLabel}`}
      className="flex min-h-11 items-center self-start text-xs font-extrabold whitespace-nowrap text-teal"
    >
      Изменить дату зачисления
    </button>
  )
}

export function EnrollmentCard({
  e,
  today,
  onEditStart,
  onAction,
  extra,
}: {
  e: EnrollmentView
  today: string
  onEditStart?: () => void
  /** «⋯»: перевести / ушёл / по ошибке (#81). */
  onAction?: (action: ExitAction) => void
  /** After-school: the plan and the month bills (#82). */
  extra?: ReactNode
}) {
  const sub = e.subscription
  const b = e.balance
  const days = isDays(e)
  const rest = sub && b ? Math.max(0, sub.price_final - b.paidSom) : 0
  return (
    <section
      aria-label={e.groupLabel}
      className={cn(cardClass, 'flex flex-col gap-3.5 px-[22px] py-5')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-extrabold">{e.groupLabel}</h2>
          <p className="text-xs font-bold text-ink-muted">{enrollmentCaption(e, today)}</p>
          {onEditStart && <EditStartButton e={e} onClick={onEditStart} />}
        </div>
        <div className="flex items-center gap-1.5">
          {b ? <BalanceChip b={b} /> : !sub && e.refunded && <RefundedChip />}
          <span className={cn(chipClass, 'bg-present-soft text-present-strong')}>Активен</span>
          {onAction && <EnrollmentMenu label={e.groupLabel} onAction={onAction} />}
        </div>
      </div>
      {extra}
      {sub && b && b.unit === 'hour' ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 min-[1200px]:grid-cols-4">
            <Tile
              label="Абонемент"
              value={`${formatHours(b.lessonsTotal)} ч`}
              caption={`${b.periodMonth ? `за ${monthAccusative(b.periodMonth)} · ` : ''}${priceCaption(sub)}`}
            />
            <Tile
              label="Списано"
              value={`${formatHours(b.lessonsUsed)} из ${formatHours(b.lessonsTotal)} ч`}
              caption={`заморозок ${b.freezesUsed}`}
            />
            <Tile
              label="Оплачено"
              value={`${formatSom(b.paidSom)} · ${formatHours(b.paidLessons)} ч`}
              caption={rest > 0 ? `остаток ${formatSom(rest)} сом` : 'оплачено полностью'}
            />
            <Tile
              label="Доступно часов"
              value={formatHours(Math.max(0, availableLessons(b)))}
              caption={
                b.debtLessons > 0 ? (
                  <span className={cn('font-extrabold', debtTextClass(b.debtLessons))}>
                    {debtCaption(b.debtLessons, b.debtSom, b.unit)}
                  </span>
                ) : (
                  'по графику'
                )
              }
            />
          </div>
          <UsageBar b={b} />
          <p className="text-[13px] font-extrabold">{paySummary(b)}</p>
          <Legend b={b} extra={discountCaption(sub)} />
        </>
      ) : sub && b ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 min-[1200px]:grid-cols-4">
            <Tile
              label="Абонемент"
              value={packageCaption(sub.lessons_total, days)}
              caption={priceCaption(sub)}
            />
            <Tile
              label="Использовано"
              value={`${b.lessonsUsed} из ${sub.lessons_total}${days ? ' дн' : ''}`}
              caption={`заморозок ${b.freezesUsed}`}
            />
            <Tile
              label="Оплачено"
              value={`${formatSom(b.paidSom)} · ${b.paidLessons} ${days ? 'дн' : 'ур'}`}
              caption={rest > 0 ? `остаток ${formatSom(rest)} сом` : 'оплачено полностью'}
            />
            <Tile
              label={days ? 'Доступно дней' : 'Доступно уроков'}
              value={Math.max(0, availableLessons(b))}
              caption={
                b.debtLessons > 0 ? (
                  <span className={cn('font-extrabold', debtTextClass(b.debtLessons))}>
                    {debtCaption(b.debtLessons, b.debtSom)}
                  </span>
                ) : (
                  'до 3 в долг'
                )
              }
            />
          </div>
          <UsageBar b={b} />
          <p className="text-[13px] font-extrabold">{paySummary(b)}</p>
          <Legend b={b} extra={discountCaption(sub)} />
        </>
      ) : !sub && e.refunded ? (
        <RefundedBody e={e} />
      ) : (
        <p className="text-sm font-bold text-ink-muted">Абонемента нет</p>
      )}
    </section>
  )
}

export function MobileEnrollment({
  e,
  today,
  onEditStart,
  onAction,
  extra,
}: {
  e: EnrollmentView
  today: string
  onEditStart?: () => void
  /** «⋯»: перевести / ушёл / по ошибке (#81). */
  onAction?: (action: ExitAction) => void
  /** After-school: the plan and the month bills (#82). */
  extra?: ReactNode
}) {
  const sub = e.subscription
  const b = e.balance
  const days = isDays(e)
  return (
    <section
      aria-label={e.groupLabel}
      className={cn(cardClass, 'flex flex-col gap-2.5 rounded-[18px] px-4 py-3.5')}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-extrabold">Абонемент · {e.groupLabel}</h2>
        <div className="-my-2 -mr-2 flex items-center gap-0.5">
          {b ? (
            <BalanceChip b={b} className="text-[11px]" />
          ) : (
            !sub && e.refunded && <RefundedChip className="text-[11px]" />
          )}
          {onAction && <EnrollmentMenu label={e.groupLabel} onAction={onAction} />}
        </div>
      </div>
      <p className="text-xs font-bold text-ink-muted">
        {sub
          ? `${b?.unit === 'hour' ? `${formatHours(b.lessonsTotal)} ч${b.periodMonth ? ` за ${monthAccusative(b.periodMonth)}` : ''}` : packageCaption(sub.lessons_total, days)} · ${priceCaption(sub)} · ${enrollmentCaption(e, today)}`
          : enrollmentCaption(e, today)}
      </p>
      {onEditStart && <EditStartButton e={e} onClick={onEditStart} />}
      {extra}
      {sub && b ? (
        <>
          <UsageBar b={b} thin />
          <p className="text-xs font-extrabold">
            {b.unit === 'hour' ? 'Списано' : 'Использовано'} {units(b, b.lessonsUsed)} из{' '}
            {units(b, b.lessonsTotal)}
            {days && b.unit !== 'hour' ? ` ${daysOf(b.lessonsTotal)}` : ''} · заморозок{' '}
            {b.freezesUsed}
          </p>
          <p className="text-xs font-extrabold">{paySummary(b)}</p>
          <p className="text-xs font-bold text-ink-muted">
            Оплачено {formatSom(b.paidSom)} из {formatSom(sub.price_final)} сом · доступно{' '}
            {units(b, Math.max(0, availableLessons(b)))}
            {days && b.unit !== 'hour' ? ' дн' : ''}
          </p>
        </>
      ) : !sub && e.refunded ? (
        <RefundedBody e={e} />
      ) : null}
    </section>
  )
}

/** «12 уроков», «4 урока» — the package size (И89: any 1 … 2 × package). */
const lessonsCaption = (n: number) => `${n} ${pluralRu(n, ['урок', 'урока', 'уроков'])}`

/** After-school: a package of days, not lessons (К13, #111). */
const isDays = (e: EnrollmentView) => e.group?.group_type === 'afterschool'

/** «из 12 дней», «из 21 дня». */
const daysOf = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'дня' : 'дней')

/** «12 дней» for after-school, else «12 уроков». */
const packageCaption = (n: number, days: boolean) =>
  days ? `${n} ${pluralRu(n, ['день', 'дня', 'дней'])}` : lessonsCaption(n)
