// «Пробные · N» on У3 / УД2: free first visit, written to trials.status only — never to the draft,
// confirm_lesson, balance or payroll (Ж2, Ж6). The teacher marks from the lesson day on.
import { phoneCaption, type Trial } from '@/features/trials/model'
import { useMarkTrial } from '@/features/trials/parts'
import { cn } from '@/lib/utils'
import { trialInitials } from './trials-view'

const SUBTITLE = 'бесплатно · не списывается · в ЗП не входит'

export interface TrialsBlockProps {
  trials: Trial[]
  /** Lesson is today or earlier (Bishkek) and not cancelled — marks are accepted. */
  markable: boolean
  desktop?: boolean
}

function trialMeta(t: Trial) {
  return t.student_id === null ? 'пробное занятие · первый раз' : 'пробное занятие'
}

function TrialButtons({
  trial,
  markable,
  desktop,
}: {
  trial: Trial
  markable: boolean
  desktop: boolean
}) {
  const mark = useMarkTrial()
  if (!markable) {
    return <p className="text-xs font-bold text-trial-strong">отметка — в день занятия</p>
  }
  const current =
    trial.status === 'attended' ? 'attended' : trial.status === 'no_show' ? 'no_show' : null
  const decided = trial.status === 'enrolled'
  const buttons = [
    ['attended', 'Был', 'border-present bg-present text-white'],
    ['no_show', 'Не пришёл', 'border-ink-muted bg-muted text-ink'],
  ] as const
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {buttons.map(([status, label, active]) => (
        <button
          key={status}
          type="button"
          aria-pressed={
            current === status || (decided && status === 'attended' && trial.came === true)
          }
          disabled={decided || mark.isPending}
          onClick={() => {
            if (current !== status) mark.mutate({ id: trial.id, status })
          }}
          className={cn(
            'border-[1.5px] text-[13px] font-extrabold transition-opacity',
            desktop ? 'min-h-10 rounded-[10px]' : 'min-h-11 rounded-xl',
            current === status ? active : 'border-line-strong bg-card text-ink',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Avatar({ name, desktop }: { name: string; desktop: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-trial font-display font-bold text-trial-strong',
        desktop ? 'size-9 text-xs' : 'size-10 text-[13px]',
      )}
    >
      {trialInitials(name)}
    </span>
  )
}

function Who({ trial }: { trial: Trial }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[15px] font-extrabold">{trial.full_name}</span>
      <span className="text-xs font-bold text-trial-strong">{trialMeta(trial)}</span>
    </span>
  )
}

/** У3: cards under the roster. */
export function MobileTrials({ trials, markable }: TrialsBlockProps) {
  if (trials.length === 0) return null
  return (
    <section aria-label={`Пробные · ${trials.length}`} className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3 pt-1.5">
        <h2 className="text-sm font-extrabold text-trial-strong">Пробные · {trials.length}</h2>
        <p className="text-[11px] font-bold text-ink-muted">не списывается · не в ЗП</p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {trials.map((t) => (
          <li
            key={t.id}
            aria-label={`Пробный: ${t.full_name}`}
            className="flex flex-col gap-2.5 rounded-[18px] border-[1.5px] border-dashed border-trial bg-card py-3 pr-3 pl-3.5"
          >
            <div className="flex items-center gap-3">
              <Avatar name={t.full_name} desktop={false} />
              <Who trial={t} />
            </div>
            <TrialButtons trial={t} markable={markable} desktop={false} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** УД2: a violet row group inside the roster table. */
export function DesktopTrials({ trials, markable }: TrialsBlockProps) {
  if (trials.length === 0) return null
  return (
    <section aria-label={`Пробные · ${trials.length}`}>
      <div className="flex items-center justify-between gap-3 border-t border-line bg-trial-soft px-5 py-3">
        <h2 className="text-xs font-extrabold tracking-[0.06em] text-trial-strong uppercase">
          Пробные · {trials.length}
        </h2>
        <p className="text-xs font-bold text-ink-muted">{SUBTITLE}</p>
      </div>
      <ul>
        {trials.map((t) => (
          <li
            key={t.id}
            aria-label={`Пробный: ${t.full_name}`}
            className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_300px] items-center gap-3 border-l-[5px] border-dashed border-trial px-5 py-3 last:rounded-bl-[20px]"
          >
            <span className="flex items-center gap-3">
              <Avatar name={t.full_name} desktop />
              <Who trial={t} />
            </span>
            <span className="text-[13px] font-bold text-ink-muted">
              {t.parent_phone ? `родитель · ${phoneCaption(t.parent_phone)}` : ''}
            </span>
            <TrialButtons trial={t} markable={markable} desktop />
          </li>
        ))}
      </ul>
    </section>
  )
}
