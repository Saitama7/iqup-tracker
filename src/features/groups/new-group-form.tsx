import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { STUDENTS_KEY } from '@/features/students/api'
import { firstName, formatDayMonth, groupLabel } from '@/features/students/model'
import { NativeSelect } from '@/features/students/parts'
import { GROUP_TYPES, tariffFor, type GroupType } from '@/features/tariffs/current'
import { ErrorText, Field, inputClass, SubmitButton } from '@/features/tariffs/parts'
import { formatSom, GROUP_TYPE_LABEL } from '@/features/tariffs/model'
import { formatDateRu, parseDateRu } from '@/lib/time'
import { createGroup, groupForm, GROUPS_KEY, type GroupsSource } from './api'
import {
  horizon,
  planLessonDates,
  teacherConflicts,
  teacherOption,
  weekdayLabel,
  type TariffRow,
} from './model'
import { WeekdayPicker } from './parts'

/** Subjects of the center (А3) plus any already used by a group. */
const SUBJECTS = ['Математика', 'Химия', 'ОРТ', 'Продлёнка']

function typeOption(type: GroupType, tariff: TariffRow | null): string {
  const label = GROUP_TYPE_LABEL[type]
  if (!tariff) return `${label} · нет тарифа`
  const seats =
    tariff.max_students === 1 ? null : tariff.max_students === 2 ? '2' : `до ${tariff.max_students}`
  return [label, seats, `${formatSom(tariff.package_price)} / ${tariff.lessons_in_package} ур`]
    .filter(Boolean)
    .join(' · ')
}

const plural = (n: number) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'занятие'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'занятия'
  return 'занятий'
}

/**
 * «Новая группа» (А3 aside; on the phone — inside a dialog): group, weekly schedule and the
 * lessons up to the 8-week horizon in one RPC (create_group, 0008). The preview counts the
 * same dates generate_lessons will create and warns about the teacher's overlapping groups.
 */
export function NewGroupForm({
  data,
  today,
  onCreated,
}: {
  data: GroupsSource
  today: string
  onCreated: (groupId: string) => void
}) {
  const ids = {
    name: useId(),
    subject: useId(),
    grade: useId(),
    type: useId(),
    teacher: useId(),
    days: useId(),
    time: useId(),
    start: useId(),
    room: useId(),
  }
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('Математика')
  const [grade, setGrade] = useState('')
  const [groupType, setGroupType] = useState<GroupType>('group')
  const [teacherId, setTeacherId] = useState('')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [time, setTime] = useState('16:00')
  const [start, setStart] = useState(formatDateRu(today))
  const [room, setRoom] = useState('')
  const [error, setError] = useState<string | null>(null)

  const until = horizon(today)
  const subjects = [...new Set([...SUBJECTS, ...data.groups.map((g) => g.subject)])]
  const teacher = data.teachers.find((t) => t.id === teacherId) ?? null
  const startIso = parseDateRu(start)
  const timeOk = /^([01]?\d|2[0-3]):[0-5]\d$/.test(time.trim())
  const tariff = startIso ? tariffFor(groupType, startIso, data.tariffs) : null
  const dates =
    startIso && weekdays.length > 0
      ? planLessonDates({ weekdays, from: startIso, until, holidays: new Set(data.holidays) })
      : []
  const conflicts =
    teacher && startIso && timeOk && weekdays.length > 0
      ? teacherConflicts(
          {
            weekdays,
            start: time.trim().padStart(5, '0'),
            durationMin: tariff?.lesson_duration_min ?? 60,
          },
          teacher.id,
          startIso,
          data.groups,
          data.tariffs,
        )
      : []

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof createGroup>[0]) => createGroup(input, until),
    onSuccess: async ({ groupId, lessonsCreated }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: GROUPS_KEY }),
        queryClient.invalidateQueries({ queryKey: STUDENTS_KEY }),
      ])
      toast.success(`Группа создана · ${lessonsCreated} ${plural(lessonsCreated)}`)
      onCreated(groupId)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = groupForm.safeParse({
      name,
      subject,
      grade,
      groupType,
      teacherId,
      weekdays,
      time,
      startDate: start,
      room,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    if (!tariff) {
      setError('На дату старта нет тарифа для этого типа группы')
      return
    }
    setError(null)
    mutation.mutate(parsed.data)
  }

  const teacherName = teacher ? firstName(teacher.full_name) : null
  const preview = !teacher
    ? 'Выберите учителя, дни и время — покажем, сколько занятий будет создано.'
    : weekdays.length === 0 || !startIso || !timeOk
      ? 'Выберите дни недели, время и дату первого занятия.'
      : [
          conflicts.length === 0
            ? `Пересечений у ${teacherName} нет.`
            : `Пересечение у ${teacherName}: ${conflicts
                .map((c) => `${groupLabel(c.group)}, ${weekdayLabel(c.weekday)} ${c.start}`)
                .join('; ')}.`,
          `Будет создано ${dates.length} ${plural(dates.length)} до ${formatDayMonth(until)}, праздники пропущены.`,
        ].join(' ')

  return (
    <form
      onSubmit={onSubmit}
      onChange={() => {
        setError(null)
      }}
      noValidate
      aria-label="Новая группа"
      className="flex flex-col gap-3.5"
    >
      <Field id={ids.name} label="Название">
        <input
          id={ids.name}
          className={inputClass}
          placeholder="7 класс"
          autoComplete="off"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field id={ids.subject} label="Предмет">
          <NativeSelect
            id={ids.subject}
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value)
            }}
          >
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id={ids.grade} label="Класс">
          <NativeSelect
            id={ids.grade}
            value={grade}
            onChange={(e) => {
              setGrade(e.target.value)
            }}
          >
            <option value="">—</option>
            {Array.from({ length: 11 }, (_, i) => String(i + 1)).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field id={ids.type} label="Тип и тариф">
        <NativeSelect
          id={ids.type}
          value={groupType}
          onChange={(e) => {
            setGroupType(e.target.value as GroupType)
          }}
        >
          {GROUP_TYPES.map((t) => (
            <option key={t} value={t}>
              {typeOption(t, tariffFor(t, startIso ?? today, data.tariffs))}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={ids.teacher} label="Учитель">
        <NativeSelect
          id={ids.teacher}
          value={teacherId}
          onChange={(e) => {
            setTeacherId(e.target.value)
          }}
        >
          <option value="">Выберите учителя</option>
          {data.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {teacherOption(t, today)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <WeekdayPicker id={ids.days} value={weekdays} onChange={setWeekdays} />
      <div className="grid grid-cols-2 gap-2.5">
        <Field id={ids.time} label="Время">
          <input
            id={ids.time}
            className={inputClass}
            inputMode="numeric"
            placeholder="ЧЧ:ММ"
            autoComplete="off"
            value={time}
            onChange={(e) => {
              setTime(e.target.value)
            }}
          />
        </Field>
        <Field id={ids.start} label="Первое занятие">
          <input
            id={ids.start}
            className={inputClass}
            inputMode="numeric"
            placeholder="ДД.ММ.ГГГГ"
            autoComplete="off"
            value={start}
            onChange={(e) => {
              setStart(e.target.value)
            }}
          />
        </Field>
      </div>
      <Field id={ids.room} label="Кабинет">
        <input
          id={ids.room}
          className={inputClass}
          placeholder="1"
          autoComplete="off"
          value={room}
          onChange={(e) => {
            setRoom(e.target.value)
          }}
        />
      </Field>
      <p
        role="status"
        aria-label="Предпросмотр"
        className={
          conflicts.length > 0
            ? 'rounded-xl bg-burned/10 px-3 py-2.5 text-xs font-bold text-burned-strong'
            : 'rounded-xl bg-accent px-3 py-2.5 text-xs font-bold text-warn-strong'
        }
      >
        {preview}
      </p>
      {error && <ErrorText>{error}</ErrorText>}
      <SubmitButton pending={mutation.isPending} className="min-h-12">
        Создать группу
      </SubmitButton>
    </form>
  )
}
