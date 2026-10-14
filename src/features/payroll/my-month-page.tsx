// У6 «Мой месяц» (docs/design/MyMonth.dc.html) and УД4 (docs/design/TeacherMonthDesk.dc.html).
// Sums — payroll/calc.ts over the month's lessons; everything time-dependent is a pure function of
// (rows, now), now = useNow() (§7.1). Advances — payroll_adjustments (#83): «К выплате» = начислено − авансы.
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { MonthPickerButton } from '@/components/ui/date-picker'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useSession } from '@/lib/auth'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { fromMyMonth, NEXT_UNCONFIRMED_ID, type LessonSearch } from '@/features/lessons/return-to'
import { lessonsWord } from '@/features/lessons/select'
import { formatSom } from '@/features/tariffs/model'
import { formatDayMonth } from '@/lib/time'
import { myMonthQuery, usePayrollRealtime } from './api'
import {
  adjustmentCaption,
  filterMonthLessons,
  minusSom,
  formulaNote,
  groupCaption,
  hoursCaption,
  inMonthPrep,
  monthNom,
  monthOf,
  monthTitle,
  myMonthView,
  nextUnconfirmed,
  noSubscriptionCaption,
  payday,
  periodCaption,
  PRELIMINARY_NOTE,
  shiftMonth,
  toPayCaption,
  visibleLessons,
  type MonthLessonLine,
  type MonthLessonsFilter,
  type MyMonthView,
} from './model'
import { CountUp, TiltCard } from './pay-card'

/** Empty lesson list with a group picked in the filter (#76). */
const EMPTY_GROUP = 'В этой группе проведённых занятий за месяц нет.'

/** УД4 shows this many lessons, the rest behind «ещё N занятий» (unconfirmed ones always shown). */
const LESSONS_SHOWN = 7

interface Props {
  month: string
  /** Group filter of the lesson lists (?group=, #72); undefined — all groups. */
  group: string | undefined
}

export function MyMonthPage({ month, group }: Props) {
  const now = useNow()
  const { userId } = useSession()
  const isDesktop = useIsDesktop()
  const today = bishkekDate(now)

  usePayrollRealtime()
  const source = useQuery(myMonthQuery(userId, month))
  const view = source.data ? myMonthView(source.data, month, now) : null
  const filter = view ? filterMonthLessons(view, group) : null
  useScrollToNextUnconfirmed(filter ? nextUnconfirmed(filter.unconfirmed) : null, isDesktop)

  let body: ReactNode
  if (source.isError) {
    body = <Notice>Не удалось загрузить месяц. Проверьте интернет — обновим сами.</Notice>
  } else if (source.data === null) {
    body = <Notice>Вы ещё не привязаны к карточке учителя — обратитесь к администратору.</Notice>
  } else if (!view || !filter) {
    body = <Notice>Считаем месяц…</Notice>
  } else {
    body = isDesktop ? (
      <DesktopMonth view={view} filter={filter} month={month} />
    ) : (
      <MobileMonth view={view} filter={filter} month={month} today={today} />
    )
  }

  return (
    <section className="flex flex-col gap-[18px] min-[900px]:gap-6">
      <Header month={month} group={group} today={today} desktop={isDesktop} />
      {body}
    </section>
  )
}

/**
 * Back from a lesson (#unconfirmed, #72): the next unconfirmed lesson — the oldest one left — is
 * scrolled into view and its «Подтвердить →» focused (#76). Runs again when the refetch after the
 * confirm moves the anchor from the lesson just confirmed to the next one.
 */
function useScrollToNextUnconfirmed(anchor: string | null, isDesktop: boolean) {
  const hash = useLocation({ select: (l) => l.hash })
  useEffect(() => {
    if (hash !== NEXT_UNCONFIRMED_ID || !anchor) return
    const row = document.getElementById(NEXT_UNCONFIRMED_ID)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    row.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true })
  }, [hash, anchor, isDesktop])
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[18px] border border-dashed border-line-strong bg-card p-5 text-sm font-bold text-ink-muted">
      {children}
    </p>
  )
}

// ─── Header and month switch ────────────────────────────────────────────────

function Header({
  month,
  group,
  today,
  desktop,
}: {
  month: string
  group: string | undefined
  today: string
  desktop: boolean
}) {
  const navigate = useNavigate()
  const prev = shiftMonth(month, -1)
  const next = month < monthOf(today) ? shiftMonth(month, 1) : null
  const pill = desktop
    ? 'flex min-h-11 items-center gap-1.5 rounded-xl border-[1.5px] border-line-strong bg-card px-4 text-[13px] font-extrabold whitespace-nowrap text-ink'
    : 'flex h-11 items-center gap-1.5 rounded-full border border-line bg-card px-3.5 text-[13px] font-extrabold whitespace-nowrap text-ink'
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1 min-[900px]:gap-1.5">
        <p className="text-[13px] font-bold tracking-[0.04em] text-ink-muted uppercase min-[900px]:text-xs min-[900px]:font-extrabold min-[900px]:tracking-[0.06em]">
          Мой месяц
        </p>
        <div className="flex flex-wrap items-center gap-3.5">
          <h1 className="font-display text-[26px] leading-[1.1] font-bold text-ink min-[900px]:text-[30px]">
            <MonthPickerButton
              value={month}
              max={monthOf(today)}
              onSelect={(m) => {
                void navigate({ to: '/my-month', search: { month: m, group } })
              }}
            >
              {desktop ? monthTitle(month) : monthNom(month)}
            </MonthPickerButton>
          </h1>
          {desktop && (
            <span className="rounded-full bg-warn-soft px-3 py-1.5 text-xs font-extrabold whitespace-nowrap text-warn-strong">
              {periodCaption(month, today)}
            </span>
          )}
        </div>
      </div>
      <nav className="flex gap-1.5 min-[900px]:gap-2" aria-label="Месяц">
        <Link to="/my-month" search={{ month: prev, group }} className={pill}>
          <ChevronLeft className="size-4" strokeWidth={2.5} aria-hidden />
          {monthNom(prev)}
        </Link>
        {next && (
          <Link to="/my-month" search={{ month: next, group }} className={pill}>
            {monthNom(next)}
            <ChevronRight className="size-4" strokeWidth={2.5} aria-hidden />
          </Link>
        )}
      </nav>
    </header>
  )
}

// ─── Group filter (#72) ─────────────────────────────────────────────────────

/**
 * «Все группы / 8 класс А / …» over the lesson lists; the choice lives in the URL (?group=) so it
 * survives reload and the return from a lesson. The badge — lessons over but not confirmed.
 */
function GroupFilter({
  view,
  month,
  active,
}: {
  view: MyMonthView
  month: string
  active: string | null
}) {
  const navigate = useNavigate()
  if (view.groups.length < 2) return null
  const pick = (group: string | undefined) => {
    void navigate({ to: '/my-month', search: { month, group }, replace: true })
  }
  const chip = (on: boolean) =>
    cn(
      'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-extrabold whitespace-nowrap',
      on ? 'border-ink bg-ink text-paper' : 'border-line bg-card text-ink',
    )
  return (
    <div
      role="group"
      aria-label="Фильтр по группам"
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 min-[900px]:flex-wrap"
    >
      <button
        type="button"
        aria-pressed={active === null}
        onClick={() => {
          pick(undefined)
        }}
        className={chip(active === null)}
      >
        Все группы
      </button>
      {view.groups.map((g) => (
        <button
          key={g.id}
          type="button"
          title={g.label}
          aria-pressed={active === g.id}
          onClick={() => {
            pick(g.id)
          }}
          className={chip(active === g.id)}
        >
          {g.name}
          {g.unconfirmed > 0 && (
            <span
              className="rounded-full bg-burned-soft px-1.5 py-0.5 text-[11px] leading-none font-extrabold text-burned-strong"
              aria-label={`${g.unconfirmed} не подтверждено`}
            >
              {g.unconfirmed}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ─── У6 · phone ─────────────────────────────────────────────────────────────

function MobileMonth({
  view,
  filter,
  month,
  today,
}: {
  view: MyMonthView
  filter: MonthLessonsFilter
  month: string
  today: string
}) {
  const { pay } = view
  const [all, setAll] = useState(false)
  const held = filter.lessons.filter((l) => l.state === 'held')
  const shown = all ? held : held.slice(0, LESSONS_SHOWN)
  const more = held.length - shown.length
  const stats = [
    [String(pay.lessonsHeld), 'занятий'],
    [hoursCaption(pay.hours), 'часов'],
    [String(pay.studentLessons), 'ученико-уроков'],
  ] as const
  return (
    <>
      <TiltCard className="flex flex-col gap-3.5 rounded-[24px] bg-ink px-[22px] pt-5 pb-[18px] text-paper shadow-pay">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-extrabold tracking-[0.06em] text-brand uppercase">
            {periodCaption(month, today)}
          </span>
          <span className="text-xs font-bold whitespace-nowrap opacity-60">
            выплата {payday(month)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="font-display text-[38px] leading-none font-extrabold whitespace-nowrap text-brand">
            <CountUp value={pay.amount} />{' '}
            <span className="text-lg font-medium text-paper">сом</span>
          </p>
          <p className="text-[13px] font-bold opacity-70">
            начислено{view.percent !== null && ` · ваш процент ${view.percent} %`}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {stats.map(([value, label]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-[14px] bg-paper/8 p-2.5">
              <span className="font-display text-lg font-bold">{value}</span>
              <span className="text-[11px] font-bold opacity-65">{label}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 border-t border-paper/12 pt-3 text-[13px] font-bold">
          {view.adjustments.length === 0 ? (
            <div className="flex items-center justify-between">
              <span className="opacity-70">Аванс</span>
              <span className="text-brand">—</span>
            </div>
          ) : (
            view.adjustments.map((a) => (
              <div
                key={a.id}
                className="flex items-start justify-between gap-3"
                data-testid="my-advance"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="opacity-70">Аванс {formatDayMonth(a.issuedOn)}</span>
                  {a.comment && <span className="text-xs break-words opacity-55">{a.comment}</span>}
                </span>
                <span className="whitespace-nowrap text-brand">{minusSom(a.amount)}</span>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between text-[15px] font-extrabold">
          <span>К выплате сейчас</span>
          <ToPay value={view.toPay} className="font-display text-lg" />
        </div>
      </TiltCard>

      <section className="flex flex-col gap-2" aria-label="По группам">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold">По группам</h2>
          {view.share !== null && (
            <span className="text-xs font-bold text-ink-muted">
              {formatSom(view.share)} сом за ученико-урок
            </span>
          )}
        </div>
        {view.groups.length === 0 && (
          <p className="text-[13px] font-bold text-ink-muted">
            Проведённых занятий {inMonthPrep(month)} нет.
          </p>
        )}
        {view.groups.map((g) => (
          <Link
            key={g.id}
            to="/groups/$groupId"
            params={{ groupId: g.id }}
            className={cn(
              'flex flex-col gap-1.5 rounded-2xl border bg-card px-3.5 py-3 text-ink',
              g.unconfirmed > 0 ? 'border-burned-soft' : 'border-line',
            )}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm font-extrabold">{g.label}</span>
              <span className="font-display text-sm font-bold">{formatSom(g.amount)}</span>
            </span>
            <span
              className={cn(
                'text-xs font-bold',
                g.unconfirmed > 0 ? 'text-burned-strong' : 'text-ink-muted',
              )}
            >
              {groupCaption(g)}
            </span>
          </Link>
        ))}
      </section>

      <GroupFilter view={view} month={month} active={filter.group} />

      {filter.unconfirmed.length > 0 && (
        <UnconfirmedBlock lessons={filter.unconfirmed} month={month} group={filter.group} />
      )}

      {filter.group && filter.lessons.length === 0 && (
        <p className="text-[13px] font-bold text-ink-muted">{EMPTY_GROUP}</p>
      )}

      {held.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={`Занятия ${inMonthPrep(month)}`}>
          <h2 className="text-sm font-extrabold">Занятия {inMonthPrep(month)}</h2>
          <ul className="flex flex-col rounded-2xl border border-line bg-card px-3.5">
            {shown.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-extrabold">{l.group}</span>
                  <span className="text-xs font-bold text-ink-muted">
                    {l.when} · {l.marks}
                    {l.confirmed?.late && <span className="text-warn"> · поздно</span>}
                    {l.noSubscription > 0 && (
                      <span className="text-burned-strong">
                        {' · '}
                        {noSubscriptionCaption(l.noSubscription)}
                      </span>
                    )}
                  </span>
                </span>
                <span className="font-display text-sm font-bold whitespace-nowrap">
                  {formatSom(l.amount)}
                </span>
              </li>
            ))}
          </ul>
          {more > 0 && (
            <button
              type="button"
              onClick={() => {
                setAll(true)
              }}
              className="min-h-11 text-sm font-bold text-ink-muted"
            >
              ещё {lessonsWord(more)}
            </button>
          )}
          {view.roundingNote && (
            <p className="text-xs font-bold text-ink-muted">{view.roundingNote}</p>
          )}
        </section>
      )}

      <p className="text-xs font-bold text-ink-muted">{PRELIMINARY_NOTE}.</p>
    </>
  )
}

function UnconfirmedBlock({
  lessons,
  month,
  group,
}: {
  lessons: MonthLessonLine[]
  month: string
  group: string | null
}) {
  const anchor = nextUnconfirmed(lessons)
  return (
    <section
      className="flex flex-col gap-2 rounded-2xl bg-burned-soft px-4 py-3.5 text-burned-deep"
      aria-label="Не подтверждено — не в ЗП"
    >
      <h2 className="text-sm font-extrabold">Не подтверждено — не в ЗП</h2>
      <ul className="flex flex-col gap-1.5">
        {lessons.map((l) => (
          <li
            key={l.id}
            id={l.id === anchor ? NEXT_UNCONFIRMED_ID : undefined}
            className="flex scroll-mt-4 items-center justify-between gap-3 text-[13px] font-bold"
          >
            <span className="min-w-0">
              {l.when} · {l.group}
            </span>
            <Link
              to="/lessons/$lessonId"
              params={{ lessonId: l.id }}
              search={fromMyMonth(month, group ?? undefined)}
              className="font-extrabold whitespace-nowrap text-burned-strong"
            >
              Подтвердить →
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-xs font-bold opacity-80">
        Подтвердить можно до конца месяца — потом бухгалтер закроет период.
      </p>
    </section>
  )
}

// ─── УД4 · desktop ──────────────────────────────────────────────────────────

const card = 'rounded-[20px] border border-line bg-card'
const th =
  'px-3 py-3 text-left text-[11px] font-extrabold tracking-[0.06em] whitespace-nowrap text-ink-muted uppercase'
const td = 'border-b border-line px-3 py-3 align-middle text-sm'
const num = 'text-right tabular-nums whitespace-nowrap'
const kpiLabel = 'text-xs font-extrabold tracking-[0.06em] uppercase'

function DesktopMonth({
  view,
  filter,
  month,
}: {
  view: MyMonthView
  filter: MonthLessonsFilter
  month: string
}) {
  const { pay } = view
  const [all, setAll] = useState(false)
  const shown = all ? filter.lessons : visibleLessons(filter.lessons, LESSONS_SHOWN)
  const more = filter.lessons.length - shown.length
  const anchor = nextUnconfirmed(filter.unconfirmed)
  const lessonSearch = fromMyMonth(month, filter.group ?? undefined)
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] gap-3.5">
        <TiltCard className="flex h-full flex-col gap-2.5 rounded-[20px] bg-ink px-[22px] py-5 text-paper">
          <span className={cn(kpiLabel, 'text-brand')}>К выплате {payday(month)}</span>
          {view.toPay < 0 ? (
            <ToPay
              value={view.toPay}
              className="font-display text-[26px] leading-none font-extrabold"
            />
          ) : (
            <p className="font-display text-[34px] leading-none font-extrabold whitespace-nowrap text-brand">
              <CountUp value={view.toPay} />{' '}
              <span className="text-base font-medium text-paper">сом</span>
            </p>
          )}
          <span className="text-xs font-bold opacity-70" data-testid="my-month-accrued">
            начислено {formatSom(pay.amount)} · аванс{' '}
            {view.advances > 0 ? minusSom(view.advances) : '—'}
          </span>
        </TiltCard>
        <Kpi label="Занятий · часов">
          {pay.lessonsHeld} · {hoursCaption(pay.hours)}
        </Kpi>
        <Kpi label="Ученико-уроков">{pay.studentLessons}</Kpi>
        <div className="flex flex-col gap-1.5 rounded-[20px] bg-burned-soft px-[22px] py-5 text-burned-deep">
          <span className={kpiLabel}>Не подтверждено</span>
          <span className="font-display text-[28px] font-bold" data-testid="kpi-unconfirmed">
            {view.unconfirmed.length}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-5">
        <div className={cn(card, 'overflow-x-auto')}>
          <h2 className="px-5 pt-4 text-[15px] font-extrabold">Занятия {inMonthPrep(month)}</h2>
          <div className="px-5 pt-3">
            <GroupFilter view={view} month={month} active={filter.group} />
          </div>
          {filter.lessons.length === 0 ? (
            <p className="px-5 py-4 text-sm font-bold text-ink-muted">
              {filter.group ? EMPTY_GROUP : 'Проведённых занятий пока нет.'}
            </p>
          ) : (
            <table
              className="w-full min-w-[600px] border-collapse"
              aria-label={`Занятия ${inMonthPrep(month)}`}
            >
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>Дата</th>
                  <th className={th}>Группа</th>
                  <th className={th}>Отметка</th>
                  <th className={cn(th, 'text-right')}>Ученико-уроков</th>
                  <th className={cn(th, 'text-right')}>Сумма</th>
                  <th className={th}>Подтверждено</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <LessonRow key={l.id} lesson={l} search={lessonSearch} anchor={l.id === anchor} />
                ))}
                {more > 0 && (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <button
                        type="button"
                        onClick={() => {
                          setAll(true)
                        }}
                        className="min-h-11 w-full text-center text-sm font-bold text-ink-muted"
                      >
                        ещё {lessonsWord(more)}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {view.roundingNote && (
            <p className="border-t border-line px-5 py-3 text-xs font-bold text-ink-muted">
              {view.roundingNote}
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-3.5">
          <section
            className={cn(card, 'flex flex-col gap-3 px-5 py-[18px]')}
            aria-label="По группам"
          >
            <h2 className="text-sm font-extrabold">По группам</h2>
            {view.groups.map((g) => (
              <p key={g.id} className="flex justify-between gap-3 text-[13px] font-bold">
                <span>
                  {g.name} · {g.studentLessons} уч-ур
                </span>
                <span className="font-display">{formatSom(g.amount)}</span>
              </p>
            ))}
            <p className="flex justify-between border-t border-line pt-2.5 text-sm font-extrabold">
              <span>Итого</span>
              <span className="font-display">{formatSom(pay.amount)}</span>
            </p>
          </section>
          <section className={cn(card, 'flex flex-col gap-2.5 px-5 py-[18px]')}>
            <h2 className="text-sm font-extrabold">Авансы и корректировки</h2>
            {view.adjustments.length === 0 ? (
              <p className="text-[13px] font-bold text-ink-muted">Авансов за месяц нет</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {view.adjustments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start justify-between gap-3 text-[13px] font-bold"
                    data-testid="my-advance"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span>{adjustmentCaption(a)}</span>
                      {a.comment && (
                        <span className="text-xs break-words text-ink-muted">{a.comment}</span>
                      )}
                    </span>
                    <span className="font-display whitespace-nowrap">{minusSom(a.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="flex justify-between border-t border-line pt-2.5 text-sm font-extrabold">
              <span>К выплате {payday(month)}</span>
              <ToPay value={view.toPay} className="font-display" />
            </p>
          </section>
          <p className="rounded-2xl bg-stone px-4 py-3.5 text-xs leading-normal font-bold text-ink-muted">
            {formulaNote(view)}
          </p>
        </aside>
      </div>
    </>
  )
}

/** «К выплате»: below zero — «переплата N сом» in red (#83). */
function ToPay({ value, className }: { value: number; className?: string }) {
  const pay = toPayCaption(value)
  return (
    <span
      className={cn('whitespace-nowrap', pay.overpaid && 'text-burned', className)}
      data-testid="my-to-pay"
    >
      {pay.text}
    </span>
  )
}

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn(card, 'flex flex-col gap-1.5 px-[22px] py-5')}>
      <span className={cn(kpiLabel, 'text-ink-muted')}>{label}</span>
      <span className="font-display text-[28px] font-bold whitespace-nowrap">{children}</span>
    </div>
  )
}

function LessonRow({
  lesson: l,
  search,
  anchor,
}: {
  lesson: MonthLessonLine
  search: LessonSearch
  /** The oldest unconfirmed row — the return from a lesson scrolls here (#72, #76). */
  anchor: boolean
}) {
  const unconfirmed = l.state === 'unconfirmed'
  return (
    <tr
      id={anchor ? NEXT_UNCONFIRMED_ID : undefined}
      className={cn('scroll-mt-4 [&:last-child>td]:border-0', unconfirmed && 'bg-burned-soft/50')}
    >
      <td className={cn(td, 'whitespace-nowrap')}>{l.when}</td>
      <td className={cn(td, 'font-extrabold')}>{l.group}</td>
      <td className={cn(td, unconfirmed ? 'font-bold text-burned-strong' : 'text-ink-muted')}>
        {l.marks}
        {l.noSubscription > 0 && (
          <span className="font-bold whitespace-nowrap text-burned-strong">
            {' · '}
            {noSubscriptionCaption(l.noSubscription)}
          </span>
        )}
      </td>
      <td className={cn(td, num)}>{unconfirmed ? '—' : l.studentLessons}</td>
      <td className={cn(td, num, !unconfirmed && 'font-extrabold')}>
        {unconfirmed ? '—' : formatSom(l.amount)}
      </td>
      <td className={td}>
        {unconfirmed ? (
          <Link
            to="/lessons/$lessonId"
            params={{ lessonId: l.id }}
            search={search}
            className="font-extrabold whitespace-nowrap text-burned-strong"
          >
            Подтвердить →
          </Link>
        ) : (
          <span
            className={cn(
              'font-bold whitespace-nowrap',
              l.confirmed?.late ? 'text-warn' : 'text-present-strong',
            )}
          >
            {l.confirmed?.text ?? '—'}
          </span>
        )}
      </td>
    </tr>
  )
}
