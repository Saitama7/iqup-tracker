import { useState } from 'react'
import { inputClass, labelClass } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import { MAX_PRICE, priceValid } from './model'

/**
 * «Цена, сом» of a new package (К12): prefilled with the tariff's price of the chosen size and
 * following it; typing pins the admin's price («своя цена»), «по тарифу» drops it again.
 * `value` null — by the tariff; a typed text that is not a whole number — NaN.
 */
export function PriceField({
  id,
  defaultPrice,
  value,
  onChange,
  caption,
}: {
  id: string
  /** The tariff's price of the chosen size. */
  defaultPrice: number
  value: number | null
  onChange: (price: number | null) => void
  /** Under the field: «8 занятий по 1,5 ч = 12 ч · 900 за занятие» (individual, К11). */
  caption?: string | null
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const custom = value !== null
  const invalid = custom && !priceValid(value)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className={labelClass}>
          Цена, сом
        </label>
        {custom && (
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-teal-soft px-2 py-0.5 text-[11px] font-extrabold whitespace-nowrap text-teal-strong">
              своя цена
            </span>
            <button
              type="button"
              onClick={() => {
                setText('')
                onChange(null)
              }}
              className="min-h-11 text-xs font-extrabold whitespace-nowrap text-teal"
            >
              по тарифу
            </button>
          </span>
        )}
      </div>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={custom ? text : String(defaultPrice)}
        onChange={(e) => {
          const v = e.target.value.replace(/\s/g, '')
          setText(v)
          onChange(v === '' ? Number.NaN : /^\d+$/.test(v) ? Number(v) : Number.NaN)
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={caption ? `${id}-caption` : undefined}
        className={cn(inputClass, 'tabular-nums', invalid && 'border-burned-strong')}
      />
      {invalid ? (
        <p className="text-xs font-bold text-burned-strong">
          Цена — целое число от 1 до {MAX_PRICE.toLocaleString('ru-RU')} сом
        </p>
      ) : (
        caption && (
          <p id={`${id}-caption`} className="text-xs font-bold text-ink-muted">
            {caption}
          </p>
        )
      )}
    </div>
  )
}
