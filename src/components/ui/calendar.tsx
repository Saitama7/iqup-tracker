import * as React from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import { ru } from 'react-day-picker/locale'
import { cn } from '@/lib/utils'

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Month grid (react-day-picker): Russian locale, week from Monday, month/year dropdowns in the
 * caption. Native <select> under the caption label — on iOS it opens the system wheel.
 * Day cells are 44 px on the phone, 40 px in the desktop popover.
 */
function Calendar({ className, classNames, ...props }: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      locale={ru}
      weekStartsOn={1}
      captionLayout="dropdown"
      showOutsideDays
      formatters={{
        formatMonthDropdown: (month) =>
          capitalize(month.toLocaleString('ru-RU', { month: 'long' })),
      }}
      className={cn('w-fit select-none', className)}
      classNames={{
        months: 'relative flex flex-col',
        month: 'flex w-full flex-col gap-3',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous:
          'flex size-11 items-center justify-center rounded-xl text-ink disabled:opacity-30 min-[900px]:size-10',
        button_next:
          'flex size-11 items-center justify-center rounded-xl text-ink disabled:opacity-30 min-[900px]:size-10',
        month_caption: 'flex h-11 items-center justify-center px-12 min-[900px]:h-10',
        dropdowns: 'flex items-center gap-1.5',
        dropdown_root:
          'relative flex min-h-10 items-center rounded-xl border-[1.5px] border-line-strong bg-card has-focus:border-ink',
        dropdown: 'absolute inset-0 cursor-pointer text-base opacity-0',
        caption_label:
          'flex items-center gap-1 px-2.5 text-[15px] font-extrabold whitespace-nowrap text-ink',
        chevron: 'size-4 text-ink-muted',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'flex h-8 w-11 items-center justify-center text-[11px] font-extrabold text-ink-muted uppercase min-[900px]:w-10',
        week: 'mt-1 flex w-full',
        day: 'p-0 text-center',
        day_button:
          'flex size-11 items-center justify-center rounded-xl text-[15px] font-bold text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-default min-[900px]:size-10',
        today: '[&>button]:bg-accent [&>button]:font-extrabold',
        selected: '[&>button]:bg-ink [&>button]:font-extrabold [&>button]:text-brand',
        outside: '[&>button]:text-sand',
        disabled: '[&>button]:text-line-strong [&>button]:line-through',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) => {
          const Icon =
            orientation === 'left'
              ? ChevronLeft
              : orientation === 'right'
                ? ChevronRight
                : ChevronDown
          return <Icon className={cn('size-[18px]', chevronClass)} strokeWidth={2.5} aria-hidden />
        },
      }}
      {...props}
    />
  )
}

export { Calendar }
