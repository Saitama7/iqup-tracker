import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader, PageTitle } from '@/components/page'
import { cardClass, numClass, tdClass, thClass } from '@/features/tariffs/parts'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { studentsQuery } from './api'
import {
  displayPhone,
  enrollableGroups,
  filterRows,
  groupLabel,
  listCaption,
  studentListRows,
  type GroupBrief,
  type StudentFilter,
  type StudentListRow,
} from './model'
import { NativeSelect, StatusChip } from './parts'
import { StudentFormDialog } from './student-form-dialog'

const chipBase =
  'inline-flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-extrabold whitespace-nowrap'

// А5 Ученики (docs/design/AdminStudents.dc.html). Phone: same route, table → cards.
// R1: no payments yet — «Оплата», «Долг» and the debt chips come with R2 (issue #8 «Не делать»).
export function StudentsPage({
  search,
  onSearchChange,
}: {
  search: StudentFilter
  onSearchChange: (next: StudentFilter) => void
}) {
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const query = useQuery(studentsQuery())
  const data = query.data
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => (data ? studentListRows(data) : []), [data])
  const groups = useMemo(() => (data ? enrollableGroups(data.groups) : []), [data])
  const shown = useMemo(() => filterRows(rows, search), [rows, search])
  const caption = data ? listCaption(rows) : ' '

  const set = (patch: StudentFilter) => {
    const next = { ...search, ...patch }
    onSearchChange({ q: next.q || undefined, group: next.group || undefined })
  }

  const searchBox = (
    <div
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 focus-within:border-ink',
        isDesktop ? 'w-[300px]' : 'w-full',
      )}
    >
      <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={2.5} aria-hidden />
      <input
        type="search"
        aria-label="Поиск ученика"
        placeholder="Имя ученика или телефон родителя"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:font-semibold placeholder:text-placeholder min-[900px]:text-sm"
        value={search.q ?? ''}
        onChange={(e) => {
          set({ q: e.target.value })
        }}
      />
    </div>
  )
  const newButton = (
    <button
      type="button"
      onClick={() => {
        setCreating(true)
      }}
      className="min-h-11 shrink-0 rounded-xl bg-ink px-4 text-[13px] font-extrabold whitespace-nowrap text-brand"
    >
      + Новый ученик
    </button>
  )

  return (
    <div className="flex flex-col gap-5">
      {isDesktop ? (
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-extrabold tracking-[0.06em] text-ink-muted uppercase">
              {caption}
            </p>
            <PageTitle>Ученики</PageTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {searchBox}
            {newButton}
          </div>
        </header>
      ) : (
        <>
          <PageHeader eyebrow={caption} title="Ученики" />
          <div className="flex flex-col gap-2.5">
            {searchBox}
            <div className="flex gap-2">
              <GroupFilter
                groups={groups}
                value={search.group}
                onChange={(group) => {
                  set({ group })
                }}
                className="flex-1"
              />
              {newButton}
            </div>
          </div>
        </>
      )}

      {isDesktop && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={!search.group}
            onClick={() => {
              set({ group: undefined })
            }}
            className={cn(
              chipBase,
              !search.group
                ? 'bg-ink text-brand'
                : 'border-[1.5px] border-line-strong bg-card text-ink-muted',
            )}
          >
            Все · {rows.length}
          </button>
          <GroupFilter
            groups={groups}
            value={search.group}
            onChange={(group) => {
              set({ group })
            }}
            className="w-64"
          />
        </div>
      )}

      {query.isPending ? (
        <div className={cn(cardClass, 'h-64 animate-pulse')} aria-label="Загрузка" />
      ) : query.isError ? (
        <p role="alert" className={cn(cardClass, 'p-5 font-bold text-burned')}>
          Не удалось загрузить учеников. Проверьте интернет и обновите страницу.
        </p>
      ) : shown.length === 0 ? (
        <p className={cn(cardClass, 'p-5 font-bold text-ink-muted')}>
          {rows.length === 0 ? 'Учеников пока нет' : 'Никого не нашли'}
        </p>
      ) : isDesktop ? (
        <StudentsTable rows={shown} />
      ) : (
        <StudentCards rows={shown} />
      )}

      {creating && data && (
        <StudentFormDialog
          open={creating}
          onOpenChange={setCreating}
          students={data.students}
          onSaved={(studentId) => {
            void navigate({ to: '/admin/students/$studentId', params: { studentId } })
          }}
        />
      )}
    </div>
  )
}

function GroupFilter({
  groups,
  value,
  onChange,
  className,
}: {
  groups: readonly GroupBrief[]
  value: string | undefined
  onChange: (group: string | undefined) => void
  className?: string
}) {
  return (
    <NativeSelect
      aria-label="Группа"
      className={className}
      value={value ?? ''}
      onChange={(e) => {
        onChange(e.target.value || undefined)
      }}
    >
      <option value="">Все группы</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {groupLabel(g)}
        </option>
      ))}
    </NativeSelect>
  )
}

function StudentsTable({ rows }: { rows: StudentListRow[] }) {
  return (
    <div className={cn(cardClass, 'overflow-x-auto')}>
      <table className="w-full min-w-[900px] border-collapse" aria-label="Ученики">
        <thead>
          <tr className="border-b border-line">
            <th className={thClass}>Ученик</th>
            <th className={thClass}>Класс</th>
            <th className={thClass}>Группы</th>
            <th className={thClass}>Родитель</th>
            <th className={cn(thClass, 'text-right')}>Осталось уроков</th>
            <th className={thClass}>Статус</th>
            <th className={thClass}>
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={cn('[&:last-child>td]:border-0', r.status === 'exhausted' && 'bg-accent')}
            >
              <td className={tdClass}>
                <Link
                  to="/admin/students/$studentId"
                  params={{ studentId: r.id }}
                  className="font-extrabold text-ink"
                >
                  {r.fullName}
                </Link>
              </td>
              <td className={tdClass}>{r.grade ?? '—'}</td>
              <td className={tdClass}>{r.groups || <span className="text-ink-muted">—</span>}</td>
              <td className={cn(tdClass, 'whitespace-nowrap text-ink-muted')}>
                {displayPhone(r.parentPhone) ?? '—'}
              </td>
              <td
                className={cn(
                  tdClass,
                  numClass,
                  r.status === 'exhausted' && 'font-extrabold text-warn',
                )}
              >
                {r.remaining || <span className="text-ink-muted">—</span>}
              </td>
              <td className={tdClass}>
                <StatusChip status={r.status} />
              </td>
              <td className={tdClass}>
                <Link
                  to="/admin/students/$studentId"
                  params={{ studentId: r.id }}
                  className="text-xs font-extrabold whitespace-nowrap text-teal"
                  aria-label={`Открыть: ${r.fullName}`}
                >
                  Открыть
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StudentCards({ rows }: { rows: StudentListRow[] }) {
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Ученики">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            to="/admin/students/$studentId"
            params={{ studentId: r.id }}
            className={cn(
              cardClass,
              'flex flex-col gap-1.5 rounded-[18px] px-4 py-3.5',
              r.status === 'exhausted' && 'bg-accent',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-extrabold text-ink">{r.fullName}</span>
              <StatusChip status={r.status} />
            </div>
            <div className="text-[13px] font-bold text-ink-muted">
              {[r.grade ? `${r.grade} класс` : null, r.groups || 'без группы']
                .filter(Boolean)
                .join(' · ')}
            </div>
            <div className="flex items-baseline justify-between gap-3 text-[13px] font-bold">
              <span className="whitespace-nowrap text-ink-muted">
                {displayPhone(r.parentPhone) ?? 'нет телефона'}
              </span>
              {r.remaining && (
                <span
                  className={cn(
                    'whitespace-nowrap tabular-nums',
                    r.status === 'exhausted' && 'font-extrabold text-warn',
                  )}
                >
                  осталось {r.remaining}
                </span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
