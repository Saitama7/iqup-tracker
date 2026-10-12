import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Phone } from 'lucide-react'
import { Fragment, useId, useMemo, useState, type ReactNode, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { PageHeader, PageTitle } from '@/components/page'
import { ADMIN_LESSONS_KEY } from '@/features/schedule/api'
import { studentsQuery } from '@/features/students/api'
import {
  firstName,
  groupLabel,
  scheduleCaption,
  type GroupBrief,
  type StudentsSource,
} from '@/features/students/model'
import { FormDialog, NativeSelect } from '@/features/students/parts'
import {
  cardClass,
  ErrorText,
  Field,
  inputClass,
  SubmitButton,
  tdClass,
  thClass,
} from '@/features/tariffs/parts'
import { useNow } from '@/lib/now'
import { maskPhoneInput } from '@/lib/phone-input'
import { bishkekDate, formatMonthNom } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import {
  bookForm,
  bookTrials,
  groupLessonsQuery,
  TRIALS_KEY,
  trialsQuery,
  useTrialsRealtime,
} from './api'
import {
  conversionBySource,
  dayShort,
  lessonOptionLabel,
  markLabel,
  monthConversion,
  phoneCaption,
  pupilsWord,
  shortPerson,
  SOURCE_LABEL,
  TRIAL_SOURCES,
  trialGroupLabel,
  trialsWord,
  trialWhen,
  upcomingRows,
  waitingTrials,
  weekStats,
  type Trial,
  type TrialSource,
  type UpcomingRow,
} from './model'
import { EnrollTrialDialog, RebookDialog, TrialChip, useCloseTrial } from './parts'

export const TRIAL_TABS = ['upcoming', 'waiting', 'conversion'] as const
export type TrialTab = (typeof TRIAL_TABS)[number]

export interface TrialsSearch {
  tab?: TrialTab
  group?: string
}

// artboard: th, td { padding: 10px; font-size: 13px } — the six columns fit next to the form
const denseTable =
  'w-full min-w-[560px] border-collapse [&_td]:px-2.5 [&_td]:text-[13px] [&_th]:px-2.5'

// min-h-9 fits the dense desktop tables; phone cards get the 44 px tap target (smallBtnPhone)
const smallBtn =
  'inline-flex min-h-9 items-center justify-center rounded-[10px] px-3 text-xs font-extrabold whitespace-nowrap'
const smallBtnPhone = cn(smallBtn, 'min-h-11')

// А11 Пробные занятия (docs/design/AdminTrials.dc.html; 05-decisions Ж1–Ж8, 01-domain-model §5.1).
// Tabs show one list each (the artboard's canvas shows both tables under «Предстоящие»).
// Phone: same route, tables → cards, the form opens from «+ Записать на пробное».
export function TrialsPage({
  search,
  onSearchChange,
}: {
  search: TrialsSearch
  onSearchChange: (next: TrialsSearch) => void
}) {
  const isDesktop = useIsDesktop()
  const now = useNow()
  const today = bishkekDate(now)
  useTrialsRealtime()
  const trials = useQuery(trialsQuery())
  const students = useQuery(studentsQuery())
  const tab = search.tab ?? 'upcoming'
  const [formOpen, setFormOpen] = useState(!!search.group && !isDesktop)
  const [rebook, setRebook] = useState<Trial | null>(null)
  const [enroll, setEnroll] = useState<Trial | null>(null)

  const list = useMemo(() => trials.data ?? [], [trials.data])
  const upcoming = useMemo(() => upcomingRows(list, today), [list, today])
  const waiting = useMemo(() => waitingTrials(list, today), [list, today])
  const upcomingCount = upcoming.reduce((n, r) => n + r.trials.length, 0)
  const enrollGroup = enroll
    ? students.data?.groups.find((g) => g.id === enroll.group_id)
    : undefined

  const tabs: { id: TrialTab; label: string }[] = [
    { id: 'upcoming', label: `Предстоящие · ${upcomingCount}` },
    { id: 'waiting', label: `Прошли, ждут решения · ${waiting.length}` },
    { id: 'conversion', label: 'Конверсия за месяц' },
  ]
  const tabBar = (
    <div
      role="tablist"
      aria-label="Пробные"
      className="flex max-w-full overflow-x-auto rounded-xl border-[1.5px] border-line-strong bg-card p-[3px]"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => {
            onSearchChange({ ...search, tab: t.id === 'upcoming' ? undefined : t.id })
          }}
          className={cn(
            'min-h-10 shrink-0 rounded-[9px] px-3 text-[13px] whitespace-nowrap',
            tab === t.id ? 'bg-ink font-extrabold text-brand' : 'font-bold text-ink-muted',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  const actions: RowActions = {
    today,
    onRebook: setRebook,
    onEnroll: setEnroll,
  }

  const content = trials.isPending ? (
    <div className={cn(cardClass, 'h-64 animate-pulse')} aria-label="Загрузка" />
  ) : trials.isError ? (
    <p role="alert" className={cn(cardClass, 'p-5 font-bold text-burned')}>
      Не удалось загрузить пробные. Проверьте интернет и обновите страницу.
    </p>
  ) : tab === 'upcoming' ? (
    <UpcomingSection rows={upcoming} isDesktop={isDesktop} actions={actions} />
  ) : tab === 'waiting' ? (
    <WaitingSection trials={waiting} isDesktop={isDesktop} actions={actions} />
  ) : (
    <ConversionSection trials={list} today={today} isDesktop={isDesktop} />
  )

  const form = (
    <BookForm
      source={students.data}
      today={today}
      initialGroup={search.group}
      onBooked={() => {
        setFormOpen(false)
        if (tab !== 'upcoming') onSearchChange({ ...search, tab: undefined })
      }}
    />
  )

  return (
    <div className="flex flex-col gap-5">
      {isDesktop ? (
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-extrabold tracking-[0.06em] text-ink-muted uppercase">
              Записались на пробное, ещё не оплатили
            </p>
            <PageTitle>Пробные занятия</PageTitle>
          </div>
          {tabBar}
        </header>
      ) : (
        <>
          <PageHeader eyebrow="Записались, ещё не оплатили" title="Пробные занятия" />
          <button
            type="button"
            onClick={() => {
              setFormOpen(true)
            }}
            className="min-h-12 rounded-[14px] bg-ink text-sm font-extrabold text-brand"
          >
            + Записать на пробное
          </button>
          {tabBar}
        </>
      )}

      <Kpis trials={list} waiting={waiting.length} today={today} now={now} isDesktop={isDesktop} />

      {isDesktop ? (
        <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-6">
          <div className="flex min-w-0 flex-col gap-4">{content}</div>
          <aside
            aria-label="Записать на пробное"
            className="sticky top-6 flex flex-col gap-3.5 rounded-[20px] border-[1.5px] border-dashed border-trial bg-card p-[22px]"
          >
            <h2 className="font-display text-base font-bold">Записать на пробное</h2>
            {form}
          </aside>
        </div>
      ) : (
        <>
          {content}
          <FormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            title="Записать на пробное"
            description="Урок бесплатный: не списывается и в ЗП учителя не входит"
          >
            {form}
          </FormDialog>
        </>
      )}

      {rebook && (
        <RebookDialog
          trial={rebook}
          today={today}
          onOpenChange={(o) => {
            if (!o) setRebook(null)
          }}
        />
      )}
      {enroll && enrollGroup && (
        <EnrollTrialDialog
          trial={enroll}
          group={enrollGroup}
          history={studentHistory(students.data, enroll.student_id)}
          today={today}
          onOpenChange={(o) => {
            if (!o) setEnroll(null)
          }}
        />
      )}
    </div>
  )
}

/** Discounts of an existing student for «Оплатил → зачислить» (В5); a lead has none. */
function studentHistory(source: StudentsSource | undefined, studentId: string | null) {
  const s = studentId ? source?.students.find((x) => x.id === studentId) : undefined
  if (!s || !source) return undefined
  return {
    isReturning: s.is_returning,
    subscriptions: s.enrollments.flatMap((e) => e.subscriptions),
    friendsBrought: source.students.filter((f) => f.referred_by_student_id === s.id).length,
  }
}

// ─── KPI ────────────────────────────────────────────────────────────────────

function Kpis({
  trials,
  waiting,
  today,
  now,
  isDesktop,
}: {
  trials: readonly Trial[]
  waiting: number
  today: string
  now: number
  isDesktop: boolean
}) {
  const week = weekStats(trials, today)
  const conv = monthConversion(trials, today)
  const weekCaption = [
    `в ${week.groups} ${week.groups === 1 ? 'группе' : 'группах'}`,
    week.wholeGroups > 0
      ? `${week.wholeGroups} ${week.wholeGroups === 1 ? 'группа' : 'группы'} целиком`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const label = 'text-[11px] font-extrabold tracking-[0.06em] uppercase'
  const value = 'font-display text-xl font-bold min-[900px]:text-[22px]'
  const caption = 'text-xs font-bold'
  return (
    <div
      className={cn('grid gap-3', isDesktop ? 'grid-cols-4' : 'grid-cols-2')}
      aria-label="Сводка пробных"
    >
      <div className="rounded-2xl border-[1.5px] border-dashed border-trial bg-card px-4 py-3.5">
        <div className={cn(label, 'text-trial-strong')}>На этой неделе</div>
        <div className={value}>{trialsWord(week.trials)}</div>
        <div className={cn(caption, 'text-ink-muted')}>{week.trials > 0 ? weekCaption : '—'}</div>
      </div>
      <div className="rounded-2xl border border-line bg-card px-4 py-3.5">
        <div className={cn(label, 'text-ink-muted')}>Ждут решения</div>
        <div className={value}>{waiting}</div>
        <div className={cn(caption, 'text-warn')}>были на пробном, оплаты нет</div>
      </div>
      <div className="rounded-2xl border border-line bg-card px-4 py-3.5">
        <div className={cn(label, 'text-ink-muted')}>{formatMonthNom(now)} · пришли → оплатили</div>
        <div className={value}>
          {conv.came} → {conv.paid}
        </div>
        <div
          className={cn(caption, conv.percent === null ? 'text-ink-muted' : 'text-present-strong')}
        >
          {conv.percent === null ? 'пока никто не пришёл' : `${conv.percent} % конверсия`}
        </div>
      </div>
      <div className={cn('rounded-2xl bg-band px-4 py-3.5', !isDesktop && 'col-span-2')}>
        <div className={cn(label, 'text-ink-muted')}>Правило</div>
        <div className="text-[13px] leading-snug font-bold">
          Пробный урок полностью бесплатный: не списывается, учителю не начисляется, в заполненность
          не входит. Можно в любую группу — и в набираемую, и в активную
        </div>
      </div>
    </div>
  )
}

// ─── Lists ──────────────────────────────────────────────────────────────────

interface RowActions {
  today: string
  onRebook: (t: Trial) => void
  onEnroll: (t: Trial) => void
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={title} className={cn(cardClass, 'overflow-x-auto')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-[18px] py-3.5">
        <h2 className="text-[15px] font-extrabold">{title}</h2>
        {aside && <div className="text-xs font-bold text-ink-muted">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

const groupTeacher = (t: Trial) =>
  [trialGroupLabel(t.group), t.group.teacherName ? firstName(t.group.teacherName) : null]
    .filter(Boolean)
    .join(' · ') + (t.group.status === 'forming' ? ' · набор' : '')

const authorCaption = (t: Trial) =>
  [t.authorName ? firstName(t.authorName) : null, dayShort(t.created_at.slice(0, 10))]
    .filter(Boolean)
    .join(' · ')

function UpcomingSection({
  rows,
  isDesktop,
  actions,
}: {
  rows: UpcomingRow[]
  isDesktop: boolean
  actions: RowActions
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => {
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  if (rows.length === 0) {
    return (
      <Section title="Предстоящие">
        <p className="p-5 text-sm font-bold text-ink-muted">Пока никто не записан на пробное</p>
      </Section>
    )
  }
  if (!isDesktop) {
    return (
      <Section title="Предстоящие">
        <ul className="flex flex-col">
          {rows.map((r) => {
            const t = r.trials[0]
            if (!t) return null
            const batch = r.trials.length > 1
            return (
              <li
                key={r.lessonId}
                className={cn(
                  'flex flex-col gap-1.5 border-b border-line px-4 py-3.5 last:border-0',
                  batch && 'bg-trial-soft',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold">
                    {trialWhen(t.lessonDate, t.lessonStart, actions.today)}
                  </span>
                  <TrialChip>{r.wholeGroup ? 'вся группа' : 'пробный'}</TrialChip>
                </div>
                <div className="font-extrabold">
                  {batch ? pupilsWord(r.trials.length) : t.full_name}
                </div>
                <div className="text-[13px] font-bold text-ink-muted">{groupTeacher(t)}</div>
                {batch ? (
                  <BatchList
                    trials={r.trials}
                    open={open.has(r.lessonId)}
                    onToggle={() => {
                      toggle(r.lessonId)
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <PhoneLink phone={t.parent_phone} />
                    <button
                      type="button"
                      className={cn(smallBtnPhone, 'text-teal')}
                      aria-label={`Перенести: ${t.full_name}`}
                      onClick={() => {
                        actions.onRebook(t)
                      }}
                    >
                      Перенести
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Section>
    )
  }
  return (
    <Section title="Предстоящие">
      <table className={denseTable} aria-label="Предстоящие пробные">
        <thead>
          <tr className="border-b border-line">
            <th className={thClass}>Когда</th>
            <th className={thClass}>Кто</th>
            <th className={thClass}>Группа · учитель</th>
            <th className={thClass}>Родитель</th>
            <th className={thClass}>Записал</th>
            <th className={thClass}>
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = r.trials[0]
            if (!t) return null
            const batch = r.trials.length > 1
            const expanded = open.has(r.lessonId)
            return (
              <Fragment key={r.lessonId}>
                <tr
                  className={cn(
                    batch && 'bg-trial-soft',
                    !expanded && '[&:last-child>td]:border-0',
                  )}
                >
                  <td className={cn(tdClass, 'font-extrabold whitespace-nowrap')}>
                    {trialWhen(t.lessonDate, t.lessonStart, actions.today)}
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <TrialChip>{r.wholeGroup ? 'вся группа' : 'пробный'}</TrialChip>
                      <b>{batch ? pupilsWord(r.trials.length) : shortPerson(t.full_name)}</b>
                      {batch && (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          className="text-xs font-extrabold text-teal"
                          onClick={() => {
                            toggle(r.lessonId)
                          }}
                        >
                          {expanded ? 'свернуть ▴' : 'развернуть ▾'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className={tdClass}>{groupTeacher(t)}</td>
                  <td className={cn(tdClass, 'whitespace-nowrap text-ink-muted')}>
                    {batch ? `${r.trials.length} номера` : phoneCaption(t.parent_phone)}
                  </td>
                  <td className={cn(tdClass, 'whitespace-nowrap text-ink-muted')}>
                    {authorCaption(t)}
                  </td>
                  <td className={tdClass}>
                    {batch ? (
                      <Link
                        to="/admin/groups/$groupId"
                        params={{ groupId: t.group_id }}
                        className="text-xs font-extrabold whitespace-nowrap text-teal"
                      >
                        Группа →
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="text-xs font-extrabold whitespace-nowrap text-teal"
                        aria-label={`Перенести: ${t.full_name}`}
                        onClick={() => {
                          actions.onRebook(t)
                        }}
                      >
                        Перенести
                      </button>
                    )}
                  </td>
                </tr>
                {batch && expanded && (
                  <tr className="bg-trial-soft">
                    <td colSpan={6} className={cn(tdClass, 'pt-1.5')}>
                      <BatchList trials={r.trials} open onToggle={null} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}

/** «Записаны: Эламан Тойчуев · 0555 300 001 …» — the folded group booking (06-design, А11). */
function BatchList({
  trials,
  open,
  onToggle,
}: {
  trials: readonly Trial[]
  open: boolean
  onToggle: (() => void) | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onToggle && (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="text-xs font-extrabold text-teal"
        >
          {open ? 'свернуть ▴' : 'развернуть ▾'}
        </button>
      )}
      {open && (
        <>
          <span className="mr-1 text-[11px] font-extrabold tracking-[0.06em] text-trial-strong uppercase">
            Записаны
          </span>
          {trials.map((t) => (
            <span
              key={t.id}
              className="rounded-full border border-trial/30 bg-card px-2.5 py-1 text-xs font-bold whitespace-nowrap"
            >
              {t.full_name} · {phoneCaption(t.parent_phone)}
            </span>
          ))}
        </>
      )}
    </div>
  )
}

function PhoneLink({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-ink-muted">—</span>
  return (
    <a
      href={`tel:+${phone}`}
      className="inline-flex items-center gap-1.5 font-extrabold whitespace-nowrap text-ink"
    >
      <Phone className="size-3.5" strokeWidth={2.4} aria-hidden />
      {phoneCaption(phone)}
    </a>
  )
}

function WaitingSection({
  trials,
  isDesktop,
  actions,
}: {
  trials: readonly Trial[]
  isDesktop: boolean
  actions: RowActions
}) {
  const close = useCloseTrial()
  const title = 'Прошли пробное — ждут решения'
  const aside = 'учитель отметил «был», оплаты пока нет'
  if (trials.length === 0) {
    return (
      <Section title={title} aside={aside}>
        <p className="p-5 text-sm font-bold text-ink-muted">Решений не ждёт никто</p>
      </Section>
    )
  }

  const markCell = (t: Trial) => (
    <>
      <span
        className={cn(
          'font-extrabold whitespace-nowrap',
          t.status === 'attended' && 'text-present-strong',
          t.status === 'no_show' && 'text-burned-strong',
          t.status === 'scheduled' && 'text-ink-muted',
        )}
      >
        {t.status === 'scheduled' && t.lessonStatus === 'cancelled'
          ? 'Занятие отменено'
          : markLabel(t)}
      </span>
      {t.status === 'no_show' && (
        <div className="text-xs font-bold text-burned-strong">
          позвонить — ждать ли на следующий?
        </div>
      )}
    </>
  )

  const btn = isDesktop ? smallBtn : smallBtnPhone
  const decision = (t: Trial) => (
    <div className="flex flex-wrap gap-1.5">
      {t.status === 'attended' ? (
        <button
          type="button"
          className={cn(btn, 'bg-ink text-brand')}
          aria-label={`Оплатил → зачислить: ${t.full_name}`}
          onClick={() => {
            actions.onEnroll(t)
          }}
        >
          Оплатил → зачислить
        </button>
      ) : (
        <button
          type="button"
          className={cn(btn, 'border-[1.5px] border-ink text-ink')}
          aria-label={`${t.status === 'no_show' ? 'Записать заново' : 'Перенести'}: ${t.full_name}`}
          onClick={() => {
            actions.onRebook(t)
          }}
        >
          {t.status === 'no_show' ? 'Записать заново' : 'Перенести'}
        </button>
      )}
      <button
        type="button"
        disabled={close.isPending}
        className={cn(btn, 'border-[1.5px] border-line-strong text-ink-muted')}
        aria-label={`${t.status === 'attended' ? 'Отказ' : 'Закрыть'}: ${t.full_name}`}
        onClick={() => {
          close.mutate(t)
        }}
      >
        {t.status === 'attended' ? 'Отказ' : 'Закрыть'}
      </button>
    </div>
  )

  if (!isDesktop) {
    return (
      <Section title={title}>
        <ul className="flex flex-col">
          {trials.map((t) => (
            <li
              key={t.id}
              className={cn(
                'flex flex-col gap-1.5 border-b border-line px-4 py-3.5 last:border-0',
                t.status === 'no_show' && 'bg-burned-tint',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold">{t.full_name}</span>
                <span className="text-[13px] font-bold whitespace-nowrap text-ink-muted">
                  {dayShort(t.lessonDate)} {t.lessonStart}
                </span>
              </div>
              <div className="text-[13px] font-bold text-ink-muted">{trialGroupLabel(t.group)}</div>
              <div className="text-[13px]">{markCell(t)}</div>
              <PhoneLink phone={t.parent_phone} />
              {decision(t)}
            </li>
          ))}
        </ul>
      </Section>
    )
  }

  return (
    <Section title={title} aside={aside}>
      <table className={denseTable} aria-label="Ждут решения">
        <thead>
          <tr className="border-b border-line">
            <th className={thClass}>Было</th>
            <th className={thClass}>Кто</th>
            <th className={thClass}>Группа</th>
            <th className={thClass}>Отметка учителя</th>
            <th className={thClass}>Родитель</th>
            <th className={thClass}>Решение</th>
          </tr>
        </thead>
        <tbody>
          {trials.map((t) => (
            <tr
              key={t.id}
              className={cn(
                '[&:last-child>td]:border-0',
                t.status === 'no_show' && 'bg-burned-tint',
              )}
            >
              <td className={cn(tdClass, 'whitespace-nowrap')}>
                {dayShort(t.lessonDate)} {t.lessonStart}
              </td>
              <td className={cn(tdClass, 'font-extrabold whitespace-nowrap')}>
                {shortPerson(t.full_name)}
              </td>
              <td className={tdClass}>{trialGroupLabel(t.group)}</td>
              <td className={tdClass}>{markCell(t)}</td>
              <td className={cn(tdClass, 'whitespace-nowrap text-ink-muted')}>
                {t.status === 'no_show' ? (
                  <PhoneLink phone={t.parent_phone} />
                ) : (
                  phoneCaption(t.parent_phone)
                )}
              </td>
              <td className={tdClass}>{decision(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

// ─── Conversion ─────────────────────────────────────────────────────────────

const RESULT_LABEL: Record<Trial['status'], string> = {
  scheduled: 'Записан',
  attended: 'Был(а) · ждёт решения',
  no_show: 'Не пришёл(ла)',
  enrolled: 'Оплатил · зачислен(а)',
  closed: 'Закрыто',
}

const monthShift = (month: string, delta: number) => {
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + delta)
  return d.toISOString().slice(0, 10)
}

function ConversionSection({
  trials,
  today,
  isDesktop,
}: {
  trials: readonly Trial[]
  today: string
  isDesktop: boolean
}) {
  const [month, setMonth] = useState(`${today.slice(0, 7)}-01`)
  const conv = monthConversion(trials, month)
  const sources = conversionBySource(trials, month)
  const inMonth = trials
    .filter((t) => t.lessonDate.slice(0, 7) === month.slice(0, 7))
    .sort((a, b) => b.lessonDate.localeCompare(a.lessonDate))
  const monthLabel = `${formatMonthNom(Date.parse(`${month}T12:00:00Z`))} ${month.slice(0, 4)}`

  return (
    <Section
      title="Конверсия за месяц"
      aside={
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Предыдущий месяц"
            className="grid size-9 place-items-center rounded-lg text-ink"
            onClick={() => {
              setMonth(monthShift(month, -1))
            }}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="min-w-28 text-center text-sm font-extrabold text-ink">{monthLabel}</span>
          <button
            type="button"
            aria-label="Следующий месяц"
            className="grid size-9 place-items-center rounded-lg text-ink"
            onClick={() => {
              setMonth(monthShift(month, 1))
            }}
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-[18px]">
        <div role="status" aria-label="Воронка" className="grid grid-cols-3 gap-2.5">
          {[
            ['Записались', conv.booked],
            ['Пришли', conv.came],
            ['Оплатили', conv.paid],
          ].map(([label, n]) => (
            <div key={label} className="rounded-2xl bg-band px-3.5 py-3">
              <div className="text-[11px] font-extrabold tracking-[0.06em] text-ink-muted uppercase">
                {label}
              </div>
              <div className="font-display text-xl font-bold">{n}</div>
            </div>
          ))}
        </div>
        <p className="text-sm font-bold text-ink-muted">
          {conv.percent === null
            ? 'В этом месяце на пробных ещё никого не было'
            : `${conv.percent} % пришедших оплатили абонемент`}
        </p>

        {sources.length > 0 && (
          <table className="w-full border-collapse" aria-label="По источникам">
            <thead>
              <tr className="border-b border-line">
                <th className={thClass}>Откуда узнали</th>
                <th className={cn(thClass, 'text-right')}>Записались</th>
                <th className={cn(thClass, 'text-right')}>Пришли</th>
                <th className={cn(thClass, 'text-right')}>Оплатили</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.source ?? 'none'} className="[&:last-child>td]:border-0">
                  <td className={tdClass}>{s.source ? SOURCE_LABEL[s.source] : 'Не указано'}</td>
                  <td className={cn(tdClass, 'text-right tabular-nums')}>{s.conversion.booked}</td>
                  <td className={cn(tdClass, 'text-right tabular-nums')}>{s.conversion.came}</td>
                  <td className={cn(tdClass, 'text-right tabular-nums')}>{s.conversion.paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {inMonth.length > 0 && (
          <ul aria-label="Пробные месяца" className="flex flex-col">
            {inMonth.map((t) => (
              <li
                key={t.id}
                className={cn(
                  'flex justify-between gap-3 border-b border-line py-2.5 text-sm last:border-0',
                  !isDesktop && 'flex-col gap-0.5',
                )}
              >
                <span>
                  <b>{t.full_name}</b>{' '}
                  <span className="font-bold text-ink-muted">
                    · {dayShort(t.lessonDate)} · {trialGroupLabel(t.group)}
                  </span>
                </span>
                <span
                  className={cn(
                    'font-extrabold whitespace-nowrap',
                    t.status === 'enrolled' ? 'text-present-strong' : 'text-ink-muted',
                  )}
                >
                  {t.status === 'closed'
                    ? t.came
                      ? 'Отказ после пробного'
                      : t.came === false
                        ? 'Не пришёл(ла) · закрыто'
                        : 'Отменено'
                    : RESULT_LABEL[t.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

// ─── «Записать на пробное» ──────────────────────────────────────────────────

interface Person {
  name: string
  phone: string
}

function groupOption(g: GroupBrief, enrolled: number, today: string): string {
  return [
    groupLabel(g),
    g.teacher ? firstName(g.teacher.full_name) : null,
    scheduleCaption(g.schedule_rules, today) || null,
    g.status === 'forming' && enrolled === 0 ? 'набор' : pupilsWord(enrolled),
  ]
    .filter(Boolean)
    .join(' · ')
}

function BookForm({
  source,
  today,
  initialGroup,
  onBooked,
}: {
  source: StudentsSource | undefined
  today: string
  initialGroup: string | undefined
  onBooked: () => void
}) {
  const ids = {
    who: useId(),
    student: useId(),
    grade: useId(),
    group: useId(),
    lesson: useId(),
    source: useId(),
    note: useId(),
  }
  const queryClient = useQueryClient()
  const [existing, setExisting] = useState(false)
  const [studentId, setStudentId] = useState('')
  const [people, setPeople] = useState<Person[]>([{ name: '', phone: '' }])
  const [grade, setGrade] = useState('')
  const [groupId, setGroupId] = useState(initialGroup ?? '')
  const [lessonId, setLessonId] = useState('')
  const [from, setFrom] = useState<TrialSource | ''>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo(
    () =>
      (source?.groups ?? [])
        .filter((g) => g.status !== 'archived')
        .sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), 'ru')),
    [source],
  )
  const enrolledIn = (groupId: string) =>
    (source?.students ?? []).filter((s) =>
      s.enrollments.some((e) => e.group_id === groupId && e.status === 'active'),
    ).length
  const group = groups.find((g) => g.id === groupId) ?? null
  const lessons = useQuery(groupLessonsQuery(groupId || null, today))
  const students = useMemo(
    () =>
      (source?.students ?? [])
        .filter((s) => !s.enrollments.some((e) => e.group_id === groupId && e.status === 'active'))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru')),
    [source, groupId],
  )
  const teacher = group?.teacher ? firstName(group.teacher.full_name) : 'Учитель'

  const mutation = useMutation({
    mutationFn: bookTrials,
    onSuccess: async (n) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [TRIALS_KEY] }),
        queryClient.invalidateQueries({ queryKey: [ADMIN_LESSONS_KEY] }),
      ])
      const lesson = lessons.data?.find((l) => l.id === lessonId)
      const who =
        n > 1
          ? pupilsWord(n)
          : existing
            ? (students.find((s) => s.id === studentId)?.full_name ?? 'Ученик')
            : people[0]?.name.trim()
      toast.success(
        `Записали на пробное: ${who}${lesson ? ` · ${lessonOptionLabel(lesson.date, lesson.start, today)}` : ''}`,
      )
      setPeople([{ name: '', phone: '' }])
      setStudentId('')
      setNote('')
      setError(null)
      onBooked()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (existing && !studentId) {
      setError('Выберите ученика')
      return
    }
    const parsed = bookForm.safeParse({
      studentId: existing ? studentId : null,
      people: existing
        ? []
        : people
            .filter((p, i) => i === 0 || p.name.trim() || p.phone.trim())
            .map((p) => ({ fullName: p.name, phone: p.phone })),
      grade: grade ? Number(grade) : null,
      groupId,
      lessonId,
      source: from || null,
      note,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  const setPerson = (i: number, patch: Partial<Person>) => {
    setPeople((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)))
    setError(null)
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Записать на пробное"
      className="flex flex-col gap-3.5"
    >
      <div role="group" aria-label="Кто" className="grid grid-cols-2 gap-1.5">
        {[
          [false, 'Новый ученик'],
          [true, 'Уже учится'],
        ].map(([value, label]) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={existing === value}
            onClick={() => {
              setExisting(value as boolean)
              setError(null)
            }}
            className={cn(
              'min-h-11 rounded-xl border-[1.5px] text-[13px] font-extrabold',
              existing === value
                ? 'border-ink bg-ink text-brand'
                : 'border-line-strong bg-card text-ink-muted',
            )}
          >
            {label as string}
          </button>
        ))}
      </div>

      {existing ? (
        <Field id={ids.student} label="Ученик">
          <NativeSelect
            id={ids.student}
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value)
              setError(null)
            }}
          >
            <option value="">Выберите ученика</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : (
        <>
          {people.map((p, i) => (
            <div key={i} className="flex flex-col gap-2.5">
              <Field
                id={`${ids.who}-name-${i}`}
                label={i === 0 ? 'Имя ученика' : `Ученик ${i + 1}`}
              >
                <input
                  id={`${ids.who}-name-${i}`}
                  className={inputClass}
                  placeholder="Розаина Бекова"
                  autoComplete="off"
                  value={p.name}
                  onChange={(e) => {
                    setPerson(i, { name: e.target.value })
                  }}
                />
              </Field>
              <Field id={`${ids.who}-phone-${i}`} label="Телефон родителя">
                <div className="flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 focus-within:border-ink">
                  <span className="font-extrabold text-ink-muted">+996</span>
                  <input
                    id={`${ids.who}-phone-${i}`}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="995 857 758"
                    className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:font-semibold placeholder:text-placeholder"
                    value={p.phone}
                    onChange={(e) => {
                      setPerson(i, { phone: maskPhoneInput(e.target.value) })
                    }}
                  />
                </div>
              </Field>
            </div>
          ))}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="text-[13px] font-extrabold text-teal"
              onClick={() => {
                setPeople((list) => [...list, { name: '', phone: '' }])
              }}
            >
              + Ещё ученик
            </button>
            {people.length > 1 && (
              <button
                type="button"
                className="text-[13px] font-extrabold text-ink-muted"
                onClick={() => {
                  setPeople((list) => list.slice(0, -1))
                }}
              >
                Убрать последнего
              </button>
            )}
          </div>
        </>
      )}

      <Field id={ids.grade} label="Класс">
        <NativeSelect
          id={ids.grade}
          value={grade}
          onChange={(e) => {
            setGrade(e.target.value)
          }}
        >
          <option value="">—</option>
          {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id={ids.group} label="Группа">
        <NativeSelect
          id={ids.group}
          value={groupId}
          onChange={(e) => {
            setGroupId(e.target.value)
            setLessonId('')
            setError(null)
          }}
        >
          <option value="">{source ? 'Выберите группу' : 'Загружаем группы…'}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {groupOption(g, enrolledIn(g.id), today)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id={ids.lesson} label="Занятие">
        <NativeSelect
          id={ids.lesson}
          value={lessonId}
          disabled={!groupId}
          onChange={(e) => {
            setLessonId(e.target.value)
            setError(null)
          }}
        >
          <option value="">
            {!groupId
              ? 'Сначала группа'
              : lessons.isPending
                ? 'Загружаем занятия…'
                : lessons.data?.length
                  ? 'Выберите занятие'
                  : 'Нет занятий впереди'}
          </option>
          {(lessons.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {lessonOptionLabel(l.date, l.start, today)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id={ids.source} label="Откуда узнали">
        <NativeSelect
          id={ids.source}
          value={from}
          onChange={(e) => {
            setFrom(e.target.value as TrialSource | '')
          }}
        >
          <option value="">—</option>
          {TRIAL_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id={ids.note} label="Комментарий">
        <input
          id={ids.note}
          className={inputClass}
          placeholder="например: подруга Айжан Б."
          autoComplete="off"
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
          }}
        />
      </Field>

      <p className="rounded-xl bg-trial-soft px-3 py-2.5 text-xs leading-normal font-bold text-trial-strong">
        {teacher} увидит пробного в списке на это занятие с пометкой «пробный» и отметит был / не
        был. Урок не списывается и в ЗП не входит. После оплаты — «Оплатил → зачислить».
      </p>

      {error && <ErrorText>{error}</ErrorText>}
      <SubmitButton pending={mutation.isPending} className="min-h-12">
        Записать на пробное
      </SubmitButton>
    </form>
  )
}
