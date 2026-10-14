// А10 «Журнал изменений» (docs/design/AuditLog.dc.html): admin, and the accountant read-only (#45).
// A feed of v_audit_feed, newest first, 50 at a time; chips — the kind, selects — table / author /
// period, the search box «Ученик, группа, учитель…» (server-side, #52), all in the URL. On the phone
// (no artboard) the same rows become cards under the day bands.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PageHeader, PageTitle } from '@/components/page'
import { NativeSelect } from '@/features/students/parts'
import { useSession } from '@/lib/auth'
import { hasRole } from '@/lib/roles'
import { useNow } from '@/lib/now'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { auditActorsQuery, auditCountsQuery, auditFeedQuery, type KindCounts } from './api'
import {
  authorShort,
  bishkekTime,
  describeAuditRow,
  ENTITY_LABEL,
  KIND_LABEL,
  type AuditEntry,
  type AuditKind,
  type BadgeTone,
  type Part,
} from './describe'
import {
  groupByDay,
  KINDS,
  PERIOD_LABEL,
  PERIODS,
  periodStart,
  searchKey,
  SYSTEM_ACTOR,
  type Period,
} from './model'

export interface AuditSearch {
  kind?: AuditKind
  entity?: string
  actor?: string
  period?: Period
  q?: string
}

export const DEFAULT_PERIOD: Period = '7d'
/** The search goes to the server once typing pauses. */
const SEARCH_DELAY_MS = 300

export function AuditPage({
  search,
  onSearchChange,
}: {
  search: AuditSearch
  onSearchChange: (next: AuditSearch) => void
}) {
  const isDesktop = useIsDesktop()
  const now = useNow()
  const { roles } = useSession()
  const canOpen = hasRole(roles, 'admin')
  const period = search.period ?? DEFAULT_PERIOD
  // the period starts at a Bishkek midnight: the key changes once a day, not every tick
  const since = periodStart(period, now)
  const base = {
    entity: search.entity ?? null,
    actor: search.actor ?? null,
    since,
    q: searchKey(search.q),
  }

  const feed = useInfiniteQuery(auditFeedQuery({ ...base, kind: search.kind ?? null }))
  const counts = useQuery(auditCountsQuery(base))
  const actors = useQuery(auditActorsQuery())

  const profiles = useMemo(
    () => Object.fromEntries((actors.data ?? []).map((p) => [p.id, p.full_name])),
    [actors.data],
  )
  const entries = useMemo(
    () =>
      (feed.data?.pages ?? []).flatMap((page) =>
        page.rows.map((row) => describeAuditRow(row, { ...page.lookups, profiles })),
      ),
    [feed.data, profiles],
  )
  const days = groupByDay(entries, now)

  const set = (patch: AuditSearch) => {
    onSearchChange({ ...search, ...patch })
  }

  const filters = (
    <div className="grid grid-cols-2 gap-2 min-[900px]:flex min-[900px]:flex-wrap">
      <SearchBox
        value={search.q ?? ''}
        onChange={(q) => {
          set({ q: q.trim() === '' ? undefined : q })
        }}
      />
      <NativeSelect
        aria-label="Таблица"
        className="min-[900px]:w-48"
        value={search.entity ?? ''}
        onChange={(e) => {
          set({ entity: e.target.value || undefined })
        }}
      >
        <option value="">Все таблицы</option>
        {Object.entries(ENTITY_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label="Кто"
        className="min-[900px]:w-52"
        value={search.actor ?? ''}
        onChange={(e) => {
          set({ actor: e.target.value || undefined })
        }}
      >
        <option value="">Все пользователи</option>
        {(actors.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
        <option value={SYSTEM_ACTOR}>Система</option>
      </NativeSelect>
      <NativeSelect
        aria-label="Период"
        className="col-span-2 min-[900px]:w-36"
        value={period}
        onChange={(e) => {
          const next = e.target.value as Period
          set({ period: next === DEFAULT_PERIOD ? undefined : next })
        }}
      >
        {PERIODS.map((p) => (
          <option key={p} value={p}>
            {PERIOD_LABEL[p]}
          </option>
        ))}
      </NativeSelect>
    </div>
  )

  let body: ReactNode
  if (feed.isError) {
    body = <Notice>Не удалось загрузить журнал. Проверьте интернет — обновим сами.</Notice>
  } else if (!feed.data) {
    body = <Notice>Загружаем журнал…</Notice>
  } else if (entries.length === 0) {
    body = (
      <Notice>
        {base.q
          ? `По «${search.q?.trim() ?? ''}» ничего не нашли.`
          : 'За этот период изменений нет.'}
      </Notice>
    )
  } else {
    body = (
      <div
        className={cn(
          'flex flex-col',
          isDesktop && 'overflow-hidden rounded-[20px] border border-line bg-card',
          // the previous search's rows while the new answer is on its way
          feed.isPlaceholderData && 'opacity-60',
        )}
        aria-label="Изменения"
        role="feed"
        aria-busy={feed.isFetching}
      >
        {days.map((d) => (
          <section key={d.day} aria-label={d.title} className="flex flex-col">
            <h2
              className={cn(
                'text-xs font-extrabold text-ink-muted',
                isDesktop ? 'bg-band px-5 py-2.5' : 'px-1 pt-3 pb-2',
              )}
            >
              {d.title}
            </h2>
            {isDesktop ? (
              d.entries.map((e) => <DesktopRow key={e.id} entry={e} canOpen={canOpen} />)
            ) : (
              <ul className="flex flex-col gap-2">
                {d.entries.map((e) => (
                  <MobileCard key={e.id} entry={e} canOpen={canOpen} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-4 min-[900px]:gap-5">
      {isDesktop ? (
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-extrabold tracking-[0.06em] text-ink-muted uppercase">
              Кто, что и когда изменил · ничего не удаляется
            </p>
            <PageTitle>Журнал изменений</PageTitle>
          </div>
          {filters}
        </header>
      ) : (
        <>
          <PageHeader eyebrow="Ничего не удаляется" title="Журнал изменений" />
          {filters}
        </>
      )}

      <KindChips
        active={search.kind ?? null}
        counts={counts.data}
        onChange={(kind) => {
          set({ kind: kind ?? undefined })
        }}
      />

      {body}

      {feed.hasNextPage && (
        <button
          type="button"
          onClick={() => void feed.fetchNextPage()}
          disabled={feed.isFetchingNextPage}
          className="mx-auto min-h-11 rounded-xl px-5 text-[13px] font-bold text-ink-muted hover:text-ink disabled:opacity-50"
        >
          {feed.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
        </button>
      )}
    </section>
  )
}

/** «Ученик, группа, учитель…»: typed locally, sent to the URL (and the server) after a pause. */
function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value)
  const sent = useRef(value)
  const change = useRef(onChange)
  useEffect(() => {
    change.current = onChange
  })
  // the URL changed from outside (back, a link, the reset) — show it; our own writes are skipped,
  // so a reply to «ал» never overwrites «али» typed meanwhile
  useEffect(() => {
    if (value !== sent.current) {
      sent.current = value
      setText(value)
    }
  }, [value])
  useEffect(() => {
    if (text.trim() === sent.current.trim()) return
    const timer = setTimeout(() => {
      sent.current = text.trim() === '' ? '' : text
      change.current(text)
    }, SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [text])

  return (
    <div className="col-span-2 flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 focus-within:border-ink min-[900px]:w-[260px]">
      <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={2.5} aria-hidden />
      <input
        type="search"
        aria-label="Поиск по журналу"
        placeholder="Ученик, группа, учитель…"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:font-semibold placeholder:text-placeholder min-[900px]:text-sm"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
        }}
      />
    </div>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[18px] border border-dashed border-line-strong bg-card p-5 text-sm font-bold text-ink-muted">
      {children}
    </p>
  )
}

// ─── Chips: «Все · 214», «Правки задним числом · 6»… ─────────────────────────

const CHIP_IDLE: Record<AuditKind | 'all', string> = {
  all: 'border-[1.5px] border-line-strong bg-card text-ink-muted',
  retro: 'bg-burned-soft text-burned-deep',
  late: 'bg-warn-soft text-warn-strong',
  payment: 'border-[1.5px] border-line-strong bg-card text-ink-muted',
  attendance: 'border-[1.5px] border-line-strong bg-card text-ink-muted',
  other: 'border-[1.5px] border-line-strong bg-card text-ink-muted',
}

function KindChips({
  active,
  counts,
  onChange,
}: {
  active: AuditKind | null
  counts: KindCounts | undefined
  onChange: (kind: AuditKind | null) => void
}) {
  const chips: [AuditKind | null, string][] = [
    [null, 'Все'],
    ...KINDS.map((k): [AuditKind, string] => [k, KIND_LABEL[k]]),
  ]
  return (
    <div
      role="group"
      aria-label="Тип изменений"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 min-[900px]:mx-0 min-[900px]:flex-wrap min-[900px]:px-0"
    >
      {chips.map(([kind, label]) => {
        const pressed = active === kind
        const count = counts?.[kind ?? 'all']
        return (
          <button
            key={kind ?? 'all'}
            type="button"
            aria-pressed={pressed}
            onClick={() => {
              onChange(kind)
            }}
            className={cn(
              'min-h-9 shrink-0 rounded-full px-3.5 text-[13px] font-extrabold whitespace-nowrap',
              pressed ? 'bg-ink text-brand' : CHIP_IDLE[kind ?? 'all'],
            )}
          >
            {label}
            {count !== undefined && ` · ${count}`}
          </button>
        )
      })}
    </div>
  )
}

// ─── Rows ───────────────────────────────────────────────────────────────────

const BADGE: Record<BadgeTone, string> = {
  present: 'bg-present-soft text-present-strong',
  burned: 'bg-burned-soft text-burned-deep',
  warn: 'bg-warn-soft text-warn-strong',
  stone: 'bg-stone text-ink-muted',
  teal: 'bg-teal-soft text-teal-strong',
  trial: 'bg-trial-soft text-trial-strong',
}

const ROW_TINT: Partial<Record<AuditKind, string>> = {
  retro: 'bg-burned-tint',
  late: 'bg-warn-tint',
}

function Badge({ entry }: { entry: AuditEntry }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-1 text-xs leading-[1.3] font-extrabold whitespace-nowrap',
        BADGE[entry.badge.tone],
      )}
    >
      {entry.badge.label}
    </span>
  )
}

const PART_TONE = {
  present: 'text-present-strong',
  burned: 'text-burned-strong',
  frozen: 'text-teal-strong',
} as const

function Text({ parts }: { parts: Part[] }) {
  return parts.map((p, i) =>
    typeof p === 'string' ? (
      p
    ) : (
      <span key={i} className={cn(p.strong && 'font-extrabold', p.tone && PART_TONE[p.tone])}>
        {p.text}
      </span>
    ),
  )
}

function ObjectLink({ entry }: { entry: AuditEntry }) {
  const link = entry.link
  if (!link) return null
  const className = 'text-xs font-extrabold whitespace-nowrap text-teal hover:text-teal-strong'
  switch (link.to) {
    case '/admin/groups/$groupId':
      return (
        <Link to={link.to} params={link.params} className={className}>
          {link.label} →
        </Link>
      )
    case '/admin/students/$studentId':
      return (
        <Link to={link.to} params={link.params} className={className}>
          {link.label} →
        </Link>
      )
    default:
      return (
        <Link to={link.to} className={className}>
          {link.label} →
        </Link>
      )
  }
}

function Details({ entry, canOpen }: { entry: AuditEntry; canOpen: boolean }) {
  return (
    <div className="min-w-0 text-sm leading-normal font-bold">
      <Text parts={entry.parts} />
      {entry.note && <div className="mt-1 text-xs text-ink-muted">{entry.note}</div>}
      {canOpen && entry.link && (
        <div className="mt-1">
          <ObjectLink entry={entry} />
        </div>
      )}
    </div>
  )
}

function DesktopRow({ entry, canOpen }: { entry: AuditEntry; canOpen: boolean }) {
  return (
    <article
      aria-label={`${bishkekTime(entry.at)} ${entry.badge.label}`}
      className={cn(
        'grid grid-cols-[70px_150px_minmax(0,1fr)_120px] items-start gap-3.5 border-b border-line px-5 py-3.5 last:border-b-0',
        ROW_TINT[entry.kind],
      )}
    >
      <div className="font-display text-[13px] font-bold">{bishkekTime(entry.at)}</div>
      <div>
        <Badge entry={entry} />
      </div>
      <Details entry={entry} canOpen={canOpen} />
      <div className="truncate text-[13px] font-bold text-ink-muted" title={entry.author}>
        {authorShort(entry.author)}
      </div>
    </article>
  )
}

function MobileCard({ entry, canOpen }: { entry: AuditEntry; canOpen: boolean }) {
  return (
    <li>
      <article
        aria-label={`${bishkekTime(entry.at)} ${entry.badge.label}`}
        className={cn(
          'flex flex-col gap-2 rounded-2xl border border-line bg-card p-3.5',
          ROW_TINT[entry.kind],
        )}
      >
        <div className="flex items-center gap-2.5">
          <span className="font-display text-[13px] font-bold">{bishkekTime(entry.at)}</span>
          <Badge entry={entry} />
          <span className="ml-auto truncate text-xs font-bold text-ink-muted" title={entry.author}>
            {authorShort(entry.author)}
          </span>
        </div>
        <Details entry={entry} canOpen={canOpen} />
      </article>
    </li>
  )
}
