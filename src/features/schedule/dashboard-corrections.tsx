// #74 · «Требует внимания»: teachers' requests to correct the marks of a held lesson. Each opens the
// lesson card, where the admin sees «было → стало» and applies or rejects.
import { Link } from '@tanstack/react-router'
import { firstName } from '@/components/shell/shell-parts'
import type { PendingRequest } from '@/features/lessons/corrections-api'

/** «Гульзат просит исправить отметки: Математика · 8 класс А, 03.10 в 09:00». */
export function requestLine(r: PendingRequest): string {
  const day = `${r.lessonDate.slice(8, 10)}.${r.lessonDate.slice(5, 7)}`
  return `${firstName(r.teacher)} просит исправить отметки: ${r.subject} · ${r.group}, ${day} в ${r.start.slice(0, 5)}`
}

/** АМ1: items of the «Требует внимания» list. */
export function CorrectionItems({ requests }: { requests: readonly PendingRequest[] }) {
  return requests.map((r) => (
    <li key={r.id}>
      <Link
        to="/lessons/$lessonId"
        params={{ lessonId: r.lessonId }}
        className="flex min-h-11 items-center gap-2.5 rounded-[14px] bg-warn-soft px-3.5 py-2.5 text-warn-strong"
      >
        <span className="flex-1 text-[13px] font-bold">{requestLine(r)}</span>
        <span className="text-[13px] font-extrabold" aria-hidden>
          →
        </span>
      </Link>
    </li>
  ))
}

/** А1 aside: shown only while there are requests. */
export function CorrectionsWidget({ requests }: { requests: readonly PendingRequest[] }) {
  if (requests.length === 0) return null
  return (
    <section
      aria-label="Требует внимания"
      className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-card px-5 py-4"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-extrabold">Запросы на исправление</h2>
        <span className="rounded-full bg-warn-soft px-[9px] py-[3px] text-xs font-extrabold whitespace-nowrap text-warn-strong">
          {requests.length}
        </span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {requests.map((r) => (
          <li key={r.id} className="flex justify-between gap-2.5 text-[13px] font-bold">
            <span>{requestLine(r)}</span>
            <Link
              to="/lessons/$lessonId"
              params={{ lessonId: r.lessonId }}
              className="font-extrabold whitespace-nowrap text-teal"
            >
              Открыть
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
