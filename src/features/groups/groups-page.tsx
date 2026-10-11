import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader, PageTitle } from '@/components/page'
import { FormDialog } from '@/features/students/parts'
import { cardClass, numClass, tdClass, thClass } from '@/features/tariffs/parts'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { groupsQuery } from './api'
import { filterGroups, groupListRows, listCaption, type GroupListRow, type GroupTab } from './model'
import { NewGroupForm } from './new-group-form'
import { GroupStatusChip, Segmented } from './parts'
import { useEnsureLessons } from './use-ensure-lessons'

const TABS: { value: GroupTab; label: string }[] = [
  { value: 'active', label: 'Активные' },
  { value: 'forming', label: 'Набор' },
  { value: 'archived', label: 'Архив' },
]

// А3 Группы (docs/design/AdminGroups.dc.html). Phone: same route, table → cards,
// «Новая группа» opens in a dialog.
export function GroupsPage({
  search,
  onSearchChange,
}: {
  search: { q?: string; tab?: GroupTab }
  onSearchChange: (next: { q?: string; tab?: GroupTab }) => void
}) {
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const now = useNow()
  const today = bishkekDate(now)
  const query = useQuery(groupsQuery())
  const data = query.data
  const [creating, setCreating] = useState(false)
  useEnsureLessons(today)

  const rows = useMemo(
    () => (data ? groupListRows(data.groups, data.tariffs, today) : []),
    [data, today],
  )
  const tab = search.tab ?? 'active'
  const shown = useMemo(() => filterGroups(rows, tab, search.q ?? ''), [rows, tab, search.q])
  const caption = data ? listCaption(rows) : ' '

  const set = (patch: { q?: string; tab?: GroupTab }) => {
    const next = { ...search, ...patch }
    onSearchChange({
      q: next.q || undefined,
      tab: next.tab && next.tab !== 'active' ? next.tab : undefined,
    })
  }
  const openGroup = (groupId: string) => {
    setCreating(false)
    void navigate({ to: '/admin/groups/$groupId', params: { groupId } })
  }

  const searchBox = (
    <div
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 focus-within:border-ink',
        isDesktop ? 'w-[260px]' : 'w-full',
      )}
    >
      <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={2.5} aria-hidden />
      <input
        type="search"
        aria-label="Поиск группы"
        placeholder="Поиск по названию, учителю"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:font-semibold placeholder:text-placeholder min-[900px]:text-sm"
        value={search.q ?? ''}
        onChange={(e) => {
          set({ q: e.target.value })
        }}
      />
    </div>
  )
  const tabs = (
    <Segmented
      label="Статус группы"
      options={TABS}
      value={tab}
      onChange={(next) => {
        set({ tab: next })
      }}
      className={isDesktop ? undefined : 'w-full'}
    />
  )

  const list = query.isPending ? (
    <div className={cn(cardClass, 'h-64 animate-pulse')} aria-label="Загрузка" />
  ) : query.isError ? (
    <p role="alert" className={cn(cardClass, 'p-5 font-bold text-burned')}>
      Не удалось загрузить группы. Проверьте интернет и обновите страницу.
    </p>
  ) : shown.length === 0 ? (
    <p className={cn(cardClass, 'p-5 font-bold text-ink-muted')}>
      {search.q ? 'Ничего не нашли' : 'Здесь пока нет групп'}
    </p>
  ) : isDesktop ? (
    <GroupsTable rows={shown} />
  ) : (
    <GroupCards rows={shown} />
  )

  if (isDesktop) {
    return (
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-extrabold tracking-[0.06em] text-ink-muted uppercase">
              {caption}
            </p>
            <PageTitle>Группы</PageTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {searchBox}
            {tabs}
          </div>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-6">
          {list}
          <aside className={cn(cardClass, 'sticky top-6 flex flex-col gap-3.5 p-[22px]')}>
            <h2 className="font-display text-base font-bold">Новая группа</h2>
            {data && <NewGroupForm data={data} today={today} onCreated={openGroup} />}
          </aside>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow={caption} title="Группы" />
      <div className="flex flex-col gap-2.5">
        {searchBox}
        <div className="flex gap-2">
          {tabs}
          <button
            type="button"
            disabled={!data}
            onClick={() => {
              setCreating(true)
            }}
            className="min-h-11 shrink-0 rounded-xl bg-ink px-4 text-[13px] font-extrabold whitespace-nowrap text-brand disabled:opacity-50"
          >
            + Новая
          </button>
        </div>
      </div>
      {list}
      {creating && data && (
        <FormDialog
          open={creating}
          onOpenChange={setCreating}
          title="Новая группа"
          description="Расписание и занятия на 8 недель вперёд создаются сразу"
        >
          <NewGroupForm data={data} today={today} onCreated={openGroup} />
        </FormDialog>
      )}
    </div>
  )
}

const seats = (r: GroupListRow) =>
  r.maxStudents === null ? String(r.students) : `${r.students} / ${r.maxStudents}`

function GroupsTable({ rows }: { rows: GroupListRow[] }) {
  return (
    <div className={cn(cardClass, 'overflow-x-auto')}>
      <table className="w-full min-w-[520px] border-collapse" aria-label="Группы">
        <thead>
          <tr className="border-b border-line">
            <th className={thClass}>Группа</th>
            <th className={thClass}>Учитель</th>
            <th className={thClass}>Расписание</th>
            <th className={cn(thClass, 'text-right')}>Ученики</th>
            <th className={thClass}>Статус</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={cn('[&:last-child>td]:border-0', r.status === 'forming' && 'bg-accent')}
            >
              <td className={tdClass}>
                <Link
                  to="/admin/groups/$groupId"
                  params={{ groupId: r.id }}
                  className="font-extrabold text-ink"
                >
                  {r.label}
                </Link>
                <div className="text-xs font-bold text-ink-muted">{r.tariffCaption}</div>
              </td>
              <td className={tdClass}>{r.teacher}</td>
              <td className={cn(tdClass, 'font-bold whitespace-nowrap text-teal')}>
                {r.schedule || '—'}
              </td>
              <td className={cn(tdClass, numClass)}>{seats(r)}</td>
              <td className={tdClass}>
                <GroupStatusChip status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupCards({ rows }: { rows: GroupListRow[] }) {
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Группы">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            to="/admin/groups/$groupId"
            params={{ groupId: r.id }}
            className={cn(
              cardClass,
              'flex flex-col gap-1.5 rounded-[18px] px-4 py-3.5',
              r.status === 'forming' && 'bg-accent',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-extrabold text-ink">{r.label}</span>
              <GroupStatusChip status={r.status} />
            </div>
            <div className="text-[13px] font-bold text-ink-muted">
              {r.tariffCaption} · {r.teacher}
            </div>
            <div className="flex items-baseline justify-between gap-3 text-[13px] font-bold">
              <span className="text-teal">{r.schedule || '—'}</span>
              <span className="whitespace-nowrap tabular-nums">{seats(r)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
