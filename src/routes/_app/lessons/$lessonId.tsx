import { createFileRoute } from '@tanstack/react-router'
import { LessonPage } from '@/features/lessons/lesson-page'
import { requireRole } from '@/lib/guards'

// У3 / УД2 Посещаемость — attendance comes in R1-8 (#12); for now a stub so «Сегодня» can link here.
export const Route = createFileRoute('/_app/lessons/$lessonId')({
  beforeLoad: ({ context }) => {
    requireRole(context.auth, 'teacher')
  },
  component: LessonRoute,
})

function LessonRoute() {
  const { lessonId } = Route.useParams()
  return <LessonPage lessonId={lessonId} />
}
