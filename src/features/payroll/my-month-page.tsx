// У6 «Мой месяц» (docs/design/MyMonth.dc.html) and УД4 (docs/design/TeacherMonthDesk.dc.html).
// Sums — payroll/calc.ts over the month's lessons; everything time-dependent is a pure function of
// (rows, now), now = useNow() (§7.1). Advances come with R3: «—» until then, «К выплате» = начислено.
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { MonthPickerButton } from '@/components/ui/date-picker'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useSession } from '@/lib/auth'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { lessonsWord } from '@/features/lessons/select'
import { formatSom } from '@/features/tariffs/model'
import { myMonthQuery, usePayrollRealtime } from './api'
import {
  formulaNote,
  groupCaption,
  hoursCaption,
  inMonthPrep,
  monthNom,
  monthOf,
  monthTitle,
  myMonthView,
  noSubscriptionCaption,
  payday,
  periodCaption,
  PRELIMINARY_NOTE,
  shiftMonth,
  som,
  type MonthLessonLine,
  type MyMonthView,
} from './model'
import { CountUp, TiltCard } from './pay-card'

/** УД4 shows this many lessons, the rest behind «ещё N занятий». */
const LESSONS_SHOWN = 7

interface Props {
  month: string
}

export function MyMonthPage({ month }: Props) {
  const now = useNow()
  const { userId } = useSession()
  const isDesktop = useIsDesktop()
  const today = bishkekDate(now)

  usePayrollRealtime()
  const source = useQuery(myMonthQuery(userId, month))

  let body: ReactNode
  if (source.isError) {
    body = <Notice>Не удалось загрузить месяц. Проверьте интернет — обновим сами.</Notice>
  } else if (source.data === null) {
    body = <Notice>Вы ещё не привязаны к карточке учителя — обратитесь к администратору.</Notice>
  } else if (!source.data) {
    body = <Notice>Считаем месяц…</Notice>
  } else {
    const view = myMonthView(source.data, month, now)
    body = isDesktop ? (
      <DesktopMonth view={view} month={month} />
    ) : (
      <MobileMonth view={view} month={month} today={today} />
    )
  }

  return (
    <section className="flex flex-col gap-[18px] min-[900px]:gap-6">
      <Header month={month} today={today} desktop={isDesktop} />
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

// ─── Header and month switch ────────────────────────────────────────────────

function Header({ month, today, desktop }: { month: string; today: string; desktop: boolean }) {
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
                void navigate({ to: '/my-month', search: { month: m } })
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
        <Link to="/my-month" search={{ month: prev }} className={pill}>
          <ChevronLeft className="size-4" strokeWidth={2.5} aria-hidden />
          {monthNom(prev)}
        </Link>
        {next && (
          <Link to="/my-month" search={{ month: next }} className={pill}>
            {monthNom(next)}
            <ChevronRight className="size-4" strokeWidth={2.5} aria-hidden />
          </Link>
        )}
      </nav>
    </header>
  )
}

// ─── У6 · phone ─────────────────────────────────────────────────────────────

function MobileMonth({ view, month, today }: { view: MyMonthView; month: string; today: string }) {
  const { pay } = view
  const [all, setAll] = useState(false)
  const held = view.lessons.filter((l) => l.state === 'held')
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
        <div className="flex items-center justify-between border-t border-paper/12 pt-3 text-[13px] font-bold">
          <span className="opacity-70">Аванс</span>
          <span className="text-brand">—</span>
        </div>
        <div className="flex items-center justify-between text-[15px] font-extrabold">
          <span>К выплате сейчас</span>
          <span className="font-display text-lg whitespace-nowrap">{som(pay.amount)}</span>
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

      {view.unconfirmed.length > 0 && <UnconfirmedBlock lessons={view.unconfirmed} />}

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

function UnconfirmedBlock({ lessons }: { lessons: MonthLessonLine[] }) {
  return (
    <section
      className="flex flex-col gap-2 rounded-2xl bg-burned-soft px-4 py-3.5 text-burned-deep"
      aria-label="Не подтверждено — не в ЗП"
    >
      <h2 className="text-sm font-extrabold">Не подтверждено — не в ЗП</h2>
      <ul className="flex flex-col gap-1.5">
        {lessons.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 text-[13px] font-bold">
            <span className="min-w-0">
              {l.when} · {l.group}
            </span>
            <Link
              to="/lessons/$lessonId"
              params={{ lessonId: l.id }}
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

function DesktopMonth({ view, month }: { view: MyMonthView; month: string }) {
  const { pay } = view
  const [all, setAll] = useState(false)
  const shown = all ? view.lessons : view.lessons.slice(0, LESSONS_SHOWN)
  const more = view.lessons.length - shown.length
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] gap-3.5">
        <TiltCard className="flex h-full flex-col gap-2.5 rounded-[20px] bg-ink px-[22px] py-5 text-paper">
          <span className={cn(kpiLabel, 'text-brand')}>К выплате {payday(month)}</span>
          <p className="font-display text-[34px] leading-none font-extrabold whitespace-nowrap text-brand">
            <CountUp value={pay.amount} />{' '}
            <span className="text-base font-medium text-paper">сом</span>
          </p>
          <span className="text-xs font-bold opacity-70">
            начислено {formatSom(pay.amount)} · аванс —
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
          {view.lessons.length === 0 ? (
            <p className="px-5 py-4 text-sm font-bold text-ink-muted">
              Проведённых занятий пока нет.
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
                  <LessonRow key={l.id} lesson={l} />
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
            <p className="text-[13px] font-bold text-ink-muted">
              — · бухгалтер внесёт авансы при закрытии месяца
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

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn(card, 'flex flex-col gap-1.5 px-[22px] py-5')}>
      <span className={cn(kpiLabel, 'text-ink-muted')}>{label}</span>
      <span className="font-display text-[28px] font-bold whitespace-nowrap">{children}</span>
    </div>
  )
}

function LessonRow({ lesson: l }: { lesson: MonthLessonLine }) {
  const unconfirmed = l.state === 'unconfirmed'
  return (
    <tr className={cn('[&:last-child>td]:border-0', unconfirmed && 'bg-burned-soft/50')}>
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
