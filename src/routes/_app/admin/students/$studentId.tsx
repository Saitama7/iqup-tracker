import { createFileRoute } from '@tanstack/react-router'
import { StudentPage } from '@/features/students/student-page'

// А6 Ученик (docs/design/AdminStudent.dc.html), phone АМ2; role guard — admin/route.tsx.
export const Route = createFileRoute('/_app/admin/students/$studentId')({
  component: StudentRoute,
})

function StudentRoute() {
  const { studentId } = Route.useParams()
  return <StudentPage studentId={studentId} />
}
