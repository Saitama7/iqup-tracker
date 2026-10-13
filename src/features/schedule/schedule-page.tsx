// А2 Расписание (docs/design/AdminSchedule.dc.html). Desktop: week × hour grid; phone: one day of
// the week with arrows / swipe. Card colours are lessonState(now) — the same rule as «Сегодня».
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { PageHeader, PageTitle } from '@/components/page'
import { DatePickerButton } from '@/components/ui/date-picker'
import { addDays } from '@/features/groups/model'
import { Segmented } from '@/features/groups/parts'
import { firstName } from '@/features/students/model'
import { trialsQuery, useTrialsRealtime } from '@/features/trials/api'
import { trialsByLesson, type Trial } from '@/features/trials/model'
import { useNow } from '@/lib/now'
import { bishkekDate, formatDayLong } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import {
  adminLessonsQuery,
  adminUnconfirmedQuery,
  useAdminLessonsRealtime,
  useTeacherOptions,
  type AdminLesson,
} from './api'
import {
  adminUnconfirmed,
  dayHeader,
  filterLessons,
  hourRows,
  inHour,
  isUnconfirmed,
  otherWeeks,
  sortByStart,
  weekDays,
  weekStart,
  weekTitle,
} from './model'
import { Legend, LessonCard, Notice } from './parts'

export interface ScheduleSearch {
  /** Any day of the week shown (phone: the day shown); none — today. */
  date?: string
  teacher?: string
  filter?: 'unconfirmed'
}

const ALL = 'all'

const navButton =
  'flex size-11 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-card text-ink'

export function SchedulePage({
  search,
  onSearchChange,
}: {
  search: ScheduleSearch
  onSearchChange: (next: ScheduleSearch) => void
}) {
  const now = useNow()
  const isDesktop = useIsDesktop()
  const today = bishkekDate(now)
  const date = search.date ?? today
  const monday = weekStart(date)
  const sunday = addDays(monday, 6)
  const unconfirmedOnly = search.filter === 'unconfirmed'

  useAdminLessonsRealtime()
  useTrialsRealtime()
  const week = useQuery(adminLessonsQuery(monday, sunday))
  const trials = useQuery(trialsQuery({ from: monday, to: sunday }))
  const byLesson = trialsByLesson(trials.data ?? [])
  const pending = useQuery({ ...adminUnconfirmedQuery(today), enabled: unconfirmedOnly })
  const teachers = useTeacherOptions()

  const set = (patch: Partial<ScheduleSearch>) => {
    const next = { ...search, ...patch }
    onSearchChange({
      date: next.date === today ? undefined : next.date,
      teacher: next.teacher,
      filter: next.filter,
    })
  }
  const filter = { teacher: search.teacher, unconfirmed: unconfirmedOnly }

  const teacherOptions = [
    { value: ALL, label: 'Все учителя' },
    ...(teachers.data ?? []).map((t) => ({ value: t.id, label: firstName(t.name) })),
  ]
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Учитель"
        options={teacherOptions}
        value={search.teacher ?? ALL}
        onChange={(v) => {
          set({ teacher: v === ALL ? undefined : v })
        }}
        className={cn('max-w-full overflow-x-auto', !isDesktop && 'w-full')}
      />
      <button
        type="button"
        aria-pressed={unconfirmedOnly}
        onClick={() => {
          set({ filter: unconfirmedOnly ? undefined : 'unconfirmed' })
        }}
        className={cn(
          'min-h-11 rounded-xl px-4 text-[13px] font-extrabold whitespace-nowrap',
          unconfirmedOnly
            ? 'bg-burned-soft text-burned-deep'
            : 'border-[1.5px] border-line-strong bg-card text-ink-muted',
        )}
      >
        Не подтверждено
      </button>
    </div>
  )

  // Unconfirmed lessons in other weeks of the month, with the filter on (dashboard «ещё N»).
  const elsewhere =
    unconfirmedOnly && pending.data
      ? otherWeeks(filterLessons(adminUnconfirmed(pending.data, now), filter, now), monday)
      : []
  const weeksStrip = elsewhere.length > 0 && (
    <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-burned-deep">
      <span>Не подтверждено в другие недели:</span>
      {elsewhere.map((w) => (
        <button
          key={w.monday}
          type="button"
          onClick={() => {
            set({ date: w.monday })
          }}
          className="min-h-9 rounded-full bg-burned-soft px-3 font-extrabold whitespace-nowrap"
        >
          {weekTitle(weekDays(w.monday, []))} · {w.count}
        </button>
      ))}
    </div>
  )

  let body: ReactNode
  if (week.isError) {
    body = <Notice>Не удалось загрузить расписание. Проверьте интернет — обновим сами.</Notice>
  } else if (!week.data) {
    body = <Notice>Загружаем расписание…</Notice>
  } else {
    const lessons = sortByStart(filterLessons(week.data, filter, now))
    const days = weekDays(monday, week.data)
    const empty = unconfirmedOnly
      ? 'На этой неделе всё подтверждено.'
      : 'На этой неделе занятий нет.'
    body = isDesktop ? (
      lessons.length === 0 ? (
        <Notice>{empty}</Notice>
      ) : (
        <WeekGrid lessons={lessons} days={days} today={today} now={now} byLesson={byLesson} />
      )
    ) : (
      <DayList
        lessons={lessons.filter((l) => l.lesson_date === date)}
        days={days}
        date={date}
        today={today}
        now={now}
        byLesson={byLesson}
        onDate={(d) => {
          set({ date: d })
        }}
        empty={unconfirmedOnly ? 'В этот день всё подтверждено.' : 'В этот день занятий нет.'}
      />
    )
  }

  const step = isDesktop ? 7 : 1
  const prevLabel = isDesktop ? 'Предыдущая неделя' : 'Предыдущий день'
  const nextLabel = isDesktop ? 'Следующая неделя' : 'Следующий день'
  const isCurrent = isDesktop ? monday === weekStart(today) : date === today
  const nav = (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label={prevLabel}
        className={navButton}
        onClick={() => {
          set({ date: addDays(date, -step) })
        }}
      >
        <ChevronLeft className="size-[18px]" strokeWidth={2.5} aria-hidden />
      </button>
      {isDesktop ? (
        <PageTitle className="min-[900px]:text-[26px]">
          <DatePickerButton
            value={date}
            title="Перейти к неделе"
            week
            onSelect={(d) => {
              set({ date: d })
            }}
          >
            {weekTitle(weekDays(monday, week.data ?? []))}
          </DatePickerButton>
        </PageTitle>
      ) : null}
      <button
        type="button"
        aria-label={nextLabel}
        className={navButton}
        onClick={() => {
          set({ date: addDays(date, step) })
        }}
      >
        <ChevronRight className="size-[18px]" strokeWidth={2.5} aria-hidden />
      </button>
      {!isCurrent && (
        <button
          type="button"
          onClick={() => {
            set({ date: today })
          }}
          className="min-h-11 rounded-xl border-[1.5px] border-line-strong bg-card px-4 text-[13px] font-extrabold"
        >
          Сегодня
        </button>
      )}
    </div>
  )

  if (isDesktop) {
    return (
      <section className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-extrabold tracking-[0.06em] text-ink-muted uppercase">
              Расписание
            </p>
            {nav}
          </div>
          {controls}
        </header>
        <Legend />
        {weeksStrip}
        {body}
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Расписание"
        title={
          <DatePickerButton
            value={date}
            title="Перейти к дню"
            onSelect={(d) => {
              set({ date: d })
            }}
          >
            {formatDayLong(Date.parse(`${date}T12:00:00+06:00`))}
          </DatePickerButton>
        }
      />
      {nav}
      {controls}
      {weeksStrip}
      {body}
      <Legend />
    </section>
  )
}

// ─── Desktop: week × hour ───────────────────────────────────────────────────

function WeekGrid({
  lessons,
  days,
  today,
  now,
  byLesson,
}: {
  lessons: AdminLesson[]
  days: string[]
  today: string
  now: number
  byLesson: Map<string, Trial[]>
}) {
  const cols = { gridTemplateColumns: `64px repeat(${days.length}, minmax(0, 1fr))` }
  return (
    <div className="overflow-x-auto rounded-[20px] border border-line bg-card">
      {/* Grid rows, not <table>: WebKit drops table semantics once rows are display: grid. */}
      <div role="table" aria-label="Расписание недели" className="min-w-[980px]">
        <div role="row" className="grid border-b border-line" style={cols}>
          <span role="columnheader" aria-label="Время" />
          {days.map((d) => (
            <span
              key={d}
              role="columnheader"
              className={cn(
                'px-2.5 py-3 text-center text-xs font-extrabold',
                d === today ? 'rounded-t-[10px] bg-accent text-ink' : 'text-ink-muted',
              )}
            >
              {dayHeader(d, today)}
            </span>
          ))}
        </div>
        {hourRows(lessons).map((hour) => (
          <div
            key={hour}
            role="row"
            className="grid border-b border-line last:border-b-0"
            style={cols}
          >
            <span role="rowheader" className="p-2.5 font-display text-xs font-bold text-ink-muted">
              {hour}
            </span>
            {days.map((d) => (
              <div
                key={d}
                role="cell"
                className={cn('flex flex-col gap-1 p-1.5', d === today && 'bg-today-col')}
              >
                {lessons
                  .filter((l) => l.lesson_date === d && inHour(l, hour))
                  .map((l) => (
                    <LessonCard key={l.id} lesson={l} now={now} trials={byLesson.get(l.id)} />
                  ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Phone: one day ─────────────────────────────────────────────────────────

const SWIPE_PX = 60

function DayList({
  lessons,
  days,
  date,
  today,
  now,
  byLesson,
  onDate,
  empty,
}: {
  lessons: AdminLesson[]
  days: string[]
  date: string
  today: string
  now: number
  byLesson: Map<string, Trial[]>
  onDate: (date: string) => void
  empty: string
}) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="День недели" className="flex gap-1.5 overflow-x-auto">
        {days.map((d) => {
          const on = d === date
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onDate(d)
              }}
              className={cn(
                'min-h-11 flex-1 rounded-xl px-2 text-xs whitespace-nowrap',
                on
                  ? 'bg-ink font-extrabold text-brand'
                  : d === today
                    ? 'bg-accent font-extrabold'
                    : 'border border-line bg-card font-bold text-ink-muted',
              )}
            >
              {dayHeader(d, '').replace(' · сегодня', '')}
            </button>
          )
        })}
      </div>
      <div
        aria-label="Занятия дня"
        className="flex touch-pan-y flex-col gap-2"
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const s = start.current
          start.current = null
          if (!s) return
          const dx = e.clientX - s.x
          if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(e.clientY - s.y)) return
          onDate(addDays(date, dx < 0 ? 1 : -1))
        }}
      >
        {lessons.length === 0 ? (
          <Notice>{empty}</Notice>
        ) : (
          <ul aria-label="Расписание дня" className="flex flex-col gap-2">
            {lessons.map((l) => (
              <li key={l.id} className="flex items-start gap-3">
                <span
                  className={cn(
                    'w-[52px] shrink-0 pt-2 font-display text-sm font-bold',
                    isUnconfirmed(l, now) && 'text-burned-deep',
                  )}
                >
                  {l.planned_start.slice(0, 5)}
                </span>
                <div className="min-w-0 flex-1 [&>a]:min-h-11 [&>a]:text-sm">
                  <LessonCard lesson={l} now={now} trials={byLesson.get(l.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
