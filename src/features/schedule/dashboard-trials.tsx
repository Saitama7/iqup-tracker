import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { addDays } from '@/features/groups/model'
import { trialsQuery, useTrialsRealtime } from '@/features/trials/api'
import {
  isUpcoming,
  plusTrials,
  shortPerson,
  trialsByLesson,
  trialsOn,
  trialWhen,
  type Trial,
} from '@/features/trials/model'
import { cn } from '@/lib/utils'
import type { AdminLesson } from './api'

export interface DashboardTrials {
  /** Open trials per lesson of today — «+1 пробный» in the rows; never part of «N учеников». */
  byLesson: Map<string, Trial[]>
  /** Today's and tomorrow's trials, by time. */
  soon: Trial[]
  /** Booked and still ahead — «Все N →». */
  upcoming: number
}

/** А1 / АМ1: trials from today on (tens a month), narrowed on the client. */
export function useDashboardTrials(today: string): DashboardTrials {
  useTrialsRealtime()
  const { data = [] } = useQuery(trialsQuery({ from: today }))
  const tomorrow = addDays(today, 1)
  return {
    byLesson: trialsByLesson(data.filter((t) => t.lessonDate === today)),
    soon: [...trialsOn(data, today), ...trialsOn(data, tomorrow)],
    upcoming: data.filter((t) => isUpcoming(t, today)).length,
  }
}

/** Row caption with the violet «+1 пробный» appended (cancelled lessons take no trials). */
export function CaptionWithTrials({
  lesson,
  caption,
  trials,
}: {
  lesson: AdminLesson
  caption: string
  trials: DashboardTrials['byLesson']
}): ReactNode {
  const count = lesson.status === 'cancelled' ? 0 : (trials.get(lesson.id)?.length ?? 0)
  if (count === 0) return caption
  return (
    <>
      {caption} ·{' '}
      <span className="font-extrabold whitespace-nowrap text-trial-strong">
        {plusTrials(count)}
      </span>
    </>
  )
}

function TrialLine({ trial, today }: { trial: Trial; today: string }) {
  const isToday = trial.lessonDate === today
  return (
    <li className="flex justify-between gap-2.5 text-[13px] font-bold">
      <span>
        {trialWhen(trial.lessonDate, trial.lessonStart, today)} · {shortPerson(trial.full_name)} ·{' '}
        {trial.group.name}
      </span>
      <span
        className={cn(
          'shrink-0 whitespace-nowrap',
          isToday ? 'font-extrabold text-trial-strong' : 'text-ink-muted',
        )}
      >
        {isToday ? 'сегодня' : 'завтра'}
      </span>
    </li>
  )
}

/** Section «Пробные» of А1 (dashed violet card) and АМ1 (compact). */
export function TrialsWidget({
  trials,
  today,
  compact = false,
}: {
  trials: DashboardTrials
  today: string
  compact?: boolean
}) {
  return (
    <section
      aria-label="Пробные"
      className={cn(
        'flex flex-col gap-2.5 border-[1.5px] border-dashed border-trial bg-card',
        compact ? 'rounded-2xl px-3.5 py-3' : 'rounded-[20px] px-5 py-4',
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className={cn('font-extrabold text-trial-strong', compact ? 'text-sm' : 'text-[15px]')}>
          Пробные
        </h2>
        {trials.upcoming > 0 && (
          <Link
            to="/admin/trials"
            className="text-[13px] font-extrabold whitespace-nowrap text-teal"
          >
            Все {trials.upcoming} →
          </Link>
        )}
      </div>
      {trials.soon.length === 0 ? (
        <p className="text-[13px] font-bold text-ink-muted">Сегодня и завтра пробных нет</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {trials.soon.map((t) => (
            <TrialLine key={t.id} trial={t} today={today} />
          ))}
        </ul>
      )}
    </section>
  )
}
