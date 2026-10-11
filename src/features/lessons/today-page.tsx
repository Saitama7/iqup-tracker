// У2 «Сегодня» (docs/design/Main.dc.html) and УД1 (docs/design/TeacherToday.dc.html).
// Everything time-dependent is a pure function of (lessons, now); now = useNow() (§7.1).
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { PageHeader } from '@/components/page'
import { firstName, useDisplayName } from '@/components/shell/shell-parts'
import { useSession } from '@/lib/auth'
import { useNow } from '@/lib/now'
import { bishkekDate, formatDayLong, formatMonthNom, formatWeekdayLower } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { myTeacherQuery, useLessonsRealtime, useTodayLessons, type TeacherLesson } from './api'
import { CurrentLessonCard, Deck } from './deck'
import { lessonTitle, pastLessonWhen, rowCaption, StatusChip, UnconfirmedBanner } from './parts'
import {
  countsCaption,
  dayCounts,
  deckOrder,
  lessonState,
  lessonStartMs,
  lessonsWord,
  splitDays,
  UNCONFIRMED_SHOWN,
  unconfirmedChip,
  unconfirmedInMonth,
  unconfirmedTitle,
  type DaySplit,
  type Unconfirmed,
} from './select'

export function TodayPage() {
  const now = useNow()
  const { userId } = useSession()
  const isDesktop = useIsDesktop()
  const date = bishkekDate(now)
  const name = firstName(useDisplayName())

  const teacher = useQuery(myTeacherQuery(userId))
  useLessonsRealtime(teacher.data)
  const lessons = useTodayLessons(teacher.data?.id, date)

  const eyebrow = formatDayLong(now)
  const title = name ? `Сегодня, ${name}` : 'Сегодня'

  let body: ReactNode
  if (teacher.isError || lessons.isError) {
    body = <Notice>Не удалось загрузить занятия. Проверьте интернет — обновим сами.</Notice>
  } else if (teacher.data === null) {
    body = <Notice>Вы ещё не привязаны к карточке учителя — обратитесь к администратору.</Notice>
  } else if (!lessons.data) {
    body = <Notice>Загружаем занятия…</Notice>
  } else {
    const days = splitDays(lessons.data, date)
    const unconfirmed = unconfirmedInMonth(lessons.data, now)
    body = isDesktop ? (
      <DesktopToday days={days} unconfirmed={unconfirmed} today={date} now={now} />
    ) : (
      <MobileToday days={days} unconfirmed={unconfirmed} today={date} now={now} />
    )
  }

  if (isDesktop) {
    const missed = lessons.data ? unconfirmedInMonth(lessons.data, now) : null
    return (
      <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeader eyebrow={eyebrow} title={title} />
          {missed && missed.lessons.length > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-burned-soft px-3.5 py-2.5 text-[13px] font-extrabold whitespace-nowrap text-burned-deep">
              <AlertCircle className="size-4 text-burned-strong" strokeWidth={2.5} aria-hidden />
              {unconfirmedChip(missed)}
            </span>
          )}
        </div>
        {body}
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-[22px]">
      <PageHeader eyebrow={eyebrow} title={title} />
      {body}
    </section>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[18px] border border-dashed border-line-strong bg-card p-5 text-sm font-bold text-ink-muted">
      {children}
    </p>
  )
}

const deckHeading = (top: TeacherLesson | undefined, now: number) => {
  if (!top) return 'Сегодня'
  const state = lessonState(top, now)
  if (state === 'current') return 'Идёт сейчас'
  if (state === 'upcoming') return 'Следующее'
  return 'Ждёт отметки'
}

// ─── У2 · phone ─────────────────────────────────────────────────────────────

interface DayProps {
  days: DaySplit<TeacherLesson>
  unconfirmed: Unconfirmed<TeacherLesson>
  today: string
  now: number
}

function MobileToday({ days, unconfirmed, today, now }: DayProps) {
  const deck = deckOrder(days.today, now)
  const counts = dayCounts(days.today)

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold">{deckHeading(deck[0], now)}</h2>
          {counts.total > 0 && (
            <p className="text-xs font-bold text-ink-muted">{countsCaption(counts)}</p>
          )}
        </div>
        {deck.length > 0 ? (
          <Deck lessons={deck} now={now} />
        ) : (
          <Notice>
            {counts.total > 0 ? 'Все занятия на сегодня проведены.' : 'Сегодня занятий нет.'}
          </Notice>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {days.today.length > 0 && (
          <>
            <h2 className="text-sm font-extrabold">Расписание на сегодня</h2>
            <ul aria-label="Расписание на сегодня" className="flex flex-col gap-2.5">
              {days.today.map((l) => (
                <li key={l.id}>
                  <DayRow lesson={l} now={now} />
                </li>
              ))}
            </ul>
          </>
        )}

        {unconfirmed.lessons.length > 0 && (
          <UnconfirmedBanner unconfirmed={unconfirmed} today={today} />
        )}

        {days.tomorrow.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3 pt-1.5">
              <h2 className="text-sm font-extrabold">
                Завтра, {formatWeekdayLower(lessonStartMs(days.tomorrow[0] as TeacherLesson))}
              </h2>
              <p className="text-xs font-bold text-ink-muted">
                {lessonsWord(days.tomorrow.length)}
              </p>
            </div>
            <ul aria-label="Завтра" className="flex flex-col gap-2.5">
              {days.tomorrow.map((l) => (
                <li key={l.id}>
                  <DayRow lesson={l} now={now} tomorrow />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

function DayRow({
  lesson,
  now,
  tomorrow = false,
}: {
  lesson: TeacherLesson
  now: number
  tomorrow?: boolean
}) {
  const state = lessonState(lesson, now)
  const cancelled = state === 'cancelled'
  const inner = (
    <>
      <span className="flex min-w-11 flex-col items-center">
        <span className="font-display text-[15px] font-bold">
          {lesson.planned_start.slice(0, 5)}
        </span>
        <span className="text-[11px] font-bold text-ink-muted">{lesson.duration_min} мин</span>
      </span>
      <span className="h-8 w-px bg-line" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-[15px] font-extrabold', cancelled && 'line-through')}>
          {lessonTitle(lesson)}
        </span>
        <span className="text-xs font-bold text-ink-muted">{rowCaption(lesson)}</span>
      </span>
      {!tomorrow && <StatusChip lesson={lesson} now={now} />}
    </>
  )
  const className = cn(
    'flex items-center gap-3.5 rounded-[18px] bg-card',
    state === 'current'
      ? 'border-2 border-brand px-[15px] py-[11px]'
      : 'border border-line px-4 py-3',
    cancelled && 'opacity-70',
  )
  if (cancelled) return <div className={className}>{inner}</div>
  return (
    <Link to="/lessons/$lessonId" params={{ lessonId: lesson.id }} className={className}>
      {inner}
    </Link>
  )
}

// ─── УД1 · desktop ──────────────────────────────────────────────────────────

function DesktopToday({ days, unconfirmed, today, now }: DayProps) {
  const deck = deckOrder(days.today, now)
  const counts = dayCounts(days.today)
  const top = deck[0]

  return (
    <>
      <div className="grid grid-cols-2 gap-6">
        {top ? (
          <CurrentLessonCard lesson={top} now={now} />
        ) : (
          <Notice>
            {counts.total > 0 ? 'Все занятия на сегодня проведены.' : 'Сегодня занятий нет.'}
          </Notice>
        )}
        <MonthCard now={now} />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold">Расписание на сегодня</h2>
          {counts.total > 0 && (
            <p className="text-[13px] font-bold text-ink-muted">
              {lessonsWord(counts.total)} · {counts.held} проведено
            </p>
          )}
        </div>
        {days.today.length > 0 ? (
          <ul
            aria-label="Расписание на сегодня"
            className="flex flex-col overflow-hidden rounded-[20px] border border-line bg-card"
          >
            {days.today.map((l) => (
              <DesktopRow key={l.id} lesson={l} now={now} />
            ))}
          </ul>
        ) : (
          <Notice>Сегодня занятий нет.</Notice>
        )}
      </section>

      {unconfirmed.lessons.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold">Требует внимания</h2>
            <p className="text-[13px] font-bold text-ink-muted">{unconfirmedTitle(unconfirmed)}</p>
          </div>
          <ul className="grid grid-cols-3 gap-3.5">
            {unconfirmed.lessons.slice(0, UNCONFIRMED_SHOWN).map((l) => (
              <li key={l.id}>
                <Link
                  to="/lessons/$lessonId"
                  params={{ lessonId: l.id }}
                  className="flex h-full flex-col gap-1.5 rounded-2xl bg-burned-soft p-4 text-burned-deep"
                >
                  <span className="text-xs font-extrabold tracking-[0.04em] uppercase">
                    Не подтверждено
                  </span>
                  <span className="text-sm font-extrabold">
                    {pastLessonWhen(l, today)} · {lessonTitle(l)}
                  </span>
                  <span className="text-xs font-bold">Не входит в ЗП, пока не отмечено</span>
                </Link>
              </li>
            ))}
          </ul>
          {unconfirmed.lessons.length > UNCONFIRMED_SHOWN && (
            <p className="text-[13px] font-bold text-ink-muted">
              ещё {unconfirmed.lessons.length - UNCONFIRMED_SHOWN}
            </p>
          )}
        </section>
      )}
    </>
  )
}

function MonthCard({ now }: { now: number }) {
  // Sum and counts come with R1-8 (payroll); until then — «—».
  const stats = [
    ['—', 'занятий'],
    ['—', 'ученико-уроков'],
    ['—', 'аванс'],
  ] as const
  return (
    <div className="flex min-h-[260px] flex-col justify-between gap-[18px] rounded-[24px] bg-ink p-[26px] text-paper">
      <div className="flex items-center justify-between">
        <span className="text-xs font-extrabold tracking-[0.06em] text-brand uppercase">
          {formatMonthNom(now)} · предварительно
        </span>
        <Link to="/my-month" className="text-[13px] font-extrabold text-brand">
          Подробнее →
        </Link>
      </div>
      <p className="font-display text-[40px] leading-none font-extrabold text-brand">
        — <span className="text-lg font-medium text-paper">сом</span>
      </p>
      <div className="grid grid-cols-3 gap-2.5">
        {stats.map(([value, label]) => (
          <div key={label} className="flex flex-col gap-0.5 rounded-[14px] bg-paper/8 p-3">
            <span className="font-display text-xl font-bold">{value}</span>
            <span className="text-[11px] font-bold opacity-65">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DesktopRow({ lesson, now }: { lesson: TeacherLesson; now: number }) {
  const state = lessonState(lesson, now)
  const toMark = state === 'current' || state === 'ended_unconfirmed'
  const lessonsCount =
    state === 'held'
      ? `${lesson.marks.present + lesson.marks.burned} ученико-уроков`
      : state === 'cancelled'
        ? ''
        : `до ${lesson.students} ученико-уроков`
  return (
    <li
      className={cn(
        'flex items-center gap-[18px] border-b border-line px-5 py-4 last:border-b-0',
        state === 'current' && 'bg-accent',
        state === 'cancelled' && 'opacity-70',
      )}
    >
      <span className="min-w-16 font-display text-base font-bold">
        {lesson.planned_start.slice(0, 5)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-[15px] font-extrabold', state === 'cancelled' && 'line-through')}>
          {lessonTitle(lesson)}
        </span>
        <span className="text-[13px] font-bold text-ink-muted">
          {rowCaption(lesson, { desktop: true })}
        </span>
      </span>
      <span className="text-[13px] font-bold whitespace-nowrap text-ink-muted">{lessonsCount}</span>
      {toMark ? (
        <span className="flex items-center gap-2">
          {state === 'ended_unconfirmed' && <StatusChip lesson={lesson} now={now} />}
          <Link
            to="/lessons/$lessonId"
            params={{ lessonId: lesson.id }}
            className="inline-flex min-h-9 items-center rounded-full bg-ink px-3.5 text-xs font-extrabold whitespace-nowrap text-brand"
          >
            Отметить →
          </Link>
        </span>
      ) : (
        <StatusChip lesson={lesson} now={now} />
      )}
    </li>
  )
}
