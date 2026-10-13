import { describe, expect, it } from 'vitest'
import {
  addDays,
  groupStartNote,
  attendanceSummary,
  autoGroupName,
  groupNameTaken,
  groupNameTemplate,
  currentRules,
  extraLessonDateError,
  filterGroups,
  groupListRows,
  horizon,
  isoWeekday,
  lessonViews,
  listCaption,
  monthProgress,
  percentOn,
  planLessonDates,
  scheduleLong,
  scheduleShort,
  tariffCaption,
  teacherConflicts,
  weekdaysCaption,
  type GroupRow,
  type LessonRow,
  type ScheduleRule,
  type TariffRow,
} from './model'

const rule = (
  weekday: number,
  start = '09:00:00',
  valid_from = '2026-09-01',
  valid_to: string | null = null,
): ScheduleRule => ({
  weekday,
  start_time: start,
  valid_from,
  valid_to,
})

const tariffs: TariffRow[] = [
  {
    group_type: 'group',
    valid_from: '2026-09-01',
    lessons_in_package: 12,
    package_price: 3200,
    max_students: 10,
    lesson_duration_min: 60,
  },
  {
    group_type: 'afterschool',
    valid_from: '2026-09-01',
    lessons_in_package: 20,
    package_price: 7400,
    max_students: 8,
    lesson_duration_min: 180,
  },
]

const group = (over: Partial<GroupRow> = {}): GroupRow => ({
  id: 'g1',
  name: '8 класс А',
  subject_id: 's-math',
  subject: 'Математика',
  grade: 8,
  group_type: 'group',
  status: 'active',
  start_date: '2026-09-01',
  end_date: null,
  room: '1',
  teacher_id: 't1',
  teacher: { full_name: 'Гульзат Асанова' },
  schedule_rules: [rule(2), rule(4), rule(6)],
  students: 8,
  ...over,
})

describe('dates', () => {
  it('addDays / isoWeekday / horizon', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(isoWeekday('2026-09-01')).toBe(2) // Tuesday
    expect(isoWeekday('2026-10-11')).toBe(7) // Sunday
    expect(horizon('2026-10-11')).toBe('2026-12-06')
  })
})

describe('planLessonDates (same rule as generate_lessons)', () => {
  it('ВТ/ЧТ/СБ 1 Sep – 31 Oct 2026: 27 slots, minus holidays (pgTAP lesson_generation)', () => {
    const plan = (holidays: string[]) =>
      planLessonDates({
        weekdays: [2, 4, 6],
        from: '2026-09-01',
        until: '2026-10-31',
        holidays: new Set(holidays),
      })
    expect(plan([])).toHaveLength(27)
    const withHolidays = plan(['2026-10-01', '2026-09-12', '2026-09-13'])
    expect(withHolidays).toHaveLength(25) // Sunday 13 Sep is not a lesson day
    expect(withHolidays).not.toContain('2026-10-01')
    expect(withHolidays[0]).toBe('2026-09-01')
    expect(withHolidays.at(-1)).toBe('2026-10-31')
  })

  it('no weekdays or an empty range → nothing', () => {
    expect(
      planLessonDates({
        weekdays: [],
        from: '2026-09-01',
        until: '2026-10-31',
        holidays: new Set(),
      }),
    ).toEqual([])
    expect(
      planLessonDates({
        weekdays: [1],
        from: '2026-10-31',
        until: '2026-10-01',
        holidays: new Set(),
      }),
    ).toEqual([])
  })
})

describe('schedule captions', () => {
  it('weekdays: runs of 3+ collapse to a range', () => {
    expect(weekdaysCaption([1, 2, 3, 4, 5])).toBe('ПН–ПТ')
    expect(weekdaysCaption([6, 2, 4])).toBe('ВТ ЧТ СБ')
    expect(weekdaysCaption([2, 4, 6], ', ')).toBe('ВТ, ЧТ, СБ')
    expect(weekdaysCaption([1, 2])).toBe('ПН ВТ')
  })

  it('А3 short and А4 long form', () => {
    const rules = [rule(2), rule(4), rule(6)]
    expect(scheduleShort(rules)).toBe('ВТ ЧТ СБ · 09:00')
    expect(scheduleLong(rules, 60)).toBe('ВТ, ЧТ, СБ 09:00–10:00')
    expect(scheduleLong([rule(1, '08:00:00')], 180)).toBe('ПН 08:00–11:00')
  })

  it('current rules: in effect today, else the next planned set', () => {
    const rules = [
      rule(1, '10:00:00', '2026-09-01', '2026-10-18'),
      rule(2, '15:00:00', '2026-10-19'),
    ]
    expect(currentRules(rules, '2026-10-11').map((r) => r.weekday)).toEqual([1])
    expect(currentRules(rules, '2026-10-19').map((r) => r.weekday)).toEqual([2])
    expect(
      currentRules([rule(3, '10:00:00', '2026-11-01')], '2026-10-11').map((r) => r.weekday),
    ).toEqual([3])
  })
})

describe('teachers', () => {
  it('percent on a date', () => {
    const t = {
      rates: [
        { percent: 45, valid_from: '2026-09-01' },
        { percent: 50, valid_from: '2026-11-01' },
      ],
    }
    expect(percentOn(t, '2026-10-11')).toBe(45)
    expect(percentOn(t, '2026-11-01')).toBe(50)
    expect(percentOn(t, '2026-08-01')).toBeNull()
  })

  it('conflicts: same teacher, same weekday, overlapping time', () => {
    const groups = [
      group(),
      group({ id: 'g2', teacher_id: 't2' }),
      group({ id: 'g3', status: 'archived' }),
    ]
    const slot = { weekdays: [2, 3], start: '09:30', durationMin: 60 }
    const found = teacherConflicts(slot, 't1', '2026-10-12', groups, tariffs)
    expect(found.map((c) => [c.group.id, c.weekday, c.start])).toEqual([['g1', 2, '09:00']])
    expect(
      teacherConflicts({ ...slot, start: '10:00' }, 't1', '2026-10-12', groups, tariffs),
    ).toEqual([])
    expect(teacherConflicts(slot, 't1', '2026-10-12', groups, tariffs, 'g1')).toEqual([])
  })

  it('conflicts ignore rules that ended before the start date', () => {
    const g = group({ schedule_rules: [rule(2, '09:00:00', '2026-09-01', '2026-10-01')] })
    expect(
      teacherConflicts(
        { weekdays: [2], start: '09:00', durationMin: 60 },
        't1',
        '2026-10-12',
        [g],
        tariffs,
      ),
    ).toEqual([])
  })
})

describe('А3 list', () => {
  it('rows: label, tariff caption, teacher, schedule, seats', () => {
    const [row] = groupListRows([group()], tariffs, '2026-10-11')
    expect(row).toEqual({
      id: 'g1',
      label: 'Математика · 8 класс А',
      tariffCaption: 'групповая · 3\u00a0200 / 12',
      teacher: 'Гульзат',
      schedule: 'ВТ ЧТ СБ · 09:00',
      students: 8,
      maxStudents: 10,
      status: 'active',
    })
    expect(tariffCaption('afterschool', tariffs[1] ?? null)).toBe(
      'продлёнка · 7\u00a0400 / 20 · 3 ч',
    )
    expect(tariffCaption('mini', null)).toBe('мини-группа')
  })

  it('caption with Russian plurals', () => {
    const rows = [
      ...Array.from({ length: 12 }, () => ({ status: 'active' as const })),
      { status: 'forming' as const },
      { status: 'forming' as const },
      ...Array.from({ length: 3 }, () => ({ status: 'archived' as const })),
    ]
    expect(listCaption(rows)).toBe('12 активных · 2 набираются · 3 в архиве')
    expect(listCaption([{ status: 'active' }, { status: 'forming' }])).toBe(
      '1 активная · 1 набирается · 0 в архиве',
    )
  })

  it('filter by tab and by name or teacher', () => {
    const rows = groupListRows(
      [
        group(),
        group({
          id: 'g2',
          name: '9 класс',
          subject: 'Химия',
          status: 'forming',
          teacher: { full_name: 'Айпери Ж.' },
        }),
      ],
      tariffs,
      '2026-10-11',
    )
    expect(filterGroups(rows, 'active', '').map((r) => r.id)).toEqual(['g1'])
    expect(filterGroups(rows, 'forming', 'айпери').map((r) => r.id)).toEqual(['g2'])
    expect(filterGroups(rows, 'active', 'химия')).toEqual([])
  })
})

describe('А4 lessons', () => {
  const lesson = (over: Partial<LessonRow>): LessonRow => ({
    id: 'l',
    lesson_date: '2026-10-10',
    planned_start: '09:00:00',
    duration_min: 60,
    status: 'planned',
    cancel_reason: null,
    is_extra: false,
    makes_up_for_lesson_id: null,
    substitute_teacher_id: null,
    confirmed_at: null,
    confirmed_late: false,
    comment: null,
    attendance: [],
    ...over,
  })

  it('attendance summary', () => {
    const m = (status: 'present' | 'absent_frozen' | 'absent_burned', n: number) =>
      Array.from({ length: n }, () => ({ status }))
    expect(attendanceSummary([...m('present', 7), ...m('absent_frozen', 1)])).toBe('7 + 1 замор.')
    expect(attendanceSummary([...m('present', 7), ...m('absent_burned', 1)])).toBe('7 + 1 сгорел')
    expect(attendanceSummary(m('present', 8))).toBe('8')
  })

  it('status per lesson, make-up links, substitute', () => {
    const views = lessonViews(
      [
        lesson({
          id: 'held',
          lesson_date: '2026-10-08',
          status: 'held',
          confirmed_at: '2026-10-08T04:02:00Z',
          attendance: [{ status: 'present' }, { status: 'absent_frozen' }],
        }),
        lesson({
          id: 'late',
          lesson_date: '2026-10-06',
          status: 'held',
          confirmed_at: '2026-10-07T02:40:00Z',
          confirmed_late: true,
          attendance: [{ status: 'present' }],
        }),
        lesson({
          id: 'cancel',
          lesson_date: '2026-10-03',
          status: 'cancelled',
          cancel_reason: 'teacher',
        }),
        lesson({
          id: 'extra',
          lesson_date: '2026-10-28',
          planned_start: '15:00:00',
          is_extra: true,
          makes_up_for_lesson_id: 'cancel',
        }),
        lesson({ id: 'old', lesson_date: '2026-10-01' }),
        lesson({ id: 'today', lesson_date: '2026-10-11', substitute_teacher_id: 't2' }),
        lesson({ id: 'next', lesson_date: '2026-10-13' }),
      ],
      '2026-10-11',
      new Map([['t2', 'Айпери']]),
    )
    const by = Object.fromEntries(views.map((v) => [v.id, v]))
    expect(views.map((v) => v.id)).toEqual([
      'old',
      'cancel',
      'late',
      'held',
      'today',
      'next',
      'extra',
    ])
    expect(by.held).toMatchObject({
      status: '1 + 1 замор. · 10:02',
      tone: 'held',
      when: '8 окт, чт 09:00',
    })
    expect(by.late).toMatchObject({ status: '1 · поздно, 7 окт', tone: 'late' })
    expect(by.cancel).toMatchObject({
      status: 'отменено · отменил учитель',
      needsMakeUp: false,
      link: 'восполнено 28 окт',
      canCancel: false,
    })
    expect(by.extra).toMatchObject({
      isExtra: true,
      link: 'восполняет 3 окт',
      status: 'запланировано',
    })
    expect(by.old).toMatchObject({
      status: 'не подтверждено',
      tone: 'unconfirmed',
      canCancel: true,
    })
    expect(by.today).toMatchObject({ status: 'сегодня', substitute: 'Айпери' })
  })

  it('month progress: held of non-cancelled lessons this month', () => {
    const rows = [
      { lesson_date: '2026-10-01', status: 'held' as const },
      { lesson_date: '2026-10-03', status: 'cancelled' as const },
      { lesson_date: '2026-10-13', status: 'planned' as const },
      { lesson_date: '2026-11-03', status: 'planned' as const },
    ]
    expect(monthProgress(rows, '2026-10-11')).toEqual({ held: 1, total: 2 })
  })
})

describe('extraLessonDateError (И16)', () => {
  it('blocks a teacher from dates before today', () => {
    expect(extraLessonDateError('2026-10-07', '2026-10-08')).toMatch(/сегодня или позже/)
    expect(extraLessonDateError('2026-10-08', '2026-10-08')).toBeNull()
    expect(extraLessonDateError('2026-10-09', '2026-10-08')).toBeNull()
  })

  it('does not limit the admin or an incomplete date', () => {
    expect(extraLessonDateError('2020-01-01', undefined)).toBeNull()
    expect(extraLessonDateError(null, '2026-10-08')).toBeNull()
  })
})

describe('autoGroupName (А3, #42)', () => {
  const math = { subjectId: 's-math', grade: 7, groupType: 'group' as const }
  const g = (name: string, over: Partial<GroupRow> = {}) => group({ name, ...over })

  it('template from class and type', () => {
    expect(groupNameTemplate(7, 'group')).toBe('7 класс')
    expect(groupNameTemplate(7, 'pair')).toBe('7 класс · пара')
    expect(groupNameTemplate(7, 'individual', 'Б')).toBe('7 класс Б · инд.')
    expect(groupNameTemplate(3, 'afterschool')).toBe('3 класс')
  })

  it('plain name while the class is free', () => {
    expect(autoGroupName(math, [])).toBe('7 класс')
    expect(autoGroupName(math, [g('8 класс А'), g('7 класс', { subject_id: 's-chem' })])).toBe(
      '7 класс',
    )
  })

  it('a duplicate gets the next letter', () => {
    expect(autoGroupName(math, [g('7 класс')])).toBe('7 класс А')
    expect(autoGroupName(math, [g('7 класс'), g('7 класс А')])).toBe('7 класс Б')
    expect(autoGroupName({ ...math, grade: 8 }, [g('8 класс А'), g(' 8 КЛАСС б ')])).toBe(
      '8 класс В',
    )
    expect(autoGroupName({ ...math, groupType: 'pair' }, [g('7 класс · пара')])).toBe(
      '7 класс А · пара',
    )
  })

  it('archived groups free their names', () => {
    expect(autoGroupName(math, [g('7 класс', { status: 'archived' })])).toBe('7 класс')
  })

  it('groupNameTaken matches the unique index', () => {
    const groups = [g('7 класс'), g('7 класс А', { status: 'archived' })]
    expect(groupNameTaken(' 7 КЛАСС ', 's-math', groups)).toBe(true)
    expect(groupNameTaken('7 класс', 's-chem', groups)).toBe(false)
    expect(groupNameTaken('7 класс А', 's-math', groups)).toBe(false)
  })
})

describe('groupStartNote (#60, set_group_start)', () => {
  const group = {
    start_date: '2026-09-18',
    schedule_rules: [
      { weekday: 2, start_time: '09:00:00', valid_from: '2026-09-18', valid_to: null },
      { weekday: 4, start_time: '09:00:00', valid_from: '2026-09-18', valid_to: null },
      // a later change does not fill the stretch before the old start
      { weekday: 6, start_time: '10:00:00', valid_from: '2026-10-01', valid_to: null },
    ],
  }

  it('same date — nothing to say', () => {
    expect(groupStartNote(group, '2026-09-18', new Set())).toBeNull()
  })

  it('earlier: counts the lessons of the new stretch, holidays skipped', () => {
    // ВТ/ЧТ 1–17 Sep: 1, 3, 8, 10, 15, 17 — minus the holiday on 3 Sep
    expect(groupStartNote(group, '2026-09-01', new Set(['2026-09-03']))).toBe(
      'Занятия с 1 сентября по 17 сентября достроятся по расписанию старта: 5 занятий, праздники пропущены.',
    )
  })

  it('later: planned lessons before the date go', () => {
    expect(groupStartNote(group, '2026-09-22', new Set())).toMatch(
      /^Запланированные занятия до 22 сентября удалятся/,
    )
  })
})
