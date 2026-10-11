// /lessons/:id stub: lesson title and time; attendance marking is R1-8 (#12).
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { PageHeader } from '@/components/page'
import { formatDayLong } from '@/lib/time'
import { lessonQuery } from './api'
import { lessonTitle } from './parts'
import { lessonStartMs, timeRange } from './select'

export function LessonPage({ lessonId }: { lessonId: string }) {
  const { data, isError, isPending } = useQuery(lessonQuery(lessonId))

  return (
    <section className="flex flex-col gap-6">
      <Link
        to="/today"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-extrabold text-teal"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Сегодня
      </Link>
      {data ? (
        <PageHeader
          eyebrow={`${formatDayLong(lessonStartMs(data))} · ${timeRange(data)}`}
          title={lessonTitle(data)}
        />
      ) : (
        <PageHeader title={isPending ? 'Занятие' : 'Занятие не найдено'} />
      )}
      <p className="rounded-[18px] border border-dashed border-line-strong bg-card p-6 font-bold text-ink-muted">
        {isError
          ? 'Не удалось загрузить занятие. Проверьте интернет.'
          : 'Отметка посещаемости появится в следующем обновлении.'}
      </p>
    </section>
  )
}
