import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { trialsQuery, useTrialsRealtime } from '@/features/trials/api'
import type { StudentsSource } from '@/features/students/model'
import {
  dayShort,
  phoneCaption,
  enrollPhoneWarning,
  trialDiscountHistory,
  trialWhen,
  type Trial,
} from '@/features/trials/model'
import { EnrollTrialDialog, RebookDialog, TrialChip } from '@/features/trials/parts'
import { tdClass } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import type { GroupRow } from './model'

// Open trials of one group on А4 (docs/design/AdminGroup.dc.html): they sit under the roster and
// never count in «8 / 10» (Ж2).

/** Open trials of the group (scheduled / attended / no_show), by lesson. */
export function useGroupTrials(groupId: string): Trial[] {
  useTrialsRealtime()
  const { data } = useQuery(trialsQuery({ groupId, open: true }))
  return data ?? []
}

const STATUS: Record<'scheduled' | 'attended' | 'no_show', { text: string; className: string }> = {
  scheduled: { text: 'ещё не был', className: 'font-bold text-ink-muted' },
  attended: { text: 'Был(а) · ждёт решения', className: 'font-extrabold text-present-strong' },
  no_show: { text: 'Не пришёл(ла)', className: 'font-extrabold text-warn-strong' },
}

const ACTION: Record<'scheduled' | 'attended' | 'no_show', string> = {
  scheduled: 'Перенести',
  attended: 'Оплатил → зачислить',
  no_show: 'Записать заново',
}

type Open = 'scheduled' | 'attended' | 'no_show'
const openStatus = (t: Trial): Open =>
  t.status === 'attended' || t.status === 'no_show' ? t.status : 'scheduled'

/** «0707 99 84 06 · записал(а) Алишка 30 сен» — no gendered forms (И1). */
function trialCaption(t: Trial): string {
  const author = t.authorName ? ` ${t.authorName.split(/\s+/)[0] ?? ''}` : ''
  return `${phoneCaption(t.parent_phone)} · записал(а)${author} ${dayShort(t.created_at.slice(0, 10))}`
}

/**
 * Dialog state for the row actions; render `dialog` once at the page level. `students` gives
 * «Оплатил → зачислить» the discounts of the student the trial becomes (В5: 15 % to a former pupil).
 */
export function useTrialActions(
  group: GroupRow | null,
  today: string,
  students: StudentsSource | undefined,
) {
  const [action, setAction] = useState<Trial | null>(null)
  const close = () => {
    setAction(null)
  }
  const dialog =
    !action || !group ? null : action.status === 'attended' ? (
      <EnrollTrialDialog
        trial={action}
        group={group}
        history={trialDiscountHistory(students, action)}
        warning={enrollPhoneWarning(action, students?.students ?? [])}
        today={today}
        onOpenChange={close}
      />
    ) : (
      <RebookDialog trial={action} today={today} onOpenChange={close} />
    )
  return { onAction: setAction, dialog }
}

interface Props {
  trials: Trial[]
  today: string
  /** «8 / 10» — what the trials are not part of. */
  fill: string
  onAction: (trial: Trial) => void
}

const headerText = (trials: Trial[], fill: string) =>
  `Пробные · ${trials.length} · не входят в ${fill}`

function ActionButton({
  trial,
  onAction,
  className,
}: {
  trial: Trial
  onAction: Props['onAction']
  className?: string
}) {
  const status = openStatus(trial)
  return (
    <button
      type="button"
      onClick={() => {
        onAction(trial)
      }}
      aria-label={`${ACTION[status]}: ${trial.full_name}`}
      className={cn(
        'rounded-lg px-2.5 text-xs font-extrabold whitespace-nowrap',
        status === 'attended'
          ? 'bg-ink text-brand'
          : 'border-[1.5px] border-line-strong bg-card text-ink',
        className,
      )}
    >
      {ACTION[status]}
    </button>
  )
}

/** Separator + one row per trial, inside the A4 roster table (5 columns). */
export function TrialTableRows({ trials, today, fill, onAction }: Props) {
  if (trials.length === 0) return null
  return (
    <>
      <tr data-testid="trial-separator">
        <td
          colSpan={5}
          className="bg-trial-soft px-3.5 py-2 text-[11px] font-extrabold tracking-[0.06em] text-trial-strong uppercase"
        >
          {headerText(trials, fill)}
        </td>
      </tr>
      {trials.map((t) => {
        const status = STATUS[openStatus(t)]
        return (
          <tr key={t.id} data-testid="trial-row">
            <td className={tdClass}>
              <TrialChip className="mr-1.5" />
              <b>{t.full_name}</b>
              <div className="text-xs font-bold text-ink-muted">{trialCaption(t)}</div>
            </td>
            <td className={cn(tdClass, 'whitespace-nowrap')}>
              {trialWhen(t.lessonDate, t.lessonStart, today)}
            </td>
            {/* no balance or freezes for a trial: status and decision span those columns */}
            <td colSpan={3} className={tdClass}>
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
                <span className={cn('text-xs whitespace-nowrap', status.className)}>
                  {status.text}
                </span>
                <ActionButton trial={t} onAction={onAction} className="min-h-9" />
              </div>
            </td>
          </tr>
        )
      })}
    </>
  )
}

/** Phone: the same as cards under the roster list. */
export function TrialCards({ trials, today, fill, onAction }: Props) {
  if (trials.length === 0) return null
  return (
    <div data-testid="trial-cards">
      <p className="bg-trial-soft px-4 py-2 text-[11px] font-extrabold tracking-[0.06em] text-trial-strong uppercase">
        {headerText(trials, fill)}
      </p>
      <ul aria-label="Пробные группы">
        {trials.map((t) => {
          const status = STATUS[openStatus(t)]
          return (
            <li
              key={t.id}
              className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-0"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <TrialChip />
                <b>{t.full_name}</b>
              </div>
              <span className="text-xs font-bold text-ink-muted">{trialCaption(t)}</span>
              <span className="text-xs font-bold text-ink-muted">
                {trialWhen(t.lessonDate, t.lessonStart, today)} ·{' '}
                <span className={status.className}>{status.text}</span>
              </span>
              <ActionButton trial={t} onAction={onAction} className="min-h-11 self-start" />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
