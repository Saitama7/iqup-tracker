import {
  desktopMeta,
  enrolledOn,
  freezeBlocked,
  lessonAccrual,
  lessonRoster,
  markAllPresent,
  marksPayload,
  mobileMeta,
  pickSubscription,
  tally,
  type EnrollmentSource,
  type Mark,
  type SubscriptionSource,
} from './attendance'

const LESSON = 'lesson-now'

const sub = (
  id: string,
  over: Partial<SubscriptionSource> = {},
  marks: Mark[] = [],
): SubscriptionSource => ({
  id,
  status: 'active',
  started_at: '2026-09-01',
  created_at: '2026-09-01T10:00:00Z',
  lessons_total: 12,
  price_full: 3200,
  price_final: 3200,
  freeze_limit: 2,
  marks: marks.map((status, i) => ({ lesson_id: `${id}-l${i}`, status })),
  ...over,
})

const times = (n: number, m: Mark): Mark[] => Array.from({ length: n }, () => m)

const enrollment = (
  name: string,
  subs: SubscriptionSource[],
  over: Partial<EnrollmentSource> = {},
): EnrollmentSource => ({
  start_date: '2026-09-01',
  end_date: null,
  status: 'active',
  student: { id: `id-${name}`, full_name: name, parent_phone: null },
  subscriptions: subs,
  ...over,
})

describe('enrolledOn', () => {
  it('from start_date to end_date inclusive', () => {
    const e = { start_date: '2026-09-10', end_date: '2026-10-08', status: 'finished' as const }
    expect(enrolledOn(e, '2026-09-09')).toBe(false)
    expect(enrolledOn(e, '2026-09-10')).toBe(true)
    expect(enrolledOn(e, '2026-10-08')).toBe(true)
    expect(enrolledOn(e, '2026-10-09')).toBe(false)
  })

  it('finished without end_date is off the roster', () => {
    expect(
      enrolledOn({ start_date: '2026-09-01', end_date: null, status: 'finished' }, '2026-10-08'),
    ).toBe(false)
  })
})

describe('pickSubscription (same rule as attendance_subscription, 0010)', () => {
  it('oldest active with lessons left', () => {
    const subs = [
      sub('second', { started_at: '2026-10-01' }),
      sub('first', {}, times(11, 'present')),
    ]
    expect(pickSubscription(subs, LESSON)?.subscriptionId).toBe('first')
    expect(pickSubscription(subs, LESSON)?.left).toBe(1)
  })

  it('first used up → the next active one', () => {
    const subs = [
      sub('first', {}, times(12, 'present')),
      sub('second', { started_at: '2026-10-01' }),
    ]
    expect(pickSubscription(subs, LESSON)?.subscriptionId).toBe('second')
  })

  it('nothing left → the newest non-refunded one, «в долг»', () => {
    const subs = [
      sub('old', {}, times(12, 'present')),
      sub('new', { started_at: '2026-09-20', status: 'exhausted' }, times(13, 'absent_burned')),
      sub('refunded', { started_at: '2026-10-01', status: 'refunded' }),
    ]
    const b = pickSubscription(subs, LESSON)
    expect(b?.subscriptionId).toBe('new')
    expect(b?.left).toBe(-1)
  })

  it('this lesson’s own mark is not counted; frozen marks do not consume', () => {
    const s = sub('s', {}, ['absent_frozen', 'present'])
    const own = {
      ...s,
      marks: [...s.marks, { lesson_id: LESSON, status: 'absent_frozen' as const }],
    }
    const b = pickSubscription([own], LESSON)
    expect(b?.left).toBe(11)
    expect(b?.freezes).toBe(1)
  })

  it('no subscriptions → null', () => {
    expect(pickSubscription([], LESSON)).toBeNull()
  })
})

describe('lessonRoster', () => {
  const enrollments = [
    enrollment('Сабина Темирова', [sub('a')]),
    enrollment('Алина Исакова', [sub('b')]),
    enrollment('Улан Жээнбеков', [sub('c')], { start_date: '2026-10-09' }),
  ]

  it('planned: enrolled on the lesson date, by name', () => {
    const rows = lessonRoster(
      enrollments,
      { id: LESSON, lesson_date: '2026-10-08', status: 'planned' },
      new Map(),
    )
    expect(rows.map((r) => r.fullName)).toEqual(['Алина Исакова', 'Сабина Темирова'])
    expect(rows[0]?.initials).toBe('АИ')
  })

  it('held: those with a mark', () => {
    const rows = lessonRoster(
      enrollments,
      { id: LESSON, lesson_date: '2026-10-08', status: 'held' },
      new Map([['id-Улан Жээнбеков', 'present' as const]]),
    )
    expect(rows.map((r) => r.fullName)).toEqual(['Улан Жээнбеков'])
  })
})

describe("lessonAccrual — «Начислится» by the students' subscriptions (К6, И18)", () => {
  const lesson = { id: LESSON, lesson_date: '2026-10-08', status: 'planned' as const }

  it('each consumed mark by the full price of its subscription; discount ignored (К3)', () => {
    const rows = lessonRoster(
      [
        enrollment('А', [sub('a')]),
        // −10 %: pays 2 880, the teacher still gets 3 200 / 12 × 45 % = 120
        enrollment('Б', [sub('b', { price_final: 2880 })]),
        // bought at 3 000 before the tariff change — stays 3 000 / 12 × 45 % = 112,5
        enrollment('В', [sub('c', { price_full: 3000, price_final: 3000 })]),
        enrollment('Г', [sub('d')]),
      ],
      lesson,
      new Map(),
    )
    const marks = new Map<string, Mark>([
      ['id-А', 'present'],
      ['id-Б', 'absent_burned'],
      ['id-В', 'present'],
      ['id-Г', 'absent_frozen'],
    ])
    // 120 + 120 + 112,5 = 352,5 → 353; two prices → no «за ученико-урок»
    expect(lessonAccrual(rows, marks, 45)).toEqual({ pay: 353, perStudentLesson: null })
  })

  it('one price → «120 сом за ученико-урок»; a student without a subscription pays 0', () => {
    const rows = lessonRoster(
      [enrollment('А', [sub('a')]), enrollment('Пробный', [])],
      lesson,
      new Map(),
    )
    const marks = new Map<string, Mark>([
      ['id-А', 'present'],
      ['id-Пробный', 'present'],
    ])
    expect(rows.find((r) => r.fullName === 'Пробный')?.paySubscription).toBeNull()
    expect(lessonAccrual(rows, marks, 45)).toEqual({ pay: 120, perStudentLesson: 120 })
  })

  it('held: the subscription holding the mark, even if another one is picked next', () => {
    const used = sub('old', { price_full: 3000, status: 'exhausted' }, times(12, 'present'))
    const withMark = {
      ...used,
      marks: [...used.marks.slice(1), { lesson_id: LESSON, status: 'present' as const }],
    }
    const rows = lessonRoster(
      [enrollment('А', [withMark, sub('new', { started_at: '2026-10-01' })])],
      { ...lesson, status: 'held' },
      new Map([['id-А', 'present' as const]]),
    )
    expect(rows[0]?.paySubscription).toEqual({ price_full: 3000, lessons_total: 12 })
  })
})

describe('freeze limit', () => {
  const row = { balance: pickSubscription([sub('s', {}, times(2, 'absent_frozen'))], LESSON) }

  it('2 freezes used → «Заморозка» blocked', () => {
    expect(freezeBlocked(row, undefined)).toBe(true)
    expect(freezeBlocked(row, 'present')).toBe(true)
  })

  it('one left → allowed', () => {
    const one = { balance: pickSubscription([sub('s', {}, ['absent_frozen'])], LESSON) }
    expect(freezeBlocked(one, undefined)).toBe(false)
  })

  it('no subscription → never blocked', () => {
    expect(freezeBlocked({ balance: null }, undefined)).toBe(false)
  })
})

describe('captions', () => {
  const balance = (marks: Mark[]) => ({ balance: pickSubscription([sub('s', {}, marks)], LESSON) })

  it('mobile (У3)', () => {
    expect(mobileMeta(balance([...times(8, 'present'), 'absent_frozen']))).toEqual({
      text: 'Осталось 4 ур. · заморозок 1/2',
      tone: 'muted',
    })
    expect(mobileMeta(balance(times(11, 'present'))).text).toBe('Осталось 1 ур. · пора оплачивать')
    expect(mobileMeta(balance(times(14, 'present')))).toEqual({
      text: 'Долг 2 ур. · абонемент не оплачен',
      tone: 'debt',
    })
  })

  it('desktop (УД2)', () => {
    expect(desktopMeta(balance([...times(8, 'present'), 'absent_frozen'])).text).toBe(
      '4 из 12 · заморозок 1/2',
    )
    expect(desktopMeta(balance([...times(5, 'present'), ...times(2, 'absent_frozen')])).text).toBe(
      '7 из 12 · заморозок 2/2 — лимит',
    )
    expect(desktopMeta(balance(times(11, 'present'))).text).toBe('1 из 12 · пора оплачивать')
    // 3 200 / 12 × 2 = 533 сом
    expect(desktopMeta(balance(times(14, 'present'))).text).toBe('долг 2 урока · 533 сом')
  })
})

describe('marks', () => {
  const rows = [{ studentId: 'a' }, { studentId: 'b' }, { studentId: 'c' }]

  it('tally counts and paid student-lessons (present + burned)', () => {
    const t = tally(
      rows,
      new Map<string, Mark>([
        ['a', 'present'],
        ['b', 'absent_frozen'],
      ]),
    )
    expect(t).toEqual({
      present: 1,
      frozen: 1,
      burned: 0,
      marked: 2,
      total: 3,
      unmarked: 1,
      studentLessons: 1,
    })
  })

  it('«Все были» fills only the unmarked', () => {
    const next = markAllPresent(rows, new Map<string, Mark>([['b', 'absent_burned']]))
    expect([...next.entries()].sort()).toEqual([
      ['a', 'present'],
      ['b', 'absent_burned'],
      ['c', 'present'],
    ])
  })

  it('payload: roster order, marked only', () => {
    expect(marksPayload(rows, new Map<string, Mark>([['c', 'present']]))).toEqual([
      { student_id: 'c', status: 'present' },
    ])
  })
})
