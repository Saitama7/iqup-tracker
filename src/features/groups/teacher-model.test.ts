import type { EnrollmentSource, Mark, SubscriptionSource } from '@/features/lessons/attendance'
import {
  capacity,
  groupBadges,
  groupsCaption,
  groupSummary,
  inMonth,
  memberCaption,
  memberDebtTone,
  memberRows,
  scheduleDots,
  scheduleRange,
  sinceShort,
  type MonthLesson,
  type TeacherGroup,
} from './teacher-model'

const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+06:00`)
const TODAY = '2026-10-08'

const sub = (
  id: string,
  marks: Mark[],
  over: Partial<SubscriptionSource> = {},
): SubscriptionSource => ({
  id,
  status: 'active',
  started_at: '2026-09-01',
  created_at: '2026-09-01T10:00:00Z',
  lessons_total: 12,
  price_full: 3200,
  price_final: 3200,
  freeze_limit: 2,
  paid: 3200,
  marks: marks.map((status, i) => ({ lesson_id: `${id}-${i}`, status })),
  ...over,
})

const times = (n: number, m: Mark): Mark[] => Array.from({ length: n }, () => m)

const enrollment = (
  name: string,
  s: SubscriptionSource,
  start = '2026-09-01',
): EnrollmentSource => ({
  start_date: start,
  end_date: null,
  status: 'active',
  student: { id: name, full_name: name, parent_phone: '996555123456' },
  subscriptions: [s],
})

const RULES = [2, 4, 6].map((weekday) => ({
  weekday,
  start_time: '14:00:00',
  valid_from: '2026-09-01',
  valid_to: null,
}))

const lesson = (date: string, status: MonthLesson['status'], marks: Mark[] = []): MonthLesson => ({
  id: `${date}-${status}`,
  lesson_date: date,
  planned_start: '14:00:00',
  duration_min: 60,
  status,
  attendance: marks.map((m) => ({
    status: m,
    subscription: { price_full: 3200, lessons_total: 12 },
  })),
})

const group: TeacherGroup = {
  id: 'g',
  name: '8 класс Б',
  subject: 'Математика',
  group_type: 'group',
  status: 'active',
  room: '2',
  schedule_rules: RULES,
  enrollments: [
    enrollment('Айжан Бекова', sub('a', [...times(7, 'present'), 'absent_frozen'])),
    enrollment('Данияр Кадыров', sub('d', times(11, 'present'))),
    enrollment('Элина Сыдыкова', sub('e', times(14, 'present'))),
    enrollment('Новенький', sub('n', []), '2026-10-09'),
    enrollment('Половинка', sub('p', times(2, 'present'), { paid: 1600 })),
  ],
  lessons: [
    lesson('2026-10-01', 'held', ['present', 'present', 'absent_burned', 'absent_frozen']),
    lesson('2026-10-03', 'held', ['present', 'present', 'present']),
    lesson('2026-10-06', 'planned'),
    lesson('2026-10-08', 'planned'),
  ],
}

const source = {
  rates: [{ percent: 45, valid_from: '2026-09-01' }],
  tariffs: [
    {
      group_type: 'group' as const,
      valid_from: '2026-09-01',
      lessons_in_package: 12,
      package_price: 3200,
      max_students: 10,
      lesson_duration_min: 60,
    },
  ],
}

describe('memberRows', () => {
  const rows = memberRows(group, TODAY)

  it('enrolled today, by name, with balances', () => {
    expect(rows.map((r) => r.fullName)).toEqual([
      'Айжан Бекова',
      'Данияр Кадыров',
      'Половинка',
      'Элина Сыдыкова',
    ])
    expect(rows[0]?.balance?.left).toBe(5)
    expect(rows.map((r) => r.pay)).toEqual(['ok', 'soon', 'partial', 'debt'])
  })

  it('debt in lessons and som (price with the discount)', () => {
    const debtor = rows[3]
    expect(debtor).toMatchObject({ debt: 2, debtSom: 534 })
    expect(memberDebtTone({ balance: debtor?.balance ?? null, debt: 2 })).toBe('warn')
  })

  it('partial payment: paid lessons, no debt yet', () => {
    expect(rows[2]).toMatchObject({ debt: 0, paidLessons: 6, pay: 'partial' })
    expect(memberDebtTone({ balance: rows[3]?.balance ?? null, debt: 4 })).toBe('debt')
  })

  it('captions as on У5', () => {
    const [a, d, p, e] = rows
    if (!a || !d || !p || !e) throw new Error('rows')
    expect(memberCaption(a, null)).toBe('с 1 сент · заморозок 1 / 2')
    expect(memberCaption(d, null)).toBe('пора оплачивать · заморозок 0 / 2')
    expect(memberCaption(p, null)).toBe('частично · оплачено 6 ур · заморозок 0 / 2')
    expect(memberCaption(e, '0555 123 456')).toBe('долг 2 урока · 534 сом · родитель 0555 123 456')
  })
})

describe('groupSummary', () => {
  it('month counts, paid student-lessons and preliminary accrual', () => {
    const s = groupSummary(group, source, TODAY, at(TODAY, '14:20'))
    // 3200 / 12 × 45 % = 120 сом × (3 + 3) paid marks
    expect(s).toMatchObject({
      students: 4,
      maxStudents: 10,
      held: 2,
      studentLessons: 6,
      accrued: 720,
      debtors: 1,
      ending: 1,
      unconfirmed: 1,
      isNow: true,
    })
    expect(capacity(s)).toBe('4 / 10')
  })

  it('badges of У4', () => {
    const s = groupSummary(group, source, TODAY, at(TODAY, '16:00'))
    expect(groupBadges(s, 'Групповая', inMonth(TODAY)).map((b) => b.text)).toEqual([
      'Групповая',
      'В октябре: 2 занятия',
      '1 долг',
      '1 заканчивает абонемент',
      '2 не подтверждено',
    ])
  })
})

describe('captions', () => {
  it('schedule', () => {
    expect(scheduleDots(RULES, TODAY)).toBe('ВТ · ЧТ · СБ · 14:00')
    expect(scheduleRange(RULES, TODAY, 60)).toBe('ВТ · ЧТ · СБ · 14:00–15:00')
  })

  it('eyebrow and dates', () => {
    expect(
      groupsCaption([{ students: 8 }, { students: 6 }, { students: 8 }, { students: 6 }]),
    ).toBe('4 группы · 28 учеников')
    expect(sinceShort('2026-09-15')).toBe('с 15 сент')
  })
})
