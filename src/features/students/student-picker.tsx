// Student picker (#93): search by name (И47 nameKey: ё = е, case, spaces) or the parent's phone, a
// row per student — name · grade, phone and groups, and optionally a status per group (А7 «Записать
// оплату»: what was paid, when). Desktop: the field opens a popover; phone: a bottom sheet that the
// system «назад» closes (Sheet → useBackClose). Reusable: А11 «Уже учится», enrollment.
import { ChevronDown, Search } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { nameKey } from '@/features/trials/model'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { displayPhone, matchesQuery } from './model'

export interface StudentPickerStatus {
  key: string
  /** «Математика · 8 класс А» — shown when the student has more than one group. */
  group?: string
  label: string
  detail?: string | null
  tone: 'ok' | 'warn' | 'burned' | 'muted'
}

export interface StudentPickerOption {
  id: string
  fullName: string
  grade: number | null
  parentPhone: string | null
  /** «Математика · 8 класс А · Химия · 9 класс». */
  groups: string
  statuses?: StudentPickerStatus[]
  /** «Не оплатили» chip; the chips are shown when any option has it set. */
  unpaid?: boolean
}

type Filter = 'all' | 'unpaid' | 'paid'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'unpaid', label: 'Не оплатили' },
  { id: 'paid', label: 'Оплатили' },
]

const TONE: Record<StudentPickerStatus['tone'], string> = {
  ok: 'bg-present-soft text-present-strong',
  warn: 'bg-warn-soft text-warn-strong',
  burned: 'bg-burned-soft text-burned-deep',
  muted: 'bg-band text-ink-muted',
}

/** Name by substring (nameKey), a phone by its digits (А5 search). */
export function pickerMatches(o: Pick<StudentPickerOption, 'fullName' | 'parentPhone'>, q: string) {
  const query = q.trim()
  if (!query) return true
  if (/^[\d\s+()-]+$/.test(query)) return matchesQuery(o, query)
  return nameKey(o.fullName).includes(nameKey(query))
}

export function StudentPicker({
  id,
  value,
  onChange,
  options,
  placeholder = 'Выберите ученика',
  triggerRef,
}: {
  id: string
  value: string
  onChange: (studentId: string) => void
  options: readonly StudentPickerOption[]
  placeholder?: string
  /** The field — the panel puts the focus back here for the next student. */
  triggerRef?: Ref<HTMLButtonElement>
}) {
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.id === value)
  const withChips = options.some((o) => o.unpaid !== undefined)

  const shown = useMemo(
    () =>
      options.filter(
        (o) =>
          pickerMatches(o, query) &&
          (filter === 'all' || (filter === 'unpaid' ? o.unpaid === true : o.unpaid === false)),
      ),
    [options, query, filter],
  )
  const counts = useMemo(
    () => ({
      all: options.length,
      unpaid: options.filter((o) => o.unpaid === true).length,
      paid: options.filter((o) => o.unpaid === false).length,
    }),
    [options],
  )

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }
  const pick = (studentId: string) => {
    onChange(studentId)
    onOpenChange(false)
  }
  const optionButtons = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      optionButtons()[0]?.focus()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const only = shown.length === 1 ? shown[0] : undefined
      if (only) pick(only.id)
    }
  }
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = optionButtons()
    const i = items.findIndex((b) => b === document.activeElement)
    items[e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)]?.focus()
  }

  const trigger = (
    <button
      ref={triggerRef}
      id={id}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => {
        onOpenChange(!open)
      }}
      className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 text-left text-base font-bold text-ink outline-none focus:border-ink"
    >
      <span
        className={cn('min-w-0 flex-1 truncate', !selected && 'font-semibold text-placeholder')}
      >
        {selected
          ? `${selected.fullName}${selected.grade ? ` · ${selected.grade} класс` : ''}`
          : placeholder}
      </span>
      <ChevronDown className="size-4 shrink-0 text-ink-muted" strokeWidth={2.5} aria-hidden />
    </button>
  )

  const body = (
    <div className="flex w-full min-w-0 flex-col gap-2.5">
      <div className="flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 focus-within:border-ink">
        <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={2.5} aria-hidden />
        <input
          type="search"
          aria-label="Поиск ученика"
          placeholder="Имя или телефон родителя"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
          }}
          onKeyDown={onSearchKey}
          className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:font-semibold placeholder:text-placeholder"
        />
      </div>
      {withChips && (
        <div role="group" aria-label="Оплата" className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id)
              }}
              className={cn(
                'inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-[13px] font-extrabold whitespace-nowrap',
                filter === f.id
                  ? 'bg-ink text-brand'
                  : 'border-[1.5px] border-line-strong bg-card text-ink-muted',
              )}
            >
              {f.label} · {counts[f.id]}
            </button>
          ))}
        </div>
      )}
      <div
        ref={listRef}
        role="listbox"
        tabIndex={-1}
        aria-label="Ученики"
        onKeyDown={onListKey}
        className={cn(
          'flex flex-col overflow-y-auto overscroll-contain',
          isDesktop ? 'max-h-[360px]' : 'max-h-[55dvh]',
        )}
      >
        {shown.map((o) => (
          <button
            key={o.id}
            type="button"
            role="option"
            aria-selected={o.id === value}
            onClick={() => {
              pick(o.id)
            }}
            className={cn(
              'flex min-h-11 w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-band focus-visible:bg-band',
              o.id === value && 'bg-band',
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-extrabold text-ink">
                {o.fullName}
                {o.grade ? <span className="text-ink-muted"> · {o.grade} класс</span> : null}
              </span>
              <span className="text-xs font-bold text-ink-muted">
                {o.parentPhone && (
                  <span className="whitespace-nowrap">{displayPhone(o.parentPhone)}</span>
                )}
                {o.parentPhone && o.groups ? ' · ' : null}
                {o.groups}
              </span>
            </span>
            {o.statuses && o.statuses.length > 0 && (
              <span className="flex max-w-[55%] shrink-0 flex-col items-end gap-1 text-right">
                {o.statuses.map((s) => (
                  <span key={s.key} className="flex flex-col items-end gap-0.5">
                    {o.statuses && o.statuses.length > 1 && s.group && (
                      <span className="text-[11px] font-bold text-ink-muted">{s.group}</span>
                    )}
                    <span
                      className={cn(
                        'inline-block rounded-full px-2.5 py-0.5 text-xs leading-[1.4] font-extrabold whitespace-nowrap',
                        TONE[s.tone],
                      )}
                    >
                      {s.label}
                    </span>
                    {s.detail && (
                      <span className="text-[11px] leading-tight font-bold text-ink-muted">
                        {s.detail}
                      </span>
                    )}
                  </span>
                ))}
              </span>
            )}
          </button>
        ))}
        {shown.length === 0 && (
          <p className="px-2.5 py-3 text-sm font-bold text-ink-muted">Никого не нашли</p>
        )}
      </div>
    </div>
  )

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverAnchor asChild>{trigger}</PopoverAnchor>
        <PopoverContent
          aria-label="Выбор ученика"
          align="end"
          className="w-[420px] max-w-[calc(100vw-2rem)]"
          onPointerDownOutside={(e) => {
            // the field toggles the popover itself
            if (document.getElementById(id)?.contains(e.target as Node)) e.preventDefault()
          }}
        >
          {body}
        </PopoverContent>
      </Popover>
    )
  }
  return (
    <>
      {trigger}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="gap-0 rounded-t-[24px] border-line bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" aria-hidden />
          <SheetTitle className="px-1 pb-2 font-display text-lg font-bold">
            Выбор ученика
          </SheetTitle>
          <SheetDescription className="sr-only">
            Найдите ученика по имени или телефону
          </SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    </>
  )
}
