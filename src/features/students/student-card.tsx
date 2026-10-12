// А6 subscription card of one enrollment: desktop tiles and the phone block (АМ2).
import type { ReactNode } from 'react'
import { availableLessons, debtOverLimit, payState } from '@/features/payments/balance'
import { formatSom } from '@/features/tariffs/model'
import { cardClass, chipClass } from '@/features/tariffs/parts'
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

/** «Оплачено 6 из 12 · долг 2 ур. · 533 сом» — the one-line summary of the subscription. */
export function paySummary(b: Balance): string {
  const paid = `Оплачено ${b.paidLessons} из ${b.lessonsTotal}`
  return b.debtLessons > 0 ? `${paid} · ${debtCaption(b.debtLessons, b.debtSom)}` : paid
}

/** Colour + text: «Оплачено» / «Частично · 6 ур» / «Пора оплачивать» / «Долг». */
export function BalanceChip({ b, className }: { b: Balance; className?: string }) {
  const state = payState(b)
  return (
    <span className={cn(chipClass, TONE_CLASS[chipTone(state, b.debtLessons)], className)}>
      {payChipLabel(state, b.paidLessons)}
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
    <div className="rounded-[14px] bg-muted px-3.5 py-3">
      <div className="text-[11px] font-extrabold tracking-[0.06em] text-ink-muted uppercase">
        {label}
      </div>
      <div className="font-display text-lg font-bold whitespace-nowrap">{value}</div>
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
      aria-label={`Использовано ${b.lessonsUsed} из ${b.lessonsTotal}, оплачено ${b.paidLessons}`}
    >
      {Array.from({ length: b.lessonsTotal }, (_, i) => {
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
      {e.refunded ? ` · ${e.refunded.subscription.lessons_total} уроков` : ''}. Новый создаётся при
      оплате или зачислении.
    </p>
  )
}

export function EnrollmentCard({ e, today }: { e: EnrollmentView; today: string }) {
  const sub = e.subscription
  const b = e.balance
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
        </div>
        <div className="flex items-center gap-1.5">
          {b ? <BalanceChip b={b} /> : !sub && e.refunded && <RefundedChip />}
          <span className={cn(chipClass, 'bg-present-soft text-present-strong')}>Активен</span>
        </div>
      </div>
      {sub && b ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 min-[1200px]:grid-cols-4">
            <Tile
              label="Абонемент"
              value={`${sub.lessons_total} уроков`}
              caption={priceCaption(sub)}
            />
            <Tile
              label="Использовано"
              value={`${b.lessonsUsed} из ${sub.lessons_total}`}
              caption={`заморозок ${b.freezesUsed} / ${b.freezeLimit}`}
            />
            <Tile
              label="Оплачено"
              value={`${formatSom(b.paidSom)} · ${b.paidLessons} ур`}
              caption={rest > 0 ? `остаток ${formatSom(rest)} сом` : 'оплачено полностью'}
            />
            <Tile
              label="Доступно уроков"
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

export function MobileEnrollment({ e, today }: { e: EnrollmentView; today: string }) {
  const sub = e.subscription
  const b = e.balance
  return (
    <section
      aria-label={e.groupLabel}
      className={cn(cardClass, 'flex flex-col gap-2.5 rounded-[18px] px-4 py-3.5')}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-extrabold">Абонемент · {e.groupLabel}</h2>
        {b ? (
          <BalanceChip b={b} className="text-[11px]" />
        ) : (
          !sub && e.refunded && <RefundedChip className="text-[11px]" />
        )}
      </div>
      <p className="text-xs font-bold text-ink-muted">
        {sub
          ? `${sub.lessons_total} уроков · ${priceCaption(sub)} · ${enrollmentCaption(e, today)}`
          : enrollmentCaption(e, today)}
      </p>
      {sub && b ? (
        <>
          <UsageBar b={b} thin />
          <p className="text-xs font-extrabold">
            Использовано {b.lessonsUsed} из {sub.lessons_total} · заморозок {b.freezesUsed} /{' '}
            {b.freezeLimit}
          </p>
          <p className="text-xs font-extrabold">{paySummary(b)}</p>
          <p className="text-xs font-bold text-ink-muted">
            Оплачено {formatSom(b.paidSom)} из {formatSom(sub.price_final)} сом · доступно{' '}
            {Math.max(0, availableLessons(b))}
          </p>
        </>
      ) : !sub && e.refunded ? (
        <RefundedBody e={e} />
      ) : null}
    </section>
  )
}
