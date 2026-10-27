import { useState } from 'react'
import { inputClass, labelClass } from '@/features/tariffs/parts'
import type { TariffTerms } from '@/features/tariffs/current'
import { cn } from '@/lib/utils'
import { lessonSizePresets, maxSubscriptionLessons } from './model'

/** «Уроков» of a new package is a whole 1 … 2 × lessons_in_package (И89); null — the default size. */
export function lessonsValid(tariff: TariffTerms, lessons: number | null): boolean {
  return (
    lessons === null ||
    (Number.isInteger(lessons) && lessons >= 1 && lessons <= maxSubscriptionLessons(tariff))
  )
}

/**
 * «Уроков» (И89): `12 · 8 · 4 · другое` — the package size bought at the same lesson price.
 * `value` null — the default size (`byDefault`: the tariff's package; individual — the tariff's hours
 * in lessons of the group, К11); «другое» — a number 1 … 2 × package (NaN while empty).
 */
export function LessonsField({
  id,
  tariff,
  byDefault = tariff.lessons_in_package,
  value,
  onChange,
}: {
  id: string
  tariff: TariffTerms
  byDefault?: number
  value: number | null
  onChange: (lessons: number | null) => void
}) {
  const presets = lessonSizePresets(tariff, byDefault)
  const max = maxSubscriptionLessons(tariff)
  const [other, setOther] = useState(value !== null && !presets.includes(value))
  const [text, setText] = useState(other && value !== null ? String(value) : '')
  const selected = value ?? byDefault
  const invalid = other && !lessonsValid(tariff, value)

  const chip = (on: boolean) =>
    cn(
      'min-h-11 flex-1 rounded-xl text-[13px] tabular-nums',
      on
        ? 'bg-ink font-extrabold text-brand'
        : 'border-[1.5px] border-line-strong font-bold text-ink-muted',
    )

  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelClass} id={`${id}-label`}>
        Уроков
      </span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex gap-2">
        {presets.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={!other && selected === n}
            onClick={() => {
              setOther(false)
              onChange(n === byDefault ? null : n)
            }}
            className={chip(!other && selected === n)}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={other}
          onClick={() => {
            setOther(true)
            const n = text === '' ? Number.NaN : Number(text)
            onChange(n)
          }}
          className={chip(other)}
        >
          другое
        </button>
      </div>
      {other && (
        <input
          id={id}
          aria-label="Уроков в абонементе"
          inputMode="numeric"
          autoComplete="off"
          placeholder={`1–${max}`}
          value={text}
          onChange={(e) => {
            const v = e.target.value.replace(/\s/g, '')
            setText(v)
            onChange(/^\d+$/.test(v) ? Number(v) : Number.NaN)
          }}
          aria-invalid={invalid || undefined}
          className={cn(inputClass, invalid && text !== '' && 'border-burned-strong')}
        />
      )}
      {invalid && text !== '' && (
        <p className="text-xs font-bold text-burned-strong">Уроков — от 1 до {max}</p>
      )}
    </div>
  )
}
