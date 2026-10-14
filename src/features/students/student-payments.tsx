// А6 «Платежи» of one student and the «Итого по ученику» money rows.
import { Link } from '@tanstack/react-router'
import { formatSom } from '@/features/tariffs/model'
import { cardClass } from '@/features/tariffs/parts'
import type { PaymentRow } from '@/features/payments/api'
import { bishkekDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { formatShortDate } from './model'
import { METHOD_LABEL } from './pay-view'

const MINUS = '−'

/** «+ 1 600 сом» / «− 1 333 сом». */
export function signedSom(amount: number): string {
  return `${amount < 0 ? MINUS : '+'} ${formatSom(Math.abs(amount))} сом`
}

/** «1 окт · Mbank · Алишка · половина абонемента» (+ the group when the student has several). */
export function paymentCaption(p: PaymentRow, groupName: string | null): string {
  return [
    formatShortDate(bishkekDate(Date.parse(p.paid_at))),
    p.method ? METHOD_LABEL[p.method] : null,
    p.createdByName,
    groupName,
    p.reason,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function PaymentsSection({
  studentId,
  payments,
  state,
  groupNameOf,
}: {
  studentId: string
  payments: readonly PaymentRow[]
  state: 'pending' | 'error' | 'ready'
  groupNameOf: (groupId: string) => string | null
}) {
  return (
    <section aria-label="Платежи" className={cn(cardClass, 'flex flex-col')}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3 min-[900px]:px-[18px] min-[900px]:py-3.5">
        <h2 className="text-[15px] font-extrabold">Платежи</h2>
        <Link
          to="/admin/payments"
          search={{ student: studentId }}
          className="flex min-h-11 items-center text-xs font-extrabold whitespace-nowrap text-teal"
        >
          + Платёж
        </Link>
      </div>
      {state === 'pending' ? (
        <div className="m-4 h-12 animate-pulse rounded-xl bg-muted" aria-label="Загрузка" />
      ) : state === 'error' ? (
        <p role="alert" className="px-4 py-5 text-[13px] font-bold text-burned">
          Не удалось загрузить платежи. Обновите страницу.
        </p>
      ) : payments.length === 0 ? (
        <p className="px-4 py-5 text-center text-[13px] font-bold text-ink-muted">Платежей нет</p>
      ) : (
        <ul>
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0 min-[900px]:px-[18px]"
            >
              <span className="min-w-0 font-bold text-ink-muted">
                {paymentCaption(p, groupNameOf(p.subscription.enrollment.group_id))}
              </span>
              <span
                className={cn(
                  'font-extrabold whitespace-nowrap tabular-nums',
                  p.kind === 'refund' && 'text-burned',
                )}
              >
                {signedSom(p.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
