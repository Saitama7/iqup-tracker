import type { AdminLesson } from './api'
import {
  adminUnconfirmed,
  cardText,
  cardTone,
  dashboardCaption,
  dashboardChip,
  dayHeader,
  dayKpi,
  dayKpiCaption,
  filterLessons,
  hourRows,
  mobileCaption,
  otherWeeks,
  payrollMonth,
  unconfirmedLine,
  unconfirmedMore,
  unconfirmedSpread,
  weekDays,
  weekStart,
  weekTitle,
} from './model'

// Thursday 8 October 2026, 14:24 Bishkek — the artboards' moment.
const NOW = Date.parse('2026-10-08T14:24:00+06:00')
const GULZAT = { id: 't1', name: 'Гульзат Асанова' }
const AIPERI = { id: 't2', name: 'Айпери Жусупова' }

let seq = 0
function lesson(over: Partial<AdminLesson> & Pick<AdminLesson, 'lesson_date' | 'planned_start'>) {
  seq += 1
  return {
    id: `l${String(seq).padStart(3, '0')}`,
    duration_min: 60,
    status: 'planned',
    is_extra: false,
    cancel_reason: null,
    confirmed_at: null,
    makesUpFor: null,
    group: {
      id: 'g1',
      name: '8 класс Б',
      subject: 'Математика',
      group_type: 'group',
      room: '2',
      status: 'active',
    },
    teacher: GULZAT,
    students: 8,
    attendance: [],
    ...over,
  } satisfies AdminLesson
}

describe('adminUnconfirmed', () => {
  it("puts today's ended lessons first, then the earlier days of the month, freshest first", () => {
    const rows = [
      lesson({ lesson_date: '2026-09-30', planned_start: '15:00' }), // last month — not counted
      lesson({ lesson_date: '2026-10-05', planned_start: '15:00' }),
      lesson({ lesson_date: '2026-10-07', planned_start: '15:00' }),
      lesson({ lesson_date: '2026-10-07', planned_start: '18:00', teacher: AIPERI }),
      lesson({ lesson_date: '2026-10-08', planned_start: '09:00' }),
      lesson({ lesson_date: '2026-10-08', planned_start: '14:00' }), // current — not yet
      lesson({ lesson_date: '2026-10-06', planned_start: '11:00', status: 'held' }),
    ]
    const list = adminUnconfirmed(rows, NOW)
    expect(list.map((l) => `${l.lesson_date} ${l.planned_start}`)).toEqual([
      '2026-10-08 09:00',
      '2026-10-07 18:00',
      '2026-10-07 15:00',
      '2026-10-05 15:00',
    ])
    expect(unconfirmedSpread(list)).toEqual({ days: 'за 3 дня', teachers: '2 учителя' })
    expect(unconfirmedLine(list[1] as AdminLesson, '2026-10-08')).toBe(
      'Вчера 18:00 · Математика · 8 класс Б · Айпери',
    )
    expect(unconfirmedLine(list[0] as AdminLesson, '2026-10-08')).toBe(
      'Сегодня 09:00 · Математика · 8 класс Б · Гульзат',
    )
    expect(unconfirmedLine(list[3] as AdminLesson, '2026-10-08')).toMatch(/^5 окт 15:00/)
    expect(unconfirmedMore(list)).toBe('ещё 1 занятие · самое старое 5 окт →')
    expect(unconfirmedMore(list.slice(0, 3))).toBeNull()
  })

  it('a teacher confirming a lesson takes it off the list', () => {
    const l = lesson({ lesson_date: '2026-10-07', planned_start: '15:00' })
    expect(adminUnconfirmed([l], NOW)).toHaveLength(1)
    expect(adminUnconfirmed([{ ...l, status: 'held' }], NOW)).toHaveLength(0)
  })
})

describe('today', () => {
  const rows = [
    lesson({
      lesson_date: '2026-10-08',
      planned_start: '09:00',
      status: 'held',
      confirmed_at: '2026-10-08T04:02:00Z',
      attendance: [
        ...Array.from({ length: 7 }, () => ({ status: 'present' as const })),
        { status: 'absent_frozen' as const },
      ],
    }),
    lesson({ lesson_date: '2026-10-08', planned_start: '11:00' }),
    lesson({ lesson_date: '2026-10-08', planned_start: '14:00' }),
    lesson({ lesson_date: '2026-10-08', planned_start: '15:00', teacher: AIPERI, students: 4 }),
    lesson({
      lesson_date: '2026-10-08',
      planned_start: '18:00',
      status: 'cancelled',
      cancel_reason: 'center',
    }),
  ]

  it('counts the day for the KPI', () => {
    const k = dayKpi(rows, NOW)
    expect(k).toEqual({ total: 4, held: 1, current: 1, upcoming: 1, unconfirmed: 1 })
    expect(dayKpiCaption(k)).toBe('1 проведено · 1 идёт · 1 впереди · 1 не подтв.')
    expect(dayKpiCaption({ ...k, current: 2, unconfirmed: 0 }, { short: true })).toBe(
      '1 проведено · 2 идут',
    )
  })

  it('describes rows as on А1 and АМ1', () => {
    const [held, ended, current, next, cancelled] = rows as [
      AdminLesson,
      AdminLesson,
      AdminLesson,
      AdminLesson,
      AdminLesson,
    ]
    expect(dashboardCaption(held)).toBe('Гульзат · был 7 · заморозка 1')
    expect(dashboardChip(held, NOW).label).toBe('Проведено 10:02')
    expect(dashboardCaption(current)).toBe('Гульзат · 8 учеников · каб. 2')
    expect(dashboardChip(current, NOW).label).toBe('Идёт')
    expect(dashboardChip(next, NOW).label).toBe('Далее')
    expect(dashboardChip(ended, NOW).label).toBe('Не подтверждено')
    expect(dashboardCaption(cancelled)).toBe('Гульзат · отменил центр')
    expect(mobileCaption(held, NOW)).toBe('Гульзат · 7 из 8')
    expect(mobileCaption(current, NOW)).toBe('Гульзат · 8 уч · идёт')
    expect(mobileCaption(next, NOW)).toBe('Айпери · 4 уч')
  })
})

describe('payrollMonth', () => {
  it('shows the month being closed until the 15th', () => {
    expect(payrollMonth('2026-10-08')).toEqual({ month: '2026-09', closeBy: '15 октября' })
    expect(payrollMonth('2026-10-16')).toEqual({ month: '2026-10', closeBy: '15 ноября' })
    expect(payrollMonth('2027-01-03')).toEqual({ month: '2026-12', closeBy: '15 января' })
  })
})

describe('week grid', () => {
  it('starts on Monday and shows ПН–СБ, Sunday only when used', () => {
    expect(weekStart('2026-10-08')).toBe('2026-10-05')
    expect(weekStart('2026-10-11')).toBe('2026-10-05')
    expect(weekStart('2026-10-05')).toBe('2026-10-05')
    const days = weekDays('2026-10-05', [])
    expect(days).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ])
    expect(weekDays('2026-10-05', [{ lesson_date: '2026-10-11' }])).toHaveLength(7)
    expect(weekTitle(days)).toBe('5 – 10 октября')
    expect(weekTitle(weekDays('2026-09-28', []))).toBe('28 сентября – 3 октября')
    expect(dayHeader('2026-10-05', '2026-10-08')).toBe('ПН 5')
    expect(dayHeader('2026-10-08', '2026-10-08')).toBe('ЧТ 8 · сегодня')
  })

  it('has a row per hour something starts in', () => {
    expect(
      hourRows([
        { planned_start: '14:00:00' },
        { planned_start: '09:30' },
        { planned_start: '09:00' },
      ]),
    ).toEqual(['09:00', '14:00'])
  })

  it('colours cards by state', () => {
    const held = lesson({
      lesson_date: '2026-10-06',
      planned_start: '14:00',
      status: 'held',
      attendance: [{ status: 'present' }, { status: 'present' }, { status: 'absent_burned' }],
    })
    expect(cardTone(held, NOW)).toBe('held')
    expect(cardText(held, NOW)).toEqual({
      title: 'Математика · 8 класс Б',
      caption: 'Гульзат · 2 + 1 сгорел',
    })
    const current = lesson({ lesson_date: '2026-10-08', planned_start: '14:00' })
    expect(cardText(current, NOW)).toEqual({
      title: 'Математика · 8 класс Б · идёт',
      caption: 'Гульзат · 8 уч',
    })
    const missed = lesson({ lesson_date: '2026-10-07', planned_start: '15:00' })
    expect(cardTone(missed, NOW)).toBe('unconfirmed')
    expect(cardText(missed, NOW).caption).toBe('Гульзат · не подтверждено')
    const extra = lesson({
      lesson_date: '2026-10-10',
      planned_start: '15:00',
      is_extra: true,
      makesUpFor: '2026-10-01',
    })
    expect(cardTone(extra, NOW)).toBe('extra')
    expect(cardText(extra, NOW)).toEqual({
      title: 'Математика · 8 класс Б · доп',
      caption: 'Гульзат · за 1 окт',
    })
    const cancelled = lesson({
      lesson_date: '2026-10-09',
      planned_start: '18:00',
      status: 'cancelled',
      cancel_reason: 'teacher',
    })
    expect(cardText(cancelled, NOW)).toEqual({
      title: 'Математика · 8 класс Б · отменено',
      caption: 'Гульзат · отменил учитель',
    })
    const forming = lesson({
      lesson_date: '2026-10-10',
      planned_start: '18:00',
      group: { ...current.group, status: 'forming' },
    })
    expect(cardTone(forming, NOW)).toBe('forming')
    expect(cardText(forming, NOW).title).toBe('Математика · 8 класс Б · набор')
  })

  it('filters by teacher and «не подтверждено»', () => {
    const a = lesson({ lesson_date: '2026-10-07', planned_start: '15:00' })
    const b = lesson({ lesson_date: '2026-10-07', planned_start: '18:00', teacher: AIPERI })
    const c = lesson({ lesson_date: '2026-10-07', planned_start: '11:00', status: 'held' })
    const d = lesson({ lesson_date: '2026-10-09', planned_start: '11:00' })
    expect(filterLessons([a, b, c, d], { teacher: 't2' }, NOW)).toEqual([b])
    expect(filterLessons([a, b, c, d], { unconfirmed: true }, NOW)).toEqual([a, b])
    expect(filterLessons([a, b, c, d], { unconfirmed: true, teacher: 't1' }, NOW)).toEqual([a])
  })

  it('lists other weeks with unconfirmed lessons', () => {
    expect(
      otherWeeks(
        [
          { lesson_date: '2026-10-01' },
          { lesson_date: '2026-10-02' },
          { lesson_date: '2026-10-06' },
        ],
        '2026-10-05',
      ),
    ).toEqual([{ monday: '2026-09-28', count: 2 }])
  })
})
