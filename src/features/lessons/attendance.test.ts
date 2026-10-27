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
  studentPay,
  tally,
  type EnrollmentSource,
  type Mark,
  type SubscriptionSource,
} from './attendance'

const LESSON = 'lesson-now'
const DAY = '2026-10-08'

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
  paid: 3200,
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
    expect(pickSubscription(subs, LESSON, DAY)?.subscriptionId).toBe('first')
    expect(pickSubscription(subs, LESSON, DAY)?.left).toBe(1)
  })

  it('first used up → the next active one', () => {
    const subs = [
      sub('first', {}, times(12, 'present')),
      sub('second', { started_at: '2026-10-01' }),
    ]
    expect(pickSubscription(subs, LESSON, DAY)?.subscriptionId).toBe('second')
  })

  it('nothing left → the newest non-refunded one, «в долг»', () => {
    const subs = [
      sub('old', {}, times(12, 'present')),
      sub('new', { started_at: '2026-09-20', status: 'exhausted' }, times(13, 'absent_burned')),
      sub('refunded', { started_at: '2026-10-01', status: 'refunded' }),
    ]
    const b = pickSubscription(subs, LESSON, DAY)
    expect(b?.subscriptionId).toBe('new')
    expect(b?.left).toBe(-1)
  })

  it('this lesson’s own mark is not counted; frozen marks do not consume', () => {
    const s = sub('s', {}, ['absent_frozen', 'present'])
    const own = {
      ...s,
      marks: [...s.marks, { lesson_id: LESSON, status: 'absent_frozen' as const }],
    }
    const b = pickSubscription([own], LESSON, DAY)
    expect(b?.left).toBe(11)
    expect(b?.freezes).toBe(1)
  })

  it('no subscriptions → null', () => {
    expect(pickSubscription([], LESSON, DAY)).toBeNull()
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

  it('held: those with a mark, even if no longer enrolled on the date', () => {
    const rows = lessonRoster(
      [enrollment('Улан Жээнбеков', [sub('c')], { start_date: '2026-10-09' })],
      { id: LESSON, lesson_date: '2026-10-08', status: 'held' },
      new Map([['id-Улан Жээнбеков', 'present' as const]]),
    )
    expect(rows.map((r) => [r.fullName, r.unmarked])).toEqual([['Улан Жээнбеков', false]])
  })

  it('held (#107): plus those enrolled on the date without a mark — unmarked', () => {
    const rows = lessonRoster(
      [
        ...enrollments,
        // enrolled retroactively from 12.10 — the lessons from then on have no mark of her
        enrollment('Айзат Кадырбекова', [sub('d', { started_at: '2026-10-12' })], {
          start_date: '2026-10-08',
        }),
        // left before the lesson / finished without end_date
        enrollment('Бекжан', [sub('e')], { end_date: '2026-10-07', status: 'finished' }),
        enrollment('Нурай', [sub('f')], { status: 'finished' }),
      ],
      { id: LESSON, lesson_date: '2026-10-08', status: 'held' },
      new Map([['id-Сабина Темирова', 'present' as const]]),
    )
    expect(rows.map((r) => [r.fullName, r.unmarked])).toEqual([
      ['Айзат Кадырбекова', true],
      ['Алина Исакова', true],
      ['Сабина Темирова', false],
    ])
    // the mark would go where confirm_lesson / correct_attendance put it (attendance_subscription)
    expect(rows[0]?.balance?.subscriptionId).toBe('d')
    expect(rows[0]?.paySubscription).toEqual({
      price_full: 3200,
      lessons_total: 12,
      hours_total: null,
    })
  })

  it('held: unmarked students stay out of the counts and the accrual', () => {
    const lesson = { id: LESSON, lesson_date: '2026-10-08', status: 'held' as const }
    const saved = new Map([['id-Сабина Темирова', 'present' as const]])
    const rows = lessonRoster(enrollments, lesson, saved)
    expect(tally(rows, saved)).toMatchObject({ present: 1, frozen: 0, burned: 0, unmarked: 1 })
    expect(lessonAccrual(rows, saved, 45).pay).toBe(120)
    expect(marksPayload(rows, saved)).toEqual([
      { student_id: 'id-Сабина Темирова', status: 'present' },
    ])
  })

  it('planned and cancelled lessons have no unmarked rows', () => {
    for (const status of ['planned', 'cancelled'] as const) {
      const rows = lessonRoster(enrollments, { id: LESSON, lesson_date: DAY, status }, new Map())
      expect(rows.every((r) => !r.unmarked)).toBe(true)
    }
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
    expect(rows[0]?.paySubscription).toEqual({
      price_full: 3000,
      lessons_total: 12,
      hours_total: null,
    })
  })
})

describe('freeze limit', () => {
  const row = { balance: pickSubscription([sub('s', {}, times(2, 'absent_frozen'))], LESSON, DAY) }

  it('2 freezes used → «Заморозка» blocked', () => {
    expect(freezeBlocked(row, undefined)).toBe(true)
    expect(freezeBlocked(row, 'present')).toBe(true)
  })

  it('one left → allowed', () => {
    const one = { balance: pickSubscription([sub('s', {}, ['absent_frozen'])], LESSON, DAY) }
    expect(freezeBlocked(one, undefined)).toBe(false)
  })

  it('no subscription → never blocked', () => {
    expect(freezeBlocked({ balance: null }, undefined)).toBe(false)
  })
})

describe('captions', () => {
  const meta = (marks: Mark[], over: Partial<SubscriptionSource> = {}) => {
    const subs = [sub('s', over, marks)]
    return { balance: pickSubscription(subs, LESSON, DAY), pay: studentPay(subs, LESSON) }
  }

  it('mobile (У3)', () => {
    expect(mobileMeta(meta([...times(8, 'present'), 'absent_frozen']))).toEqual({
      text: 'Осталось 4 ур. · заморозок 1/2',
      tone: 'muted',
    })
    expect(mobileMeta(meta(times(11, 'present'))).text).toBe('Осталось 1 ур. · пора оплачивать')
    expect(mobileMeta(meta(times(14, 'present')))).toEqual({
      text: 'Долг 2 ур. · 534 сом',
      tone: 'warn',
    })
  })

  it('debt beyond 3 lessons is red', () => {
    expect(mobileMeta(meta(times(16, 'present'))).tone).toBe('debt')
    expect(desktopMeta(meta(times(15, 'present'))).tone).toBe('warn')
  })

  it('partial payment: 6 lessons open, the rest unpaid', () => {
    const half = { paid: 1600 }
    expect(mobileMeta(meta(times(2, 'present'), half))).toEqual({
      text: 'Частично · оплачено 6 ур · заморозок 0/2',
      tone: 'warn',
    })
    expect(mobileMeta(meta(times(5, 'present'), half)).text).toBe(
      'Оплачено ещё 1 ур. · пора оплачивать',
    )
    // 8 used, 6 paid: 2 lessons «в долг» = 8 × 266.67 − 1 600 = 533,33 → 534 сом (ceil, И37)
    expect(desktopMeta(meta(times(8, 'present'), half))).toEqual({
      text: 'долг 2 урока · 534 сом',
      tone: 'warn',
    })
    expect(desktopMeta(meta(times(2, 'present'), half)).text).toBe(
      'частично · оплачено 6 ур · заморозок 0/2',
    )
  })

  it('desktop (УД2)', () => {
    expect(desktopMeta(meta([...times(8, 'present'), 'absent_frozen'])).text).toBe(
      '4 из 12 · заморозок 1/2',
    )
    expect(desktopMeta(meta([...times(5, 'present'), ...times(2, 'absent_frozen')])).text).toBe(
      '7 из 12 · заморозок 2/2 — лимит',
    )
    expect(desktopMeta(meta(times(11, 'present'))).text).toBe('1 из 12 · пора оплачивать')
    // 3 200 / 12 × 2 = 533,33 → 534 сом (ceil, И37)
    expect(desktopMeta(meta(times(14, 'present'))).text).toBe('долг 2 урока · 534 сом')
  })

  it('no subscription', () => {
    expect(mobileMeta({ balance: null, pay: null })).toEqual({
      text: 'Нет абонемента',
      tone: 'debt',
    })
  })
})

describe('studentPay', () => {
  it('does not count the mark of the lesson itself', () => {
    const base = sub('s', {}, times(12, 'present'))
    const subs = [
      { ...base, marks: [...base.marks, { lesson_id: LESSON, status: 'present' as const }] },
    ]
    expect(studentPay(subs, LESSON)).toMatchObject({ state: 'soon', debtLessons: 0 })
    expect(studentPay(subs, null)).toMatchObject({ state: 'debt', debtLessons: 1 })
  })

  it('an old subscription that still owes counts in the debt', () => {
    const old = sub('old', { paid: 1600 }, times(12, 'present'))
    const fresh = sub('fresh', { started_at: '2026-10-01' }, [])
    // old: 6 paid, 12 used — 6 over its package... the 6 unpaid ones stay on it (capacity 12)
    expect(studentPay([old, fresh], LESSON)).toMatchObject({ state: 'debt', debtLessons: 6 })
  })

  it('refunded only — nothing to pay', () => {
    expect(studentPay([sub('r', { status: 'refunded' })], LESSON)).toBeNull()
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

describe('after-school by hours (#82)', () => {
  // ПН 2 / СР 1 / ПТ 2 from 1 October; 8 October 2026 is a Thursday, 9th a Friday
  const plans = [{ valid_from: '2026-10-01', hours: [2, 0, 1, 0, 2, 0, 0] }]
  const hourSub = (marks: { lesson_id: string; status: Mark; hours: number }[], paid = 2000) =>
    sub('h', {
      started_at: '2026-10-01',
      period_month: '2026-10-01',
      lessons_total: 12,
      hours_total: 20,
      price_full: 2000,
      price_final: 2000,
      paid,
      marks,
    })

  it('roster: a student with 0 h that day is not expected; no plan — as before', () => {
    const list = [enrollment('Айпери', [hourSub([])], { plans }), enrollment('Бектур', [sub('b')])]
    const thursday = lessonRoster(
      list,
      { id: LESSON, lesson_date: '2026-10-08', status: 'planned' },
      new Map(),
    )
    expect(thursday.map((r) => r.fullName)).toEqual(['Бектур'])
    const friday = lessonRoster(
      list,
      { id: LESSON, lesson_date: '2026-10-09', status: 'planned' },
      new Map(),
    )
    expect(friday.map((r) => [r.fullName, r.hours])).toEqual([
      ['Айпери', 2],
      ['Бектур', null],
    ])
  })

  it('held (#107): an after-school student with 0 h that day is not unmarked', () => {
    const list = [enrollment('Айпери', [hourSub([])], { plans }), enrollment('Бектур', [sub('b')])]
    const thursday = lessonRoster(
      list,
      { id: LESSON, lesson_date: '2026-10-08', status: 'held' },
      new Map(),
    )
    expect(thursday.map((r) => [r.fullName, r.unmarked])).toEqual([['Бектур', true]])
    const friday = lessonRoster(
      list,
      { id: LESSON, lesson_date: '2026-10-09', status: 'held' },
      new Map(),
    )
    expect(friday.map((r) => [r.fullName, r.hours, r.unmarked])).toEqual([
      ['Айпери', 2, true],
      ['Бектур', null, true],
    ])
  })

  it('balance in hours and «Осталось 16 ч», pay by the day hours', () => {
    const marks = [
      { lesson_id: 'm1', status: 'present' as const, hours: 2 },
      { lesson_id: 'm2', status: 'absent_burned' as const, hours: 2 },
      { lesson_id: 'm3', status: 'absent_frozen' as const, hours: 1 },
    ]
    const [row] = lessonRoster(
      [enrollment('Айпери', [hourSub(marks)], { plans })],
      { id: LESSON, lesson_date: '2026-10-09', status: 'planned' },
      new Map(),
    )
    expect(row?.balance).toMatchObject({ unit: 'hour', total: 20, left: 16, freezes: 1 })
    expect(row && mobileMeta(row).text).toBe('Осталось 16 ч · заморозок 1/2')
    expect(row && desktopMeta(row).text).toBe('16 из 20 ч · заморозок 1/2')
    // 2 h × 100 сом/ч × 45 %
    expect(row && lessonAccrual([row], new Map([[row.studentId, 'present']]), 45)).toEqual({
      pay: 90,
      perStudentLesson: null,
    })
  })

  it('debt in hours', () => {
    const [row] = lessonRoster(
      [
        enrollment('Айпери', [hourSub([{ lesson_id: 'm1', status: 'present', hours: 2 }], 0)], {
          plans,
        }),
      ],
      { id: LESSON, lesson_date: '2026-10-09', status: 'planned' },
      new Map(),
    )
    expect(row && mobileMeta(row).text).toBe('Долг 2 ч · 200 сом')
  })

  it('a mark goes to the invoice of its month; a month not invoiced — none; the package before', () => {
    const pkg = sub('pkg', { started_at: '2026-09-01' }, times(12, 'present'))
    const oct = hourSub([
      { lesson_id: 'f1', status: 'absent_frozen', hours: 2 },
      { lesson_id: 'f2', status: 'absent_frozen', hours: 2 },
    ])
    const nov = sub('nov', {
      started_at: '2026-11-01',
      created_at: '2026-10-25T10:00:00Z',
      period_month: '2026-11-01',
      lessons_total: 10,
      hours_total: 18,
      credit_hours: 4,
      price_full: 1800,
      price_final: 1800,
      paid: 0,
    })
    // October has 16 h left and 2/2 freezes — a November day still goes to November
    expect(pickSubscription([pkg, oct, nov], LESSON, '2026-11-02')).toMatchObject({
      subscriptionId: 'nov',
      total: 22,
      freezes: 0,
      lessonPrice: 100,
    })
    expect(pickSubscription([pkg, oct], LESSON, '2026-11-02')).toBeNull()
    expect(pickSubscription([pkg, oct, nov], LESSON, '2026-09-30')?.subscriptionId).toBe('pkg')
  })
})
