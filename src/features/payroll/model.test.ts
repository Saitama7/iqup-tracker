import { describe, expect, it } from 'vitest'
import type { TariffTerms } from '@/features/tariffs/current'
import {
  confirmedCaption,
  formulaNote,
  groupCaption,
  hoursCaption,
  lessonWhen,
  marksCaption,
  monthEnd,
  myMonthView,
  payday,
  payrollCaption,
  payrollView,
  periodCaption,
  pickMonth,
  ROUNDING_NOTE,
  shiftMonth,
  type MyMonthGroup,
  type MyMonthLesson,
} from './model'

const at = (iso: string) => Date.parse(iso)
// 12 Oct 2026, 16:00 in Bishkek
const NOW = at('2026-10-12T16:00:00+06:00')

const TARIFFS: TariffTerms[] = [
  { group_type: 'group', valid_from: '2026-09-01', lessons_in_package: 12, package_price: 3200 },
  {
    group_type: 'individual',
    valid_from: '2026-09-01',
    lessons_in_package: 12,
    package_price: 7200,
  },
]
const RATES = [{ percent: 45, valid_from: '2026-09-01' }]

let seq = 0
function lesson(over: Partial<MyMonthLesson> = {}): MyMonthLesson {
  seq++
  return {
    id: `l${seq}`,
    lesson_date: '2026-10-08',
    planned_start: '09:00:00',
    duration_min: 60,
    status: 'held',
    confirmed_at: '2026-10-08T04:02:00Z', // 10:02 Bishkek
    confirmed_late: false,
    attendance: [{ status: 'present' }],
    ...over,
  }
}

function group(id: string, name: string, lessons: MyMonthLesson[], students = 8): MyMonthGroup {
  return {
    id,
    name,
    subject: 'Математика',
    group_type: 'group',
    enrollments: Array.from({ length: students }, (_, i) => ({
      student_id: `${id}-s${i}`,
      start_date: '2026-09-01',
      end_date: null,
      status: 'active' as const,
    })),
    lessons,
  }
}

describe('months', () => {
  it('shifts across a year and knows the last day', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(monthEnd('2026-09')).toBe('2026-09-30')
    expect(monthEnd('2028-02')).toBe('2028-02-29')
    expect(payday('2026-09')).toBe('15 октября')
  })

  it('pickMonth: a valid past month from the URL, never a future one', () => {
    expect(pickMonth('2026-09', '2026-10-12')).toBe('2026-09')
    expect(pickMonth('2026-11', '2026-10-12')).toBe('2026-10')
    expect(pickMonth(undefined, '2026-10-12')).toBe('2026-10')
    expect(pickMonth('2026-13', '2026-10-12')).toBe('2026-10')
  })

  it('periodCaption: «1–12 окт» for the running month, «период открыт» for a past one', () => {
    expect(periodCaption('2026-10', '2026-10-12')).toBe('Предварительно · 1–12 окт')
    expect(periodCaption('2026-10', '2026-10-01')).toBe('Предварительно · 1 окт')
    expect(periodCaption('2026-09', '2026-10-12')).toBe('Предварительно · период открыт')
  })
})

describe('lesson captions (УД4)', () => {
  it('«8 окт, чт · 09:00»', () => {
    expect(lessonWhen({ lesson_date: '2026-10-08', planned_start: '09:00:00' })).toBe(
      '8 окт, чт · 09:00',
    )
  })

  it('«Был 7 · Заморозка 1 · Не был 1»', () => {
    expect(
      marksCaption([
        ...Array.from({ length: 7 }, () => ({ status: 'present' as const })),
        { status: 'absent_burned' },
        { status: 'absent_frozen' },
      ]),
    ).toBe('Был 7 · Заморозка 1 · Не был 1')
  })

  it('confirmed: time on the day, «поздно» on a later day', () => {
    expect(confirmedCaption(lesson())).toEqual({ text: '10:02', late: false })
    expect(
      confirmedCaption(
        lesson({
          lesson_date: '2026-10-06',
          confirmed_at: '2026-10-07T02:40:00Z',
          confirmed_late: true,
        }),
      ),
    ).toEqual({ text: '7 окт 08:40 · поздно', late: true })
    expect(confirmedCaption(lesson({ status: 'planned', confirmed_at: null }))).toBeNull()
  })

  it('hours with a comma', () => {
    expect(hoursCaption(14)).toBe('14 ч')
    expect(hoursCaption(1.5)).toBe('1,5 ч')
  })
})

describe('myMonthView', () => {
  const a = group('a', '8 класс А', [
    lesson({ attendance: Array.from({ length: 7 }, () => ({ status: 'present' })) }),
    lesson({
      lesson_date: '2026-10-06',
      attendance: [{ status: 'present' }, { status: 'absent_frozen' }],
    }),
    lesson({ lesson_date: '2026-10-20', status: 'planned', confirmed_at: null, attendance: [] }),
  ])
  const b = group(
    'b',
    '5 класс',
    [
      lesson({
        lesson_date: '2026-10-07',
        planned_start: '15:00',
        status: 'planned',
        confirmed_at: null,
      }),
      lesson({
        lesson_date: '2026-10-12',
        planned_start: '18:00',
        status: 'planned',
        confirmed_at: null,
      }),
      lesson({
        lesson_date: '2026-10-05',
        status: 'cancelled',
        confirmed_at: null,
        attendance: [],
      }),
    ],
    6,
  )
  const view = myMonthView(
    { teacherId: 't', rates: RATES, groups: [a, b], tariffs: TARIFFS },
    '2026-10',
    NOW,
  )

  it('sums with calc.ts: held only', () => {
    expect(view.pay).toMatchObject({ lessonsHeld: 2, hours: 2, studentLessons: 8, amount: 960 })
    expect(view.percent).toBe(45)
    expect(view.share).toBe(120)
    expect(view.lessonPrice).toBeCloseTo(266.67, 2)
  })

  it('lists held and over-but-unconfirmed lessons, newest first', () => {
    expect(view.lessons.map((l) => [l.when, l.state, l.amount])).toEqual([
      ['8 окт, чт · 09:00', 'held', 840],
      ['7 окт, ср · 15:00', 'unconfirmed', 0],
      ['6 окт, вт · 09:00', 'held', 120],
    ])
    expect(view.unconfirmed.map((l) => l.id)).toEqual([b.lessons[0]?.id])
  })

  it('groups: amount, students, «не подтверждено — не в сумме», «сегодня ещё одно»', () => {
    const [first, second] = view.groups
    if (!first || !second) throw new Error('two groups expected')
    expect(first).toMatchObject({ id: 'a', amount: 960, studentLessons: 8, students: 8 })
    expect(groupCaption(first)).toBe('2 занятия · 8 ученико-уроков · 8 учеников')
    expect(second).toMatchObject({ id: 'b', amount: 0, unconfirmed: 1, laterToday: 1 })
    expect(groupCaption(second)).toBe(
      '0 занятий · 0 ученико-уроков · 1 не подтверждено — не в сумме',
    )
  })

  it('no rounding note when the lines add up (120 сом per student-lesson)', () => {
    expect(view.roundingNote).toBeNull()
  })

  it('rounding note: 3 × 158,33 = 475 in the total, 3 × 158 in the lines', () => {
    const mini = group('m', 'Мини', [
      lesson({ lesson_date: '2026-10-05' }),
      lesson({ lesson_date: '2026-10-06' }),
      lesson({ lesson_date: '2026-10-07' }),
    ])
    const v = myMonthView(
      {
        teacherId: 't',
        rates: [{ percent: 50, valid_from: '2026-09-01' }],
        groups: [mini],
        tariffs: [
          {
            group_type: 'group',
            valid_from: '2026-09-01',
            lessons_in_package: 12,
            package_price: 3800,
          },
        ],
      },
      '2026-10',
      NOW,
    )
    expect(v.lessons.map((l) => l.amount)).toEqual([158, 158, 158])
    expect(v.pay.amount).toBe(475)
    expect(v.roundingNote).toBe(ROUNDING_NOTE)
  })

  it('no common price → no «за ученико-урок»', () => {
    const solo = { ...group('c', 'Бекзат', [], 1), group_type: 'individual' as const }
    const mixed = myMonthView(
      { teacherId: 't', rates: RATES, groups: [a, solo], tariffs: TARIFFS },
      '2026-10',
      NOW,
    )
    expect(mixed.share).toBeNull()
    expect(formulaNote(mixed)).toContain('цена урока × 45 %')
    expect(formulaNote(view)).toContain('266,67 сом × 45 %')
  })
})

describe('payrollView (Б1)', () => {
  const view = payrollView(
    {
      preview: [
        { teacherId: 'g', lessonsHeld: 52, hours: 52, studentLessons: 318, amount: 38_160 },
        { teacherId: 'n', lessonsHeld: 22, hours: 66, studentLessons: 22, amount: 3_663 },
      ],
      teachers: [
        {
          id: 'g',
          full_name: 'Гульзат Асанова',
          rates: RATES,
          groups: Array.from({ length: 4 }, () => ({
            subject: 'Математика',
            status: 'active' as const,
          })),
        },
        {
          id: 'n',
          full_name: 'Нургуль Токтоева',
          rates: RATES,
          groups: [{ subject: 'Продлёнка', status: 'active' }],
        },
        { id: 'x', full_name: 'Аман Новый', rates: [], groups: [] },
      ],
      planned: [
        lesson({ lesson_date: '2026-09-30', status: 'planned' }),
        lesson({ lesson_date: '2026-10-12', planned_start: '18:00', status: 'planned' }),
      ],
    },
    '2026-09',
    NOW,
  )

  it('every teacher, zeros without held lessons, biggest first', () => {
    expect(view.rows.map((r) => [r.name, r.caption, r.amount, r.percent])).toEqual([
      ['Гульзат Асанова', 'Математика · 4 группы', 38_160, 45],
      ['Нургуль Токтоева', 'Продлёнка · 1 группа', 3_663, 45],
      ['Аман Новый', '0 групп', 0, null],
    ])
    expect(view.total).toEqual({ lessonsHeld: 74, hours: 118, studentLessons: 340, amount: 41_823 })
  })

  it('total hours are rounded to 2 decimals, not float noise', () => {
    const v = payrollView(
      {
        preview: [0.1, 0.2, 1.33].map((hours, i) => ({
          teacherId: `t${i}`,
          lessonsHeld: 1,
          hours,
          studentLessons: 1,
          amount: 100,
        })),
        teachers: [0, 1, 2].map((i) => ({
          id: `t${i}`,
          full_name: `T${i}`,
          rates: [],
          groups: [],
        })),
        planned: [],
      },
      '2026-09',
      NOW,
    )
    expect(v.total.hours).toBe(1.63)
    expect(hoursCaption(v.total.hours)).toBe('1,63 ч')
  })

  it('unconfirmed — planned lessons that are over by now', () => {
    expect(view.unconfirmed).toBe(1)
    expect(payrollCaption(view, '2026-09')).toBe(
      'Выплата 15 октября · 3 учителя · 74 занятия проведено · 1 не подтверждено',
    )
  })
})
