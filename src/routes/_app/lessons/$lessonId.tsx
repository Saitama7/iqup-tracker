import { createFileRoute } from '@tanstack/react-router'
import { LessonPage } from '@/features/lessons/lesson-page'
import { lessonSearchSchema } from '@/features/lessons/return-to'
import { requireRole } from '@/lib/guards'

// У3 / УД2 Посещаемость. ?from=my-month&month=…&group=… — the list to return to (#72).
export const Route = createFileRoute('/_app/lessons/$lessonId')({
  validateSearch: lessonSearchSchema,
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  component: LessonRoute,
})

function LessonRoute() {
  const { lessonId } = Route.useParams()
  const search = Route.useSearch()
  return <LessonPage lessonId={lessonId} search={search} />
}
