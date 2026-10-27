// У3 «Посещаемость» (docs/design/Attendance.dc.html) and УД2 (docs/design/TeacherAttendance.dc.html).
// Marks live in local state until «Провести занятие» sends the whole roster in one RPC (0010).
// Trials (Ж2/Ж3) get their own section under the roster; they never count in «Отмечено N из M».
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PageTitle } from '@/components/page'
import { BackButton } from '@/components/shell/back-button'
import { rateOn } from '@/features/payroll/calc'
import { PRELIMINARY_NOTE } from '@/features/payroll/model'
import { usePresetsRealtime } from '@/features/presets/api'
import {
  applyPresets,
  draftMarks,
  presetCaption,
  presetClearable,
  presetEditable,
  type PresetInfo,
} from '@/features/presets/model'
import { PresetDialog, useClearPreset } from '@/features/presets/preset-dialog'
import { trialsQuery, useTrialsRealtime } from '@/features/trials/api'
import { useSession } from '@/lib/auth'
import { lessonTrials, trialsWord, type Trial } from '@/features/trials/model'
import { formatSom, GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import { useNow } from '@/lib/now'
import { bishkekDate, formatDayLong } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { lessonSheetQuery, type LessonSheet } from './api'
import {
  desktopMeta,
  lessonAccrual,
  lessonRoster,
  MARK_LABEL,
  markAllPresent,
  MARKS,
  marksPayload,
  mobileMeta,
  tally,
  type LessonAccrual,
  type Mark,
  type RosterRow,
  type Tally,
  type Tone,
} from './attendance'
import { clearDraft, loadDraft, saveDraft } from './draft'
import { HeldPanel, useCorrections, type Corrections } from './lesson-corrections'
import { DesktopTrials, MobileTrials } from './lesson-trials'
import { lessonReturn, lessonSource, type LessonSearch } from './return-to'
import { studentsWord } from './parts'
import {
  bishkekTime,
  confirmCopy,
  lessonStartMs,
  lessonState,
  timeRange,
  untilLabel,
  type ConfirmCopy,
  type LessonState,
} from './select'
import { trialsSuffix } from './trials-view'
import { LessonMenu } from './edit-lesson'
import { UnconfirmLesson } from './unconfirm-lesson'
import { useConfirmLesson } from './use-confirm-lesson'

export function LessonPage({ lessonId, search }: { lessonId: string; search: LessonSearch }) {
  const { data, isError, isPending } = useQuery(lessonSheetQuery(lessonId))

  if (!data) {
    return (
      <section className="flex flex-col gap-6">
        <BackButton />
        <PageTitle>{isPending ? 'Занятие' : 'Занятие не найдено'}</PageTitle>
        <p className="rounded-[18px] border border-dashed border-line-strong bg-card p-6 font-bold text-ink-muted">
          {isPending
            ? 'Загружаем учеников…'
            : isError
              ? 'Не удалось загрузить занятие. Проверьте интернет.'
              : 'Занятие удалено или принадлежит другой группе.'}
        </p>
      </section>
    )
  }
  return <Sheet sheet={data} search={search} />
}

// ─── State shared by both layouts ───────────────────────────────────────────

interface SheetModel {
  sheet: LessonSheet
  state: LessonState
  roster: RosterRow[]
  marks: ReadonlyMap<string, Mark>
  counts: Tally
  /** Marks can be changed and the lesson held now (Б1: from the start; held — admin only, И4). */
  editable: boolean
  /** A held lesson: the admin corrects its marks / the teacher proposes new ones (#74). */
  correcting: boolean
  corrections: Corrections
  /** The admin's «Отменить проведение» of a held lesson (#95); null — not offered. */
  unconfirm: ReactNode
  /** The admin's «⋯ → Изменить занятие» (#94); null — not offered. */
  menu: ReactNode
  /** The marks are being sent — buttons wait for the database. */
  busy: boolean
  /** Offline: the confirm waits for the network (TanStack paused mutation). */
  paused: boolean
  canConfirm: boolean
  copy: ConfirmCopy
  /** Teacher's pay of the lesson by the students' subscriptions (К6); null — no percent on that date. */
  accrual: LessonAccrual | null
  /** Trials of this lesson (scheduled / marked) — outside every count and the payroll. */
  trials: Trial[]
  /** Trials can be marked: the lesson day has come and the lesson is not cancelled. */
  trialsMarkable: boolean
  setMark: (studentId: string, mark: Mark) => void
  allPresent: () => void
  confirm: () => void
  /** The admin's «Заморозка» set before the lesson, by student (#84). */
  presets: ReadonlyMap<string, PresetInfo>
  /** The admin may set a preset: a planned lesson not started yet (#84, И56). */
  canSetPreset: boolean
  /** The admin may remove a preset: until the lesson is held, a cancelled one too (И56). */
  canClearPreset: boolean
  presetBusy: boolean
  openPreset: (row: RosterRow) => void
  clearPreset: (row: RosterRow) => void
}

function Sheet({ sheet, search }: { sheet: LessonSheet; search: LessonSearch }) {
  const now = useNow()
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const router = useRouter()
  const { roles } = useSession()
  const mutation = useConfirmLesson(sheet.id, sheet.group.id)
  const trialRows = useQuery(trialsQuery({ lessonId: sheet.id }))
  useTrialsRealtime()
  const trials = useMemo(
    () => lessonTrials(trialRows.data ?? [], sheet.id),
    [trialRows.data, sheet.id],
  )

  const roster = useMemo(() => lessonRoster(sheet.enrollments, sheet, sheet.marks), [sheet])
  const isAdmin = roles.includes('admin')
  // Back to the screen the sheet was opened from, with its tab / month / filters (#72, #76, #89).
  // With an in-app history — history.back(), like «назад»: no second entry of the source, the
  // next system «назад» leaves it. The entry it lands on is replaced by the exact source when
  // they differ (the anchor of the next unconfirmed lesson, another screen before the sheet).
  // Without history (reload, a direct link) — replace the sheet by the source.
  const source = lessonSource(search)
  // no source: a teacher — «Сегодня»; an admin without the teacher role — the dashboard
  const sourceTarget = () =>
    source ?? (roles.includes('teacher') ? lessonReturn(search) : { to: '/admin' })
  // The sheet stops being what it was (#95 «Отменить проведение»): replace it by the source at
  // once — deterministic, no history.back() to wait for.
  const replaceBySource = () => {
    void navigate({ ...sourceTarget(), replace: true })
  }
  const returnToSource = () => {
    const target = sourceTarget()
    if (!router.history.canGoBack()) {
      void navigate({ ...target, replace: true })
      return
    }
    const sheetPath = router.history.location.pathname
    const { href } = router.buildLocation(target)
    const unsubscribe = router.history.subscribe(({ location }) => {
      if (location.pathname === sheetPath) return
      unsubscribe()
      if (location.href !== href) void navigate({ ...target, replace: true })
    })
    router.history.back()
  }
  const corrections = useCorrections(sheet, roster, isAdmin, source ? returnToSource : undefined)
  usePresetsRealtime(sheet.status === 'planned')
  const clearPresetMutation = useClearPreset()
  const [presetFor, setPresetFor] = useState<RosterRow | null>(null)
  const correcting = corrections.fix !== null
  // The draft outlives the page (И19, #29): restored from localStorage, dropped once the lesson
  // is held / cancelled — not on the optimistic «held», a failed confirm keeps it.
  const [draft, setDraftState] = useState<Map<string, Mark> | null>(() =>
    sheet.status === 'planned' ? loadDraft(sheet.id, roster, now) : null,
  )
  const setDraft = (next: Map<string, Mark>) => {
    setDraftState(next)
    saveDraft(sheet.id, next, now)
  }
  const settled = !mutation.isPending
  useEffect(() => {
    if (settled && sheet.status !== 'planned') clearDraft(sheet.id)
  }, [settled, sheet.id, sheet.status])
  const state = lessonState(sheet, now)
  const copy = confirmCopy(state)
  const editable = sheet.status === 'planned' && state !== 'upcoming'
  // #84: the admin's «Заморозка» set in advance fills students not marked yet (the teacher may change it)
  const own = editable ? (draft ?? sheet.marks) : sheet.marks
  const marks: ReadonlyMap<string, Mark> =
    corrections.fix ??
    (sheet.status === 'planned' ? applyPresets(own, sheet.presets, roster) : sheet.marks)
  const counts = tally(roster, marks)

  const percent = rateOn(sheet.rates, sheet.lesson_date)
  const accrual =
    percent !== null ? lessonAccrual(roster, marks, percent, sheet.hour_price ?? null) : null

  const model: SheetModel = {
    sheet,
    state,
    roster,
    marks,
    counts,
    editable,
    correcting,
    corrections,
    unconfirm:
      isAdmin && sheet.status === 'held' && !correcting ? (
        <UnconfirmLesson
          sheet={sheet}
          pendingRequests={corrections.pending ? 1 : 0}
          onDone={replaceBySource}
        />
      ) : null,
    menu: isAdmin && !correcting ? <LessonMenu sheet={sheet} /> : null,
    busy: mutation.isPending || corrections.busy,
    paused: mutation.isPaused,
    canConfirm: editable && counts.unmarked === 0 && !mutation.isPending,
    copy,
    accrual,
    trials,
    trialsMarkable: sheet.lesson_date <= bishkekDate(now) && sheet.status !== 'cancelled',
    presets: sheet.presets,
    canSetPreset: isAdmin && presetEditable(sheet, now),
    canClearPreset: isAdmin && presetClearable(sheet),
    presetBusy: clearPresetMutation.isPending,
    openPreset: setPresetFor,
    clearPreset: (row) => {
      clearPresetMutation.mutate({
        lessonId: sheet.id,
        studentId: row.studentId,
        name: row.fullName,
      })
    },
    setMark: (studentId, mark) => {
      if (!roster.some((r) => r.studentId === studentId)) return
      if (correcting) {
        corrections.setFixMark(studentId, mark)
        return
      }
      if (!editable || mutation.isPending) return
      setDraft(draftMarks(new Map(marks).set(studentId, mark), own, marks))
    },
    allPresent: () => {
      if (editable && !mutation.isPending)
        setDraft(draftMarks(markAllPresent(roster, marks), own, marks))
    },
    // Back to the list only after the database said held (#41, И27); a refusal leaves the sheet
    // and the draft as they are, the toast says why. Opened from «Мой месяц» — the same month and
    // group filter, scrolled to the next unconfirmed lesson (#72); from a group page — that group
    // on the same tab (#76, #89); from А2 — the same week; else «Сегодня».
    confirm: () => {
      mutation.mutate({ marks: marksPayload(roster, marks), copy }, { onSuccess: returnToSource })
    },
  }

  return (
    <>
      {isDesktop ? <DesktopSheet m={model} now={now} /> : <MobileSheet m={model} now={now} />}
      {presetFor && (
        <PresetDialog
          open
          onOpenChange={() => {
            setPresetFor(null)
          }}
          studentId={presetFor.studentId}
          studentName={presetFor.fullName}
          lessons={[
            {
              id: sheet.id,
              lesson_date: sheet.lesson_date,
              planned_start: sheet.planned_start,
              group: sheet.group,
            },
          ]}
        />
      )}
    </>
  )
}

/** «Сейчас · 14:00–15:00», «Проведено · 10:02», «Не подтверждено · 09:00–10:00». */
function stateChip(sheet: LessonSheet, state: LessonState, now: number): string {
  const range = timeRange(sheet)
  if (state === 'held') {
    return sheet.confirmed_at ? `Проведено · ${bishkekTime(sheet.confirmed_at)}` : 'Проведено'
  }
  if (state === 'current') return `Сейчас · ${range}`
  if (state === 'ended_unconfirmed') return `Не подтверждено · ${range}`
  if (state === 'cancelled') return 'Отменено'
  const until = untilLabel(sheet, now)
  return `${until.charAt(0).toUpperCase()}${until.slice(1)} · ${range}`
}

/** Why the marks cannot be changed now, null — they can. */
function lockedReason({ sheet, state, editable }: SheetModel): string | null {
  if (editable) return null
  if (state === 'upcoming') return 'Отметить можно с начала занятия'
  if (sheet.status === 'cancelled') return 'Занятие отменено — отметки не нужны'
  return 'Занятие проведено. Исправить отметки может администратор'
}

const som = (n: number) => `${formatSom(n)} сом`

// ─── Marks ──────────────────────────────────────────────────────────────────

const ACTIVE: Record<Mark, string> = {
  present: 'border-present bg-present text-white',
  absent_frozen: 'border-teal bg-teal text-white',
  absent_burned: 'border-burned bg-burned text-white',
}

const EDGE: Record<Mark, string> = {
  present: 'border-l-present',
  absent_frozen: 'border-l-teal',
  absent_burned: 'border-l-burned',
}

const TONE: Record<Tone, string> = {
  muted: 'text-ink-muted',
  warn: 'text-warn',
  debt: 'text-burned-strong',
}

/**
 * Initials flip into the colour of the mark — one of the three 3D accents (§3);
 * prefers-reduced-motion → a plain fade, no 3D.
 */
function MarkAvatar({
  row,
  mark,
  className,
}: {
  row: RosterRow
  mark: Mark | undefined
  className: string
}) {
  const reduce = useReducedMotion() ?? false
  const tone = mark ? ACTIVE[mark] : 'bg-brand text-ink'
  return (
    <span className="shrink-0" style={reduce ? undefined : { perspective: 400 }} aria-hidden>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={mark ?? 'none'}
          initial={reduce ? { opacity: 0 } : { rotateY: -180 }}
          animate={reduce ? { opacity: 1 } : { rotateY: 0 }}
          transition={{ duration: reduce ? 0.15 : 0.4, ease: 'easeOut' }}
          className={cn(
            'flex items-center justify-center rounded-full font-display font-bold [backface-visibility:hidden]',
            tone,
            className,
          )}
        >
          {row.initials}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function MarkButtons({
  m,
  row,
  desktop = false,
}: {
  m: SheetModel
  row: RosterRow
  desktop?: boolean
}) {
  const mark = m.marks.get(row.studentId)
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {MARKS.map((k) => {
        const active = mark === k
        return (
          <button
            key={k}
            type="button"
            aria-pressed={active}
            disabled={!(m.editable || m.correcting) || m.busy}
            onClick={() => {
              m.setMark(row.studentId, k)
            }}
            className={cn(
              'border-[1.5px] text-[13px] font-extrabold transition-opacity',
              desktop ? 'min-h-10 rounded-[10px]' : 'min-h-11 rounded-xl',
              active ? ACTIVE[k] : 'border-line-strong bg-card text-ink',
              !(m.editable || m.correcting) && !active && 'opacity-50',
            )}
          >
            {MARK_LABEL[k]}
          </button>
        )
      })}
    </div>
  )
}

/** #107: a student enrolled on the date of a held lesson without a mark — grey, colour + text. */
function UnmarkedBadge({ row, mark }: { row: RosterRow; mark: Mark | undefined }) {
  if (!row.unmarked || mark) return null
  return (
    <span className="shrink-0 rounded-full border border-line-strong bg-card px-2.5 py-1 text-xs font-extrabold whitespace-nowrap text-ink-muted">
      Не отмечен
    </span>
  )
}

/**
 * #84: «Админ: предупредил · комментарий» under the student; for the admin on a planned lesson —
 * «Предупредил о пропуске» / «Снять заморозку».
 */
function PresetNote({ m, row }: { m: SheetModel; row: RosterRow }) {
  const preset = m.presets.get(row.studentId)
  const action = preset ? m.canClearPreset : m.canSetPreset
  if (!preset && !action) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {preset && (
        <span className="text-xs font-extrabold text-teal-strong">{presetCaption(preset)}</span>
      )}
      {action && (
        <button
          type="button"
          disabled={m.presetBusy}
          onClick={() => {
            if (preset) m.clearPreset(row)
            else m.openPreset(row)
          }}
          className={cn(
            'min-h-11 text-xs font-extrabold min-[900px]:min-h-8',
            preset ? 'text-burned-strong' : 'text-teal',
          )}
        >
          {preset ? 'Снять заморозку' : 'Предупредил о пропуске'}
        </button>
      )}
    </div>
  )
}

// ─── У3 · phone ─────────────────────────────────────────────────────────────

function MobileSheet({ m, now }: { m: SheetModel; now: number }) {
  const { sheet, counts } = m
  const percent = counts.total ? Math.round((counts.marked / counts.total) * 100) : 100
  const caption = [
    formatDayLong(lessonStartMs(sheet)),
    GROUP_TYPE_LABEL[sheet.group.group_type].toLowerCase(),
    sheet.group.room ? `каб. ${sheet.group.room}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="flex flex-1 flex-col gap-3.5">
      <header className="-mx-5 -mt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))] flex flex-col gap-3 rounded-b-[28px] bg-brand px-5 pt-[max(1rem,calc(env(safe-area-inset-top)+0.75rem))] pb-3.5">
        <div className="flex items-center justify-between gap-2">
          <BackButton tone="brand" />
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate rounded-full bg-ink px-3 py-1.5 text-xs font-extrabold whitespace-nowrap text-brand">
              {stateChip(sheet, m.state, now)}
            </span>
            {m.menu}
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[22px] leading-[1.15] font-bold">
            {sheet.group.subject} · {sheet.group.name}
          </h1>
          <p className="text-[13px] font-bold text-ink/75">{caption}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-2 flex-1 overflow-hidden rounded bg-ink/12">
            <div
              className="h-2 origin-left rounded bg-ink transition-transform"
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          </div>
          <p className="text-[13px] font-extrabold whitespace-nowrap">
            <span>
              {counts.marked} из {counts.total}
            </span>
            <span>{trialsSuffix(m.trials.length)}</span>
          </p>
        </div>
      </header>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold">Ученики</h2>
        {m.editable && (
          <button
            type="button"
            disabled={m.busy}
            onClick={m.allPresent}
            className="min-h-11 rounded-full border border-line bg-card px-3.5 text-xs font-extrabold"
          >
            Все были
          </button>
        )}
      </div>

      {m.roster.length === 0 ? (
        <p className="rounded-[18px] border border-dashed border-line-strong bg-card p-5 text-sm font-bold text-ink-muted">
          В группе на эту дату нет учеников.
        </p>
      ) : (
        <ul aria-label="Ученики" className="flex flex-col gap-2.5">
          {m.roster.map((row) => (
            <MobileStudent key={row.studentId} m={m} row={row} />
          ))}
        </ul>
      )}
      <MobileTrials trials={m.trials} markable={m.trialsMarkable} />

      <footer className="sticky bottom-0 -mx-5 mt-auto -mb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col gap-2.5 border-t border-line bg-card px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <p className="flex justify-between text-[13px] font-extrabold">
          <span className="text-present-strong">Был {counts.present}</span>
          <span className="text-teal-strong">Заморозка {counts.frozen}</span>
          <span className="text-burned-strong">Не был {counts.burned}</span>
          <span className="text-ink-muted">Не отмечено {counts.unmarked}</span>
        </p>
        {m.sheet.status === 'held' ? (
          <HeldPanel c={m.corrections} unconfirm={m.unconfirm} />
        ) : (
          <ConfirmAction m={m} />
        )}
      </footer>
    </section>
  )
}

function MobileStudent({ m, row }: { m: SheetModel; row: RosterRow }) {
  const mark = m.marks.get(row.studentId)
  const meta = mobileMeta(row)
  return (
    <li
      aria-label={row.fullName}
      className={cn(
        'flex flex-col gap-2.5 rounded-[18px] border border-l-[5px] border-line bg-card py-3 pr-3 pl-3.5',
        mark ? EDGE[mark] : 'border-l-line',
        row.unmarked && !mark && 'bg-stone',
      )}
    >
      <div className="flex items-center gap-3">
        <MarkAvatar row={row} mark={mark} className="size-10 text-[13px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-extrabold">{row.fullName}</span>
          <span className={cn('text-xs font-bold', TONE[meta.tone])}>{meta.text}</span>
        </div>
        <UnmarkedBadge row={row} mark={mark} />
      </div>
      <MarkButtons m={m} row={row} />
      <PresetNote m={m} row={row} />
    </li>
  )
}

function ConfirmAction({ m, desktop = false }: { m: SheetModel; desktop?: boolean }) {
  const reason = lockedReason(m)
  const size = desktop ? 'min-h-[52px] rounded-2xl text-sm' : 'min-h-14 rounded-[18px] text-[15px]'
  if (reason || !m.canConfirm) {
    return (
      <p
        className={cn(
          'flex items-center justify-center bg-line px-4 text-center font-extrabold text-ink-muted',
          size,
        )}
      >
        {reason ?? (m.busy ? (m.paused ? m.copy.waiting : m.copy.busy) : m.copy.hint)}
      </p>
    )
  }
  return (
    <button
      type="button"
      onClick={m.confirm}
      className={cn(
        'flex items-center justify-center gap-2.5 bg-ink font-extrabold text-brand shadow-cta',
        size,
        !desktop && 'text-base',
      )}
    >
      <Check className="size-5" strokeWidth={3} aria-hidden />
      {m.copy.action}
    </button>
  )
}

// ─── УД2 · desktop ──────────────────────────────────────────────────────────

const COLS = 'grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_300px] gap-3 px-5'

function DesktopSheet({ m, now }: { m: SheetModel; now: number }) {
  const { sheet } = m
  const caption = [
    formatDayLong(lessonStartMs(sheet)),
    GROUP_TYPE_LABEL[sheet.group.group_type].toLowerCase(),
    `${studentsWord(m.roster.length)}${m.trials.length > 0 ? ` + ${trialsWord(m.trials.length)}` : ''}`,
    sheet.group.room ? `каб. ${sheet.group.room}` : null,
    m.accrual?.perStudentLesson != null
      ? `${som(m.accrual.perStudentLesson)} за ученико-урок`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="flex flex-col gap-[22px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <BackButton />
          <div className="flex flex-wrap items-center gap-3.5">
            <PageTitle className="min-[900px]:text-[28px]">
              {sheet.group.subject} · {sheet.group.name}
            </PageTitle>
            <span className="inline-flex items-center gap-2 rounded-full bg-ink px-3.5 py-[7px] text-[13px] font-extrabold whitespace-nowrap text-brand">
              <span className="size-2 rounded-full bg-brand" aria-hidden />
              {stateChip(sheet, m.state, now)}
            </span>
            {m.menu}
          </div>
          <p className="text-sm font-bold text-ink-muted">{caption}</p>
        </div>
        {m.editable && (
          <button
            type="button"
            disabled={m.busy}
            onClick={m.allPresent}
            className="min-h-11 rounded-xl border-[1.5px] border-line-strong bg-card px-4 text-[13px] font-extrabold"
          >
            Все были
          </button>
        )}
      </header>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] items-start gap-6">
        <div className="flex flex-col rounded-[20px] border border-line bg-card">
          <div
            className={cn(
              COLS,
              'border-b border-line py-3 text-[11px] font-extrabold tracking-[0.06em] text-ink-muted uppercase',
            )}
          >
            <span>Ученик</span>
            <span>Абонемент</span>
            <span>Отметка</span>
          </div>
          {m.roster.length === 0 ? (
            <p className="p-5 text-sm font-bold text-ink-muted">
              В группе на эту дату нет учеников.
            </p>
          ) : (
            <ul aria-label="Ученики">
              {m.roster.map((row) => (
                <DesktopStudent key={row.studentId} m={m} row={row} />
              ))}
            </ul>
          )}
          <DesktopTrials trials={m.trials} markable={m.trialsMarkable} />
        </div>
        <Summary m={m} />
      </div>
    </section>
  )
}

function DesktopStudent({ m, row }: { m: SheetModel; row: RosterRow }) {
  const mark = m.marks.get(row.studentId)
  const meta = desktopMeta(row)
  return (
    <li
      aria-label={row.fullName}
      className={cn(
        COLS,
        'items-center border-b border-l-[5px] border-b-line py-3 last:rounded-bl-[20px] last:border-b-0',
        mark ? EDGE[mark] : 'border-l-line',
        row.unmarked && !mark && 'bg-stone',
      )}
    >
      <span className="flex items-center gap-3">
        <MarkAvatar row={row} mark={mark} className="size-9 text-xs" />
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span className="text-[15px] font-extrabold">{row.fullName}</span>
          <UnmarkedBadge row={row} mark={mark} />
        </span>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className={cn('text-[13px] font-bold', TONE[meta.tone])}>{meta.text}</span>
        <PresetNote m={m} row={row} />
      </span>
      <MarkButtons m={m} row={row} desktop />
    </li>
  )
}

function Summary({ m }: { m: SheetModel }) {
  const { counts } = m
  const percent = counts.total ? Math.round((counts.marked / counts.total) * 100) : 100
  const lines: [string, ReactNode, string?][] = [
    ['Был', counts.present, 'text-present-strong'],
    ['Заморозка', counts.frozen, 'text-teal-strong'],
    ['Не был (сгорел)', counts.burned, 'text-burned-strong'],
  ]
  return (
    <aside className="sticky top-6 flex flex-col gap-3.5">
      <div className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-card p-5">
        <h2 className="text-sm font-extrabold">Итог занятия</h2>
        <div className="h-2 overflow-hidden rounded bg-line">
          <div
            className="h-2 origin-left rounded bg-ink transition-transform"
            style={{ transform: `scaleX(${percent / 100})` }}
          />
        </div>
        <p className="text-[13px] font-bold text-ink-muted">
          <span>
            Отмечено {counts.marked} из {counts.total}
          </span>
          <span>{trialsSuffix(m.trials.length)}</span>
        </p>
        <dl className="flex flex-col gap-2 text-sm font-extrabold">
          {lines.map(([label, value, tone]) => (
            <div key={label} className="flex justify-between">
              <dt className={tone}>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-2">
            <dt>В ЗП (был + не был)</dt>
            <dd>{counts.studentLessons}</dd>
          </div>
          {m.accrual && (
            <div className="flex justify-between">
              <dt>{m.sheet.status === 'held' ? 'Начислено' : 'Начислится'}</dt>
              <dd className="font-display">{som(m.accrual.pay)}</dd>
            </div>
          )}
          {m.accrual && <p className="text-[11px] font-bold text-ink-muted">{PRELIMINARY_NOTE}</p>}
        </dl>
        {m.sheet.status === 'held' ? (
          <HeldPanel c={m.corrections} unconfirm={m.unconfirm} />
        ) : (
          <ConfirmAction m={m} desktop />
        )}
      </div>
      <p className="rounded-2xl bg-stone px-4 py-3.5 text-xs leading-normal font-bold text-ink-muted">
        Заморозка — ученик предупредил за день или минимум за 2 часа. Сгоревший урок списывается и
        начисляется учителю.
      </p>
    </aside>
  )
}
