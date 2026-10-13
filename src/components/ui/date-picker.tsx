// Date and month pickers (#62): a calendar in a popover on desktop, in a bottom sheet on the phone.
// Typed input stays — DateInput keeps the ДД.ММ.ГГГГ text field (maskDateInput) and adds the calendar;
// DatePickerButton / MonthPickerButton turn a period title into a jump to any day / month.
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { flushSync } from 'react-dom'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { maskDateInput } from '@/lib/date-input'
import { useNow } from '@/lib/now'
import {
  bishkekDate,
  formatDateRu,
  isoToLocalDate,
  localDateToIso,
  MONTHS_NOM,
  parseDateRu,
} from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'

/** Inclusive bounds, ISO dates (`YYYY-MM-DD`); days outside are greyed out and not selectable. */
export interface DateBounds {
  min?: string | null
  max?: string | null
}

const footerButton =
  'min-h-11 rounded-xl border-[1.5px] border-line-strong bg-card px-4 text-[13px] font-extrabold text-ink disabled:opacity-40'

// ─── Popup: popover on desktop, bottom sheet on the phone ───────────────────

function PickerPopup({
  open,
  onOpenChange,
  title,
  anchor,
  toggleRef,
  onCloseAutoFocus,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** The field / title button; on desktop the popover is positioned under it. */
  anchor: ReactElement
  /** The button that opens / closes the popup (the icon in a field, the title itself). */
  toggleRef: RefObject<HTMLElement | null>
  onCloseAutoFocus?: (e: Event) => void
  children: ReactNode
}) {
  const isDesktop = useIsDesktop()
  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverAnchor asChild>{anchor}</PopoverAnchor>
        <PopoverContent
          aria-label={title}
          onCloseAutoFocus={onCloseAutoFocus}
          onPointerDownOutside={(e) => {
            // a tap on the toggle opens / closes the picker itself — not «outside». A click into
            // the field is outside: it closes the popover (#66)
            if (toggleRef.current?.contains(e.target as Node)) e.preventDefault()
          }}
          onFocusOutside={(e) => {
            // …nor is the focus it takes on that click (Chrome), or a second click would reopen
            if (toggleRef.current?.contains(e.target as Node)) e.preventDefault()
          }}
        >
          {children}
        </PopoverContent>
      </Popover>
    )
  }
  return (
    <>
      {anchor}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onCloseAutoFocus={onCloseAutoFocus}
          className="items-center gap-0 rounded-t-[24px] border-line bg-card px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" aria-hidden />
          <SheetTitle className="self-stretch px-2 pb-2 font-display text-lg font-bold">
            {title}
          </SheetTitle>
          <SheetDescription className="sr-only">Выберите в календаре</SheetDescription>
          {children}
        </SheetContent>
      </Sheet>
    </>
  )
}

function useTodayIso(): string {
  return bishkekDate(useNow())
}

const inBounds = (iso: string, { min, max }: DateBounds) =>
  (!min || iso >= min) && (!max || iso <= max)

// ─── Day calendar ───────────────────────────────────────────────────────────

/** A typo like «01.01.0202» must not unroll 1800 years in the dropdown (#66). */
const MIN_YEAR = 1900

/**
 * Years in the month/year dropdowns without bounds: 5 back and 2 ahead of today, widened so the
 * field's value is always in range (#64), but not before 1900 (#66).
 */
export function yearRange(today: string, value: string | null): { from: number; to: number } {
  const year = Number(today.slice(0, 4))
  const own = value ? Number(value.slice(0, 4)) : year
  return { from: Math.max(MIN_YEAR, Math.min(own, year - 5)), to: Math.max(own, year + 2) }
}

/** Monday – Sunday around an ISO date, as local dates for the day picker. */
function weekOf(iso: string): { from: Date; to: Date } {
  const d = isoToLocalDate(iso)
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
  return { from, to: new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6) }
}

function DayCalendar({
  value,
  bounds,
  week = false,
  onSelect,
  onClose,
  onManual,
}: {
  value: string | null
  bounds: DateBounds
  /** Highlight the whole Monday – Sunday week of `value`. */
  week?: boolean
  onSelect: (iso: string) => void
  onClose: () => void
  /** Phone field: «Ввести вручную» closes the sheet and hands the field to the keyboard. */
  onManual?: () => void
}) {
  const today = useTodayIso()
  const years = yearRange(today, value)
  const { min, max } = bounds
  const initial = value ?? (min && today < min ? min : max && today > max ? max : today)
  const disabled = [
    ...(min ? [{ before: isoToLocalDate(min) }] : []),
    ...(max ? [{ after: isoToLocalDate(max) }] : []),
  ]
  return (
    <div className="flex flex-col gap-2">
      <Calendar
        mode="single"
        required={false}
        selected={value ? isoToLocalDate(value) : undefined}
        onSelect={(d) => {
          if (d) onSelect(localDateToIso(d))
        }}
        defaultMonth={isoToLocalDate(initial)}
        today={isoToLocalDate(today)}
        startMonth={isoToLocalDate(min ?? `${years.from}-01-01`)}
        endMonth={isoToLocalDate(max ?? `${years.to}-12-31`)}
        disabled={disabled}
        modifiers={week && value ? { week: weekOf(value) } : undefined}
        modifiersClassNames={{ week: 'bg-stone first:rounded-l-xl last:rounded-r-xl' }}
      />
      <div className="flex justify-between gap-2 border-t border-line pt-2">
        <button
          type="button"
          className={footerButton}
          disabled={!inBounds(today, bounds)}
          onClick={() => {
            onSelect(today)
          }}
        >
          Сегодня
        </button>
        {onManual && (
          <button type="button" className={cn(footerButton, 'border-0 px-2')} onClick={onManual}>
            Ввести вручную
          </button>
        )}
        <button type="button" className={cn(footerButton, 'border-0')} onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  )
}

/**
 * ДД.ММ.ГГГГ field with a calendar. Same contract as the plain input it replaces: `value` /
 * `onChange` carry the typed text, forms validate it as before. The calendar opens from the icon
 * on the right. On the phone a tap on the field opens it too; closing never focuses the field (no
 * stray keyboard on Android), typing starts from «Ввести вручную» in the sheet (#64).
 */
export function DateInput({
  id,
  value,
  onChange,
  min,
  max,
  className,
  title = 'Выберите дату',
  ...inputProps
}: {
  id: string
  value: string
  onChange: (value: string) => void
  title?: string
  className?: string
} & DateBounds &
  Omit<ComponentProps<'input'>, 'id' | 'value' | 'onChange' | 'min' | 'max' | 'className'>) {
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  /** Phone: typing chosen via «Ввести вручную» — until the field loses focus. */
  const typing = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLButtonElement>(null)
  const iso = parseDateRu(value)

  return (
    <PickerPopup
      open={open}
      onOpenChange={setOpen}
      title={title}
      toggleRef={iconRef}
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        if (!isDesktop) return
        // closed by a click into another field: the focus stays there, typing goes there (#66)
        const active = document.activeElement
        if (!active || active === document.body || anchorRef.current?.contains(active)) {
          inputRef.current?.focus()
        }
      }}
      anchor={
        <div ref={anchorRef} className="relative min-w-0">
          <input
            ref={inputRef}
            id={id}
            inputMode="numeric"
            placeholder="ДД.ММ.ГГГГ"
            autoComplete="off"
            {...inputProps}
            className={cn(className, 'pr-12')}
            value={value}
            onPointerDown={(e) => {
              // typing after «Ввести вручную»: the tap moves the caret. Focus alone is not enough —
              // a dialog autofocuses its first field
              if (isDesktop || typing.current) return
              e.preventDefault()
              setOpen(true)
            }}
            onChange={(e) => {
              onChange(maskDateInput(e.target.value))
            }}
            onBlur={(e) => {
              typing.current = false
              inputProps.onBlur?.(e)
            }}
          />
          <button
            ref={iconRef}
            type="button"
            aria-label="Открыть календарь"
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={inputProps.disabled}
            onClick={() => {
              setOpen(!open)
            }}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-ink-muted hover:text-ink disabled:opacity-40"
          >
            <CalendarDays className="size-5" strokeWidth={2.2} aria-hidden />
          </button>
        </div>
      }
    >
      <DayCalendar
        value={iso}
        bounds={{ min, max }}
        onClose={() => {
          setOpen(false)
        }}
        onSelect={(d) => {
          onChange(formatDateRu(d))
          setOpen(false)
        }}
        onManual={
          isDesktop
            ? undefined
            : () => {
                // iOS raises the keyboard only for a focus inside the tap itself: close the sheet
                // (lifting its focus trap) and focus synchronously in this handler
                flushSync(() => {
                  setOpen(false)
                })
                typing.current = true
                inputRef.current?.focus()
              }
        }
      />
    </PickerPopup>
  )
}

const titleButton =
  'inline-flex max-w-full items-center gap-1.5 rounded-xl text-left text-ink underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none'

/** A period title («5 – 10 октября») that opens a calendar; picking a day jumps to it. */
export function DatePickerButton({
  value,
  onSelect,
  title = 'Перейти к дате',
  children,
  className,
  min,
  max,
  week = false,
}: {
  /** ISO date shown (selected in the calendar). */
  value: string
  onSelect: (iso: string) => void
  title?: string
  children: ReactNode
  className?: string
  /** The title is a week: the calendar highlights all of it, not one day. */
  week?: boolean
} & DateBounds) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  return (
    <PickerPopup
      open={open}
      onOpenChange={setOpen}
      title={title}
      toggleRef={anchorRef}
      anchor={
        <button
          ref={anchorRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={title}
          onClick={() => {
            setOpen(!open)
          }}
          className={cn(titleButton, className)}
        >
          {children}
          <ChevronDown className="size-5 shrink-0 text-ink-muted" strokeWidth={2.5} aria-hidden />
        </button>
      }
    >
      <DayCalendar
        value={value}
        bounds={{ min, max }}
        week={week}
        onClose={() => {
          setOpen(false)
        }}
        onSelect={(d) => {
          onSelect(d)
          setOpen(false)
        }}
      />
    </PickerPopup>
  )
}

// ─── Month picker ───────────────────────────────────────────────────────────

/** Month `YYYY-MM`; bounds are months too. */
export function MonthPickerButton({
  value,
  onSelect,
  min,
  max,
  title = 'Выберите месяц',
  children,
  className,
}: {
  value: string
  onSelect: (month: string) => void
  min?: string
  max?: string
  title?: string
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  return (
    <PickerPopup
      open={open}
      onOpenChange={setOpen}
      title={title}
      toggleRef={anchorRef}
      anchor={
        <button
          ref={anchorRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={title}
          onClick={() => {
            setOpen(!open)
          }}
          className={cn(titleButton, className)}
        >
          {children}
          <ChevronDown className="size-5 shrink-0 text-ink-muted" strokeWidth={2.5} aria-hidden />
        </button>
      }
    >
      <MonthGrid
        value={value}
        min={min}
        max={max}
        onClose={() => {
          setOpen(false)
        }}
        onSelect={(m) => {
          onSelect(m)
          setOpen(false)
        }}
      />
    </PickerPopup>
  )
}

function MonthGrid({
  value,
  min,
  max,
  onSelect,
  onClose,
}: {
  value: string
  min?: string
  max?: string
  onSelect: (month: string) => void
  onClose: () => void
}) {
  const current = useTodayIso().slice(0, 7)
  const [year, setYear] = useState(Number(value.slice(0, 4)))
  const yearId = useId()
  const ok = (m: string) => (!min || m >= min) && (!max || m <= max)
  const monthOf = (y: number, i: number) => `${y}-${String(i + 1).padStart(2, '0')}`
  const nav =
    'flex size-11 items-center justify-center rounded-xl text-ink disabled:opacity-30 min-[900px]:size-10'
  return (
    <div className="flex w-[300px] max-w-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Предыдущий год"
          className={nav}
          disabled={!!min && monthOf(year - 1, 11) < min}
          onClick={() => {
            setYear(year - 1)
          }}
        >
          <ChevronLeft className="size-[18px]" strokeWidth={2.5} aria-hidden />
        </button>
        <span id={yearId} className="font-display text-[17px] font-bold">
          {year}
        </span>
        <button
          type="button"
          aria-label="Следующий год"
          className={nav}
          disabled={!!max && monthOf(year + 1, 0) > max}
          onClick={() => {
            setYear(year + 1)
          }}
        >
          <ChevronRight className="size-[18px]" strokeWidth={2.5} aria-hidden />
        </button>
      </div>
      <div role="group" aria-labelledby={yearId} className="grid grid-cols-3 gap-1.5">
        {MONTHS_NOM.map((name, i) => {
          const m = monthOf(year, i)
          const on = m === value
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              disabled={!ok(m)}
              onClick={() => {
                onSelect(m)
              }}
              className={cn(
                'min-h-11 rounded-xl px-1 text-[13px] whitespace-nowrap disabled:text-line-strong',
                on
                  ? 'bg-ink font-extrabold text-brand'
                  : m === current
                    ? 'bg-accent font-extrabold text-ink'
                    : 'font-bold text-ink',
              )}
            >
              {name}
            </button>
          )
        })}
      </div>
      <div className="flex justify-between gap-2 border-t border-line pt-2">
        <button
          type="button"
          className={footerButton}
          disabled={!ok(current)}
          onClick={() => {
            onSelect(current)
          }}
        >
          Этот месяц
        </button>
        <button type="button" className={cn(footerButton, 'border-0')} onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  )
}
