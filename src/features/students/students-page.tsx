import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { PageHeader, PageTitle } from '@/components/page'
import { balancesQuery, unbilledQuery } from '@/features/payments/api'
import { formatSom } from '@/features/tariffs/model'
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
  needsPayment,
  payCounts,
  studentListRows,
  type GroupBrief,
  type PayFilter,
  type StudentFilter,
  type StudentListRow,
} from './model'
import { NativeSelect, PayChip } from './parts'
import { debtTone, listDebtCaption } from './pay-view'
import { StudentFormDialog } from './student-form-dialog'

const chipBase =
  'inline-flex min-h-9 items-center rounded-full px-3.5 text-[13px] font-extrabold whitespace-nowrap'

// А5 Ученики (docs/design/AdminStudents.dc.html). Phone: same route, table → cards.
// Balances come from v_student_balance (features/payments): «Оплата» chip, «Долг» in som.
export function StudentsPage({
  search,
  onSearchChange,
}: {
  search: StudentFilter
  onSearchChange: (next: StudentFilter) => void
}) {
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const studentsResult = useQuery(studentsQuery())
  const balancesResult = useQuery(balancesQuery())
  // after-school hours not invoiced yet are a debt too (И69); the list does not wait for them
  const unbilled = useQuery(unbilledQuery()).data
  const query = {
    isPending: studentsResult.isPending || balancesResult.isPending,
    isError: studentsResult.isError || balancesResult.isError,
  }
  const data = studentsResult.data
  const balances = balancesResult.data
  const [creating, setCreating] = useState(false)

  const rows = useMemo(
    () => (data && balances ? studentListRows(data, balances, unbilled) : []),
    [data, balances, unbilled],
  )
  const counts = useMemo(() => payCounts(rows), [rows])
  const groups = useMemo(() => (data ? enrollableGroups(data.groups) : []), [data])
  const shown = useMemo(() => filterRows(rows, search), [rows, search])
  const caption = data ? listCaption(rows) : ' '

  const set = (patch: StudentFilter) => {
    const next = { ...search, ...patch }
    onSearchChange({
      q: next.q || undefined,
      group: next.group || undefined,
      pay: next.pay || undefined,
    })
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

      <PayChips
        total={rows.length}
        counts={counts}
        value={search.pay}
        onChange={(pay) => {
          set({ pay })
        }}
      >
        {isDesktop && (
          <GroupFilter
            groups={groups}
            value={search.group}
            onChange={(group) => {
              set({ group })
            }}
            className="w-64"
          />
        )}
      </PayChips>

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

const PAY_CHIPS: { value: PayFilter; label: string }[] = [
  { value: 'unpaid', label: 'Не оплатили' },
  { value: 'debt', label: 'Долг' },
  { value: 'soon', label: 'Пора оплачивать' },
  { value: 'partial', label: 'Частично' },
]

function PayChips({
  total,
  counts,
  value,
  onChange,
  children,
}: {
  total: number
  counts: Record<PayFilter, number>
  value: PayFilter | undefined
  onChange: (value: PayFilter | undefined) => void
  children?: ReactNode
}) {
  const chip = (active: boolean) =>
    cn(
      chipBase,
      active ? 'bg-ink text-brand' : 'border-[1.5px] border-line-strong bg-card text-ink-muted',
    )
  return (
    <div className="-mx-5 flex items-center gap-2 overflow-x-auto px-5 min-[900px]:mx-0 min-[900px]:flex-wrap min-[900px]:overflow-visible min-[900px]:px-0">
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => {
          onChange(undefined)
        }}
        className={chip(!value)}
      >
        Все · {total}
      </button>
      {PAY_CHIPS.map((c) => (
        <button
          key={c.value}
          type="button"
          aria-pressed={value === c.value}
          onClick={() => {
            onChange(value === c.value ? undefined : c.value)
          }}
          className={chip(value === c.value)}
        >
          {c.label} · {counts[c.value]}
        </button>
      ))}
      {children}
    </div>
  )
}

function DebtCell({ row }: { row: StudentListRow }) {
  if (row.debtLessons === 0 && row.debtHours === 0) return <span className="text-ink-muted">—</span>
  return (
    <span
      className={cn(
        'font-extrabold',
        debtTone(row.debtLessons) === 'burned' ? 'text-burned' : 'text-warn',
      )}
    >
      {formatSom(row.debtSom)}
    </span>
  )
}

function ActionLink({ row }: { row: StudentListRow }) {
  const cls = 'text-xs font-extrabold whitespace-nowrap text-teal'
  return needsPayment(row) ? (
    <Link
      to="/admin/payments"
      search={{ student: row.id }}
      className={cls}
      aria-label={`Оплата: ${row.fullName}`}
    >
      Оплата
    </Link>
  ) : (
    <Link
      to="/admin/students/$studentId"
      params={{ studentId: row.id }}
      className={cls}
      aria-label={`Открыть: ${row.fullName}`}
    >
      Открыть
    </Link>
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
      <table className="w-full min-w-[960px] border-collapse" aria-label="Ученики">
        <thead>
          <tr className="border-b border-line">
            <th className={thClass}>Ученик</th>
            <th className={thClass}>Класс</th>
            <th className={thClass}>Группы</th>
            <th className={thClass}>Родитель</th>
            <th className={cn(thClass, 'text-right')}>Осталось уроков</th>
            <th className={thClass}>Оплата</th>
            <th className={cn(thClass, 'text-right')}>Долг</th>
            <th className={thClass}>
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="[&:last-child>td]:border-0">
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
              <td className={cn(tdClass, numClass)}>
                {r.remaining || <span className="text-ink-muted">—</span>}
              </td>
              <td className={tdClass}>
                <PayChip row={r} />
              </td>
              <td className={cn(tdClass, numClass)}>
                <DebtCell row={r} />
              </td>
              <td className={tdClass}>
                <ActionLink row={r} />
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
            className={cn(cardClass, 'flex flex-col gap-1.5 rounded-[18px] px-4 py-3.5')}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-extrabold text-ink">{r.fullName}</span>
              <PayChip row={r} />
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
                <span className="whitespace-nowrap tabular-nums">осталось {r.remaining}</span>
              )}
            </div>
            {(r.debtLessons > 0 || r.debtHours > 0) && (
              <div
                className={cn(
                  'text-[13px] font-extrabold',
                  debtTone(r.debtLessons) === 'burned' ? 'text-burned' : 'text-warn',
                )}
              >
                {listDebtCaption(r.debtLessons, r.debtHours, r.debtSom)}
              </div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}
