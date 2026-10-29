import {
  authorShort,
  bishkekTime,
  describeAuditRow,
  EMPTY_LOOKUPS,
  entryText,
  marksSummary,
  type AuditLookups,
  type AuditRow,
} from './describe'

const ADMIN = 'a0000000-0000-4000-8000-000000000001'
const TEACHER_USER = 'a0000000-0000-4000-8000-000000000002'
const GROUP = 'b0000000-0000-4000-8000-000000000003'
const LESSON = 'c0000000-0000-4000-8000-000000000001'
const ALINA = 'd0000000-0000-4000-8000-000000000001'
const ENROLLMENT = 'e0000000-0000-4000-8000-000000000001'
const GULZAT = 'f0000000-0000-4000-8000-000000000001'
const SUB = '10000000-0000-4000-8000-000000000001'

const lookups: AuditLookups = {
  ...EMPTY_LOOKUPS,
  profiles: { [ADMIN]: 'Каныкей Асанова', [TEACHER_USER]: 'Гульзат Асанова' },
  students: { [ALINA]: 'Алина Исакова' },
  teachers: { [GULZAT]: 'Гульзат Асанова' },
  groups: { [GROUP]: { name: '8 класс Б', subject: 'Математика' } },
  lessons: { [LESSON]: { groupId: GROUP, date: '2026-10-10', start: '09:00:00' } },
  enrollments: { [ENROLLMENT]: { studentId: ALINA, groupId: GROUP } },
  subscriptions: { [SUB]: { enrollmentId: ENROLLMENT, lessons: 12, price: 3200 } },
  tariffs: [
    { id: 't1', groupType: 'group', validFrom: '2025-09-01', price: 3000, lessons: 12 },
    { id: 't2', groupType: 'group', validFrom: '2026-09-01', price: 3200, lessons: 12 },
    { id: 't3', groupType: 'group', validFrom: '2026-11-01', price: 3500, lessons: 12 },
  ],
}

function row(over: Partial<AuditRow>): AuditRow {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    actorId: ADMIN,
    entity: 'lessons',
    entityId: LESSON,
    action: 'update',
    before: null,
    after: null,
    reason: null,
    at: '2026-10-12T07:40:00.123456+00:00',
    kind: 'other',
    marks: null,
    amount: null,
    ...over,
  }
}

// formatSom groups thousands with a non-breaking space
const plain = (parts: Parameters<typeof entryText>[0]) => entryText(parts).replace(/\u00a0/g, ' ')
const text = (r: AuditRow, l: AuditLookups = lookups) => plain(describeAuditRow(r, l).parts)

const lesson = {
  id: LESSON,
  group_id: GROUP,
  lesson_date: '2026-10-10',
  planned_start: '09:00:00',
  status: 'planned',
  is_extra: false,
  confirmed_late: false,
  confirmed_at: null,
  comment: null,
  cancel_reason: null,
  substitute_teacher_id: null,
  is_locked: false,
}

describe('attendance', () => {
  const mark = {
    id: 'm1',
    lesson_id: LESSON,
    student_id: ALINA,
    subscription_id: SUB,
    status: 'present',
  }

  it('an admin changes a mark: «Отметка Алина Исакова: Был → Не был»', () => {
    const r = row({
      entity: 'attendance',
      kind: 'retro',
      before: mark,
      after: { ...mark, status: 'absent_burned' },
    })
    const e = describeAuditRow(r, lookups)
    expect(plain(e.parts)).toBe(
      'Отметка Алина Исакова: Был → Не был · Математика · 8 класс Б, 10.10 в 09:00',
    )
    expect(e.badge).toEqual({ label: 'Правка', tone: 'burned' })
    expect(e.author).toBe('Каныкей Асанова')
    expect(e.link).toMatchObject({ to: '/admin/groups/$groupId', params: { groupId: GROUP } })
    expect(e.parts).toContainEqual({ text: 'Не был', tone: 'burned' })
  })

  it('a mark added and removed outside «Провести»', () => {
    expect(text(row({ entity: 'attendance', action: 'insert', after: mark }))).toBe(
      'Отметка Алина Исакова добавлена: Был · Математика · 8 класс Б, 10.10 в 09:00',
    )
    expect(text(row({ entity: 'attendance', action: 'delete', before: mark }))).toBe(
      'Отметка Алина Исакова удалена (была Был) · Математика · 8 класс Б, 10.10 в 09:00',
    )
  })

  it('reads without lookups (a deleted lesson)', () => {
    expect(
      text(
        row({ entity: 'attendance', before: mark, after: { ...mark, status: 'absent_frozen' } }),
        EMPTY_LOOKUPS,
      ),
    ).toBe('Отметка ученик: Был → Заморозка')
  })

  it('the reason goes to the note, confirm_lesson does not', () => {
    const r = row({
      entity: 'attendance',
      before: mark,
      after: { ...mark, status: 'absent_burned' },
    })
    expect(describeAuditRow({ ...r, reason: 'перепутала с братом' }, lookups).note).toBe(
      'Причина: «перепутала с братом»',
    )
    expect(describeAuditRow({ ...r, reason: 'confirm_lesson' }, lookups).note).toBeNull()
  })

  it('marks removed by cancel_lesson: the code in words (#52)', () => {
    const r = row({ entity: 'attendance', action: 'delete', before: mark })
    expect(describeAuditRow({ ...r, reason: 'cancel: teacher' }, lookups).note).toBe(
      'Причина: занятие отменено — отменил учитель',
    )
    expect(describeAuditRow({ ...r, reason: 'cancel:all_frozen' }, lookups).note).toBe(
      'Причина: занятие отменено — вся группа заморозила',
    )
    expect(describeAuditRow({ ...r, reason: 'archive_group' }, lookups).note).toBe(
      'Причина: группа переведена в архив',
    )
  })
})

describe('attendance corrections (#74)', () => {
  const mark = {
    id: 'm1',
    lesson_id: LESSON,
    student_id: ALINA,
    subscription_id: SUB,
    status: 'present',
  }
  const request = {
    id: 'r1',
    lesson_id: LESSON,
    teacher_id: GULZAT,
    marks: [{ student_id: ALINA, status: 'absent_burned' }],
    comment: 'Алины не было',
    status: 'pending',
    decision_comment: null,
  }

  it('correct_attendance: «Отметки занятия … исправлены: Алина Исакова Был → Не был», reason in the note', () => {
    const e = describeAuditRow(
      row({
        entity: 'attendance',
        kind: 'retro',
        before: mark,
        after: { ...mark, status: 'absent_burned' },
        reason: 'перепутали',
      }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Отметки занятия Математика · 8 класс Б, 10.10 в 09:00 исправлены: Алина Исакова Был → Не был',
    )
    expect(e.badge).toEqual({ label: 'Исправление', tone: 'burned' })
    expect(e.note).toBe('Причина: «перепутали»')
  })

  it('a teacher asks, the admin applies or rejects', () => {
    const asked = describeAuditRow(
      row({
        entity: 'attendance_correction_requests',
        action: 'insert',
        actorId: TEACHER_USER,
        after: request,
      }),
      lookups,
    )
    expect(plain(asked.parts)).toBe(
      'Гульзат Асанова просит исправить отметки занятия Математика · 8 класс Б, 10.10 в 09:00: Алина Исакова → Не был',
    )
    expect(asked.note).toBe('Комментарий: «Алины не было»')
    expect(
      text(
        row({
          entity: 'attendance_correction_requests',
          before: request,
          after: { ...request, status: 'approved' },
        }),
      ),
    ).toBe(
      'запрос Гульзат Асанова на исправление отметок занятия Математика · 8 класс Б, 10.10 в 09:00 применён',
    )
    const rejected = describeAuditRow(
      row({
        entity: 'attendance_correction_requests',
        before: request,
        after: { ...request, status: 'rejected', decision_comment: 'Не подтвердилось' },
      }),
      lookups,
    )
    expect(plain(rejected.parts)).toMatch(/отклонён$/)
    expect(rejected.note).toBe('Причина: «Не подтвердилось»')
    // rejected by «Отменить проведение» (#95): the admin's reason is not repeated
    const unconfirmed = describeAuditRow(
      row({
        entity: 'attendance_correction_requests',
        before: request,
        after: {
          ...request,
          status: 'rejected',
          decision_comment: 'занятие возвращено в запланированные: провели не ту дату',
        },
        reason: 'провели не ту дату',
      }),
      lookups,
    )
    expect(unconfirmed.note).toBe(
      'Причина: «занятие возвращено в запланированные: провели не ту дату»',
    )
  })
})

describe('teacher corrects own marks (#110, К10)', () => {
  const mark = {
    id: 'm1',
    lesson_id: LESSON,
    student_id: ALINA,
    subscription_id: SUB,
    status: 'present',
  }

  it('«Отметки занятия … исправил учитель: Алина Исакова Был → Заморозка», no «Причина»', () => {
    const e = describeAuditRow(
      row({
        entity: 'attendance',
        kind: 'retro',
        before: mark,
        after: { ...mark, status: 'absent_frozen' },
        reason: 'Исправил учитель',
      }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Отметки занятия Математика · 8 класс Б, 10.10 в 09:00 исправил учитель: Алина Исакова Был → Заморозка',
    )
    expect(e.badge).toEqual({ label: 'Исправление', tone: 'burned' })
    expect(e.note).toBeNull()
  })

  it('the comment goes to the note; an unmarked student gets a mark', () => {
    const e = describeAuditRow(
      row({
        entity: 'attendance',
        action: 'insert',
        kind: 'retro',
        after: mark,
        reason: 'Исправил учитель: Был, забыла отметить',
      }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Отметки занятия Математика · 8 класс Б, 10.10 в 09:00 исправил учитель: Алина Исакова → Был',
    )
    expect(e.note).toBe('Комментарий: «Был, забыла отметить»')
  })
})

describe('attendance_presets (#84)', () => {
  const preset = { id: 'p1', lesson_id: LESSON, student_id: ALINA, comment: 'заболел' }

  it('set, re-commented, removed', () => {
    const set = describeAuditRow(
      row({ entity: 'attendance_presets', action: 'insert', after: preset }),
      lookups,
    )
    expect(plain(set.parts)).toBe(
      'Заморозка заранее: Алина Исакова · Математика · 8 класс Б, 10.10 в 09:00 — поставлена (предупредил о пропуске)',
    )
    expect(set.badge).toEqual({ label: 'Заморозка', tone: 'teal' })
    expect(set.note).toBe('Комментарий: «заболел»')
    expect(
      text(
        row({
          entity: 'attendance_presets',
          before: preset,
          after: { ...preset, comment: 'мама написала' },
        }),
      ),
    ).toMatch(/— комментарий изменён$/)
    const removed = describeAuditRow(
      row({ entity: 'attendance_presets', action: 'delete', before: preset, after: null }),
      lookups,
    )
    expect(plain(removed.parts)).toMatch(/— снята$/)
    expect(removed.note).toBeNull()
  })
})

describe('lessons', () => {
  it('confirmed late: «Занятие … подтверждено с опозданием»', () => {
    const r = row({
      actorId: TEACHER_USER,
      kind: 'late',
      before: lesson,
      after: {
        ...lesson,
        status: 'held',
        confirmed_late: true,
        confirmed_at: '2026-10-11T02:40:00+00:00',
      },
      marks: ['present', 'present', 'absent_frozen'],
    })
    const e = describeAuditRow(r, lookups)
    expect(plain(e.parts)).toBe(
      'Занятие Математика · 8 класс Б, 10.10 в 09:00 подтверждено с опозданием — на следующий день · был 2, заморозка 1',
    )
    expect(e.badge).toEqual({ label: 'Поздно', tone: 'warn' })
    expect(e.author).toBe('Гульзат Асанова')
  })

  it('confirmed late by several days', () => {
    const r = row({
      before: lesson,
      after: {
        ...lesson,
        status: 'held',
        confirmed_late: true,
        confirmed_at: '2026-10-13T10:00:00+00:00',
      },
    })
    expect(text(r)).toContain('— через 3 дня')
  })

  it('held on its day', () => {
    const r = row({
      kind: 'attendance',
      before: lesson,
      after: { ...lesson, status: 'held', confirmed_at: '2026-10-10T04:02:00+00:00' },
      marks: ['present', 'present', 'absent_burned'],
    })
    const e = describeAuditRow(r, lookups)
    expect(plain(e.parts)).toBe(
      'Занятие Математика · 8 класс Б, 10.10 в 09:00 проведено · был 2, не был 1',
    )
    expect(e.badge.label).toBe('Проведено')
  })

  it('unconfirmed by the admin (#95): marks deleted, the teacher loses pay, the reason', () => {
    const held = {
      ...lesson,
      status: 'held',
      teacher_id: GULZAT,
      confirmed_at: '2026-10-10T04:02:00+00:00',
    }
    const r = row({
      kind: 'retro',
      before: held,
      after: { ...held, status: 'planned', confirmed_at: null },
      reason: 'провели не ту дату',
      marks: ['absent_burned', 'absent_frozen', 'present', 'present', 'present', 'present'],
      amount: 1050,
    })
    const e = describeAuditRow(r, lookups)
    expect(plain(e.parts)).toBe(
      'Проведение отменено: Математика · 8 класс Б · 10.10 09:00 · 6 отметок удалены (учителю Гульзат −1 050 сом)',
    )
    expect(e.badge).toEqual({ label: 'Правка', tone: 'burned' })
    expect(e.note).toBe('Причина: «провели не ту дату»')
    expect(e.kind).toBe('retro')

    expect(text(row({ ...r, marks: ['absent_frozen'], amount: 0 }))).toBe(
      'Проведение отменено: Математика · 8 класс Б · 10.10 09:00 · 1 отметка удалена',
    )
    expect(text(row({ ...r, marks: [], amount: 0 }))).toBe(
      'Проведение отменено: Математика · 8 класс Б · 10.10 09:00 · отметок не было',
    )
  })

  it('planned, extra, cancelled, held cancelled, deleted', () => {
    expect(text(row({ action: 'insert', after: lesson }))).toBe(
      'Занятие Математика · 8 класс Б, 10.10 в 09:00 запланировано',
    )
    expect(text(row({ action: 'insert', after: { ...lesson, is_extra: true } }))).toBe(
      'Доп. урок Математика · 8 класс Б, 10.10 в 09:00 назначен',
    )
    const cancelled = row({
      before: lesson,
      after: { ...lesson, status: 'cancelled', cancel_reason: 'center', comment: 'нет света' },
    })
    expect(text(cancelled)).toBe(
      'Занятие Математика · 8 класс Б, 10.10 в 09:00 отменено: отменил центр',
    )
    expect(describeAuditRow(cancelled, lookups).note).toBe('Комментарий: «нет света»')
    // cancel_lesson writes the comment as the reason too (0008) — shown once (#52)
    expect(describeAuditRow({ ...cancelled, reason: 'нет света' }, lookups).note).toBe(
      'Комментарий: «нет света»',
    )
    // no comment: reason `cancel: <code>` — the text already says «отменил центр»
    const bare = row({
      before: lesson,
      after: { ...lesson, status: 'cancelled', cancel_reason: 'center' },
      reason: 'cancel: center',
    })
    expect(describeAuditRow(bare, lookups).note).toBeNull()
    const heldCancelled = row({
      kind: 'retro',
      before: { ...lesson, status: 'held' },
      after: { ...lesson, status: 'cancelled', cancel_reason: 'teacher' },
    })
    expect(text(heldCancelled)).toBe(
      'Проведённое занятие Математика · 8 класс Б, 10.10 в 09:00 отменено: отменил учитель',
    )
    expect(describeAuditRow(heldCancelled, lookups).badge.label).toBe('Правка')
    expect(text(row({ action: 'delete', before: lesson }))).toBe(
      'Занятие Математика · 8 класс Б, 10.10 в 09:00 удалено',
    )
  })

  it('rescheduled, substitute, locked, comment', () => {
    expect(
      text(
        row({
          before: lesson,
          after: { ...lesson, lesson_date: '2026-10-11', planned_start: '15:00:00' },
        }),
      ),
    ).toBe('Занятие Математика · 8 класс Б, 10.10 в 09:00 перенесено на 11.10 в 15:00')
    expect(text(row({ before: lesson, after: { ...lesson, substitute_teacher_id: GULZAT } }))).toBe(
      'Занятие Математика · 8 класс Б, 10.10 в 09:00: замена — Гульзат Асанова',
    )
    expect(text(row({ before: lesson, after: { ...lesson, is_locked: true } }))).toBe(
      'Занятие Математика · 8 класс Б, 10.10 в 09:00 закрыто в периоде',
    )
    expect(text(row({ before: lesson, after: { ...lesson, comment: 'контрольная' } }))).toBe(
      'Занятие Математика · 8 класс Б, 10.10 в 09:00: комментарий «контрольная»',
    )
  })
})

describe('subscriptions', () => {
  const sub = {
    id: SUB,
    enrollment_id: ENROLLMENT,
    lessons_total: 12,
    price_full: 3200,
    price_final: 2720,
    discount_percent: 15,
    status: 'active',
  }

  it('a new subscription is a payment', () => {
    const e = describeAuditRow(
      row({ entity: 'subscriptions', kind: 'payment', action: 'insert', after: sub }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Алина Исакова · Математика · 8 класс Б — новый абонемент 12 уроков, 2 720 сом (скидка 15 %)',
    )
    expect(e.badge).toEqual({ label: 'Оплата', tone: 'present' })
    expect(e.link).toMatchObject({ to: '/admin/students/$studentId', params: { studentId: ALINA } })
  })

  it('И89: an 8-lesson package — «новый абонемент 8 уроков, 4 800 сом»', () => {
    const e = describeAuditRow(
      row({
        entity: 'subscriptions',
        kind: 'payment',
        action: 'insert',
        after: {
          ...sub,
          lessons_total: 8,
          price_full: 4800,
          price_final: 4800,
          discount_percent: 0,
        },
      }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Алина Исакова · Математика · 8 класс Б — новый абонемент 8 уроков, 4 800 сом',
    )
  })

  it('refund and exhausted', () => {
    const refund = row({
      entity: 'subscriptions',
      before: sub,
      after: { ...sub, status: 'refunded' },
    })
    expect(text(refund)).toBe(
      'Алина Исакова · Математика · 8 класс Б — возврат абонемента 12 уроков (2 720 сом)',
    )
    expect(describeAuditRow(refund, lookups).badge.label).toBe('Возврат')
    expect(
      text(row({ entity: 'subscriptions', before: sub, after: { ...sub, status: 'exhausted' } })),
    ).toBe('Алина Исакова · Математика · 8 класс Б — абонемент 12 уроков израсходован')
  })

  it('#109: size and price edited with a reason (update_subscription)', () => {
    const before = { ...sub, lessons_total: 12, price_full: 7200, price_final: 7200 }
    const e = describeAuditRow(
      row({
        entity: 'subscriptions',
        kind: 'retro',
        before,
        after: { ...before, lessons_total: 8 },
        reason: '12 часов = 8 занятий по 1,5 ч',
      }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Алина Исакова · Математика · 8 класс Б — абонемент изменён: 12 уроков / 7 200 → 8 / 7 200',
    )
    expect(e.badge.label).toBe('Абонемент')
    expect(e.note).toBe('Причина: «12 часов = 8 занятий по 1,5 ч»')
  })
})

describe('enrollments', () => {
  const e = {
    id: ENROLLMENT,
    student_id: ALINA,
    group_id: GROUP,
    start_date: '2026-09-01',
    end_date: null,
    status: 'active',
  }

  it('enrolled and left', () => {
    expect(text(row({ entity: 'enrollments', action: 'insert', after: e }))).toBe(
      'Алина Исакова — зачисление в Математика · 8 класс Б с 01.09.2026',
    )
    expect(
      text(
        row({
          entity: 'enrollments',
          before: e,
          after: { ...e, status: 'finished', end_date: '2026-10-12' },
        }),
      ),
    ).toBe('Алина Исакова — зачисление в Математика · 8 класс Б закрыто с 12.10.2026')
  })
})

describe('teacher_rates', () => {
  const rate = { id: 'r1', teacher_id: GULZAT, percent: 45, valid_from: '2026-09-01' }

  it('new rate, fixed rate (retro), removed', () => {
    expect(text(row({ entity: 'teacher_rates', action: 'insert', after: rate }))).toBe(
      'Гульзат Асанова — ставка 45 % с 01.09.2026',
    )
    const fixed = row({
      entity: 'teacher_rates',
      kind: 'retro',
      before: rate,
      after: { ...rate, percent: 50 },
    })
    expect(text(fixed)).toBe('Гульзат Асанова — ставка с 01.09.2026: 45 % → 50 %')
    expect(describeAuditRow(fixed, lookups).badge.label).toBe('Правка')
    expect(text(row({ entity: 'teacher_rates', action: 'delete', before: rate }))).toBe(
      'Гульзат Асанова — ставка 45 % с 01.09.2026 удалена',
    )
  })

  it('a rate inserted with a past date is a correction (#52)', () => {
    const e = describeAuditRow(
      row({ entity: 'teacher_rates', action: 'insert', kind: 'retro', after: rate }),
      lookups,
    )
    expect(plain(e.parts)).toBe('Гульзат Асанова — ставка 45 % с 01.09.2026 — задним числом')
    expect(e.badge).toEqual({ label: 'Правка', tone: 'burned' })
  })
})

describe('payroll_adjustments (#83)', () => {
  const advance = {
    id: 'pa1',
    teacher_id: GULZAT,
    month: '2026-09-01',
    kind: 'advance',
    amount: 5000,
    issued_on: '2026-09-18',
    comment: 'по просьбе',
  }

  it('advance issued, deleted with a reason', () => {
    const issued = describeAuditRow(
      row({ entity: 'payroll_adjustments', action: 'insert', kind: 'payment', after: advance }),
      lookups,
    )
    expect(plain(issued.parts)).toBe(
      'Гульзат Асанова — аванс 5 000 сом от 18.09.2026 в счёт ЗП за сентябрь',
    )
    expect(issued.badge).toEqual({ label: 'Аванс', tone: 'warn' })
    expect(issued.note).toBe('«по просьбе»')

    const removed = describeAuditRow(
      row({
        entity: 'payroll_adjustments',
        action: 'delete',
        kind: 'payment',
        before: advance,
        reason: 'ошиблись суммой',
      }),
      lookups,
    )
    expect(plain(removed.parts)).toBe(
      'Гульзат Асанова — аванс 5 000 сом от 18.09.2026 в счёт ЗП за сентябрь — удалён',
    )
    expect(removed.note).toBe('Причина: «ошиблись суммой» · «по просьбе»')
  })
})

describe('tariffs', () => {
  const t = {
    id: 't3',
    group_type: 'group',
    valid_from: '2026-11-01',
    package_price: 3500,
    lessons_in_package: 12,
  }

  it('a new version against the one before it: «Тариф group: 3 200 → 3 500 с 01.11»', () => {
    const e = describeAuditRow(
      row({ entity: 'tariffs', entityId: 't3', action: 'insert', after: t }),
      lookups,
    )
    expect(plain(e.parts)).toBe('Тариф «Групповая»: 3 200 → 3 500 сом с 01.11.2026')
    expect(e.link).toEqual({ to: '/admin/settings', label: 'Тарифы' })
  })

  it('the first version of a type, a planned one cancelled', () => {
    expect(
      text(
        row({
          entity: 'tariffs',
          entityId: 'x',
          action: 'insert',
          after: { ...t, group_type: 'mini' },
        }),
      ),
    ).toBe('Тариф «Мини-группа»: 3 500 сом за 12 уроков с 01.11.2026')
    expect(text(row({ entity: 'tariffs', action: 'delete', before: t }))).toBe(
      'Тариф «Групповая» с 01.11.2026 отменён',
    )
  })
})

describe('subjects', () => {
  const s = { id: 's1', name: 'Математика', sort_order: 10, is_active: true }

  it('renamed, hidden, shown, added', () => {
    expect(
      text(row({ entity: 'subjects', before: s, after: { ...s, name: 'Математика (углубл.)' } })),
    ).toBe('Предмет: Математика → Математика (углубл.)')
    expect(text(row({ entity: 'subjects', before: s, after: { ...s, is_active: false } }))).toBe(
      'Предмет скрыт: Математика',
    )
    expect(text(row({ entity: 'subjects', before: { ...s, is_active: false }, after: s }))).toBe(
      'Предмет показан: Математика',
    )
    expect(text(row({ entity: 'subjects', action: 'insert', after: s }))).toBe(
      'Предмет добавлен: Математика',
    )
  })
})

describe('trials', () => {
  const t = {
    id: 't1',
    full_name: 'Розаина Бекова',
    group_id: GROUP,
    lesson_id: LESSON,
    status: 'scheduled',
    came: null,
    student_id: null,
  }

  it('booked, marked, rebooked, decided', () => {
    expect(text(row({ entity: 'trials', action: 'insert', after: t }))).toBe(
      'Розаина Бекова — записан(а) на пробное: Математика · 8 класс Б, 10.10 в 09:00',
    )
    const attended = { ...t, status: 'attended', came: true }
    expect(text(row({ entity: 'trials', before: t, after: attended }))).toBe(
      'Розаина Бекова — на пробном: был(а)',
    )
    expect(
      text(row({ entity: 'trials', before: t, after: { ...t, status: 'no_show', came: false } })),
    ).toBe('Розаина Бекова — на пробном: не пришёл(ла)')
    expect(
      text(
        row({
          entity: 'trials',
          before: { ...t, status: 'no_show' },
          after: { ...t, lesson_id: 'x' },
        }),
      ),
    ).toBe('Розаина Бекова — записан(а) заново: Математика · 8 класс Б')
    expect(text(row({ entity: 'trials', before: t, after: { ...t, lesson_id: 'x' } }))).toBe(
      'Розаина Бекова — пробное перенесено: Математика · 8 класс Б',
    )
    const enrolled = describeAuditRow(
      row({
        entity: 'trials',
        before: attended,
        after: { ...attended, status: 'enrolled', student_id: ALINA },
      }),
      lookups,
    )
    expect(plain(enrolled.parts)).toBe(
      'Розаина Бекова — оплатил(а) после пробного, зачислен(а) в Математика · 8 класс Б',
    )
    expect(enrolled.link).toMatchObject({ params: { studentId: ALINA } })
    expect(
      text(row({ entity: 'trials', before: attended, after: { ...attended, status: 'closed' } })),
    ).toBe('Розаина Бекова — отказ после пробного')
  })

  it('booked after the fact (#54): the mark comes with the booking', () => {
    const after = { ...t, status: 'attended', came: true }
    expect(text(row({ entity: 'trials', action: 'insert', after }))).toBe(
      'Розаина Бекова — записан(а) задним числом: Математика · 8 класс Б, 10.10 в 09:00 — был(а)',
    )
    expect(
      text(
        row({
          entity: 'trials',
          action: 'insert',
          after: { ...t, status: 'no_show', came: false },
        }),
      ),
    ).toBe(
      'Розаина Бекова — записан(а) задним числом: Математика · 8 класс Б, 10.10 в 09:00 — не пришёл(ла)',
    )
  })
})

describe('tables without a describer', () => {
  it('fall back to the table and the action', () => {
    const e = describeAuditRow(
      row({ entity: 'schedule_rules', action: 'insert', after: {} }),
      lookups,
    )
    expect(plain(e.parts)).toBe('schedule_rules: запись добавлена')
    expect(e.link).toBeNull()
  })
})

describe('authors and time', () => {
  it('no author — «Система», a removed profile — «Пользователь»', () => {
    expect(
      describeAuditRow(row({ actorId: null, after: lesson, action: 'insert' }), lookups).author,
    ).toBe('Система')
    expect(
      describeAuditRow(
        row({ actorId: '30000000-0000-4000-8000-000000000009', after: lesson, action: 'insert' }),
        lookups,
      ).author,
    ).toBe('Пользователь')
    expect(authorShort('Каныкей Асанова')).toBe('Каныкей')
    expect(authorShort('Система')).toBe('Система')
  })

  it('shows Bishkek time of the change, microseconds and all', () => {
    expect(bishkekTime('2026-10-12T07:40:00.123456+00:00')).toBe('13:40')
  })

  it('summarises the marks', () => {
    expect(marksSummary(['present', 'present', 'present'])).toBe('был 3')
    expect(marksSummary(['present', 'absent_frozen', 'absent_burned'])).toBe(
      'был 1, заморозка 1, не был 1',
    )
  })
})

describe('payments (#47)', () => {
  const payment = {
    id: '30000000-0000-4000-8000-000000000001',
    subscription_id: SUB,
    amount: 1600,
    method: 'mbank',
    kind: 'payment',
    reason: 'доплата через неделю',
  }
  it('a partial payment: who, group, amount, method, package; note — partial and the comment', () => {
    const e = describeAuditRow(
      row({ entity: 'payments', action: 'insert', after: payment, kind: 'payment' }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Алина Исакова · Математика · 8 класс Б — оплата 1 600 сом (Mbank), абонемент 12 уроков',
    )
    expect(e.badge).toEqual({ label: 'Оплата', tone: 'present' })
    expect(e.link).toMatchObject({ to: '/admin/students/$studentId', params: { studentId: ALINA } })
    expect(e.note?.replace(/\u00a0/g, ' ')).toBe('частично, из 3 200 сом · «доплата через неделю»')
  })
  it('a refund: negative amount shown as a sum, the reason in the note', () => {
    const e = describeAuditRow(
      row({
        entity: 'payments',
        action: 'insert',
        after: { ...payment, amount: -1333, method: 'cash', kind: 'refund', reason: 'Переезд' },
        kind: 'payment',
      }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Алина Исакова · Математика · 8 класс Б — возврат 1 333 сом (наличные), абонемент 12 уроков',
    )
    expect(e.badge).toEqual({ label: 'Возврат', tone: 'burned' })
    expect(e.note).toBe('Причина: «Переезд»')
  })
  it('a transfer row (#81): direction from the reason, signed sum, no method', () => {
    const e = describeAuditRow(
      row({
        entity: 'payments',
        action: 'insert',
        after: {
          ...payment,
          amount: -1800,
          method: null,
          kind: 'transfer',
          reason: 'перенос в Математика · мини',
          transfer_id: '40000000-0000-4000-8000-000000000001',
        },
        reason: 'transfer_student',
        kind: 'payment',
      }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Алина Исакова · Математика · 8 класс Б — перенос в Математика · мини: − 1 800 сом, абонемент 12 уроков',
    )
    expect(e.badge).toEqual({ label: 'Перенос', tone: 'teal' })
    expect(e.note).toBe('Причина: перевод в другую группу')
  })
  it('without lookups: «Ученик», still readable', () => {
    expect(
      text(
        row({ entity: 'payments', action: 'delete', before: payment, kind: 'payment' }),
        EMPTY_LOOKUPS,
      ),
    ).toBe('Оплата удалена: Ученик · 1 600 сом')
  })
})

describe('payments deleted / edited by the admin (#92, Г10)', () => {
  const payment = {
    id: '30000000-0000-4000-8000-000000000002',
    subscription_id: SUB,
    amount: 3200,
    method: 'cash',
    kind: 'payment',
    reason: null,
    paid_at: '2026-10-04T20:30:00+00:00', // 05.10 02:30 in Bishkek
  }
  it('«Оплата удалена: Алина Исакова · 3 200 сом · 05.10 · Математика · 8 класс Б · Причина: «…»»', () => {
    const e = describeAuditRow(
      row({
        entity: 'payments',
        action: 'delete',
        before: payment,
        reason: 'внесли дважды',
        kind: 'payment',
      }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Оплата удалена: Алина Исакова · 3 200 сом · 05.10 · Математика · 8 класс Б',
    )
    expect(e.note).toBe('Причина: «внесли дважды»')
    expect(e.link).toMatchObject({ params: { studentId: ALINA } })
  })
  it('«Возврат удалён: …»', () => {
    const r = row({
      entity: 'payments',
      action: 'delete',
      before: { ...payment, amount: -2000, kind: 'refund', reason: 'уехал' },
      reason: 'возврат не выдавали',
      kind: 'payment',
    })
    expect(text(r)).toBe(
      'Возврат удалён: Алина Исакова · 2 000 сом · 05.10 · Математика · 8 класс Б',
    )
    expect(describeAuditRow(r, lookups).note).toBe('Причина: «возврат не выдавали»')
  })
  it('«Оплата изменена: сумма 3 200 → 1 600 сом» with every change and the reason', () => {
    const e = describeAuditRow(
      row({
        entity: 'payments',
        action: 'update',
        before: payment,
        after: {
          ...payment,
          amount: 1600,
          method: 'mbank',
          paid_at: '2026-10-02T06:00:00+00:00',
          reason: 'половина',
        },
        reason: 'ошиблись суммой',
        kind: 'payment',
      }),
      lookups,
    )
    expect(plain(e.parts)).toBe(
      'Оплата изменена: Алина Исакова · сумма 3 200 → 1 600 сом · способ наличные → Mbank · дата 05.10 → 02.10 · комментарий изменён',
    )
    expect(e.note).toBe('Причина: «ошиблись суммой»')
  })
  it('#119: «оплата перенесена на абонемент с 07.09»', () => {
    const OLD = '00000000-0000-4000-c000-0000000000aa'
    expect(
      text(
        row({
          entity: 'payments',
          action: 'update',
          before: { ...payment, subscription_id: OLD },
          after: payment,
          reason: 'оплата ушла в новый абонемент',
          kind: 'payment',
        }),
        {
          ...lookups,
          subscriptions: {
            [SUB]: { enrollmentId: ENROLLMENT, lessons: 12, price: 3200, startedAt: '2026-09-07' },
          },
        },
      ),
    ).toBe('Оплата изменена: Алина Исакова · оплата перенесена на абонемент с 07.09')
  })
  it('the same day at another time is not a date change', () => {
    expect(
      text(
        row({
          entity: 'payments',
          action: 'update',
          before: payment,
          after: { ...payment, amount: 3000, paid_at: '2026-10-05T06:00:00+00:00' },
          reason: 'сумма',
          kind: 'payment',
        }),
      ),
    ).toBe('Оплата изменена: Алина Исакова · сумма 3 200 → 3 000 сом')
  })
  it('«Абонемент удалён вместе с оплатой» — the subscription row of delete_payment', () => {
    const sub = {
      id: SUB,
      enrollment_id: ENROLLMENT,
      lessons_total: 12,
      price_final: 3200,
      status: 'active',
    }
    const r = row({
      entity: 'subscriptions',
      entityId: SUB,
      action: 'delete',
      before: sub,
      reason: 'внесли дважды',
      kind: 'payment',
    })
    expect(text(r)).toBe(
      'Абонемент удалён вместе с оплатой: Алина Исакова · 12 уроков · Математика · 8 класс Б',
    )
    expect(describeAuditRow(r, lookups).note).toBe('Причина: «внесли дважды»')
    // «Записан по ошибке» (0024) deletes unpaid packages with its service reason — the old line
    expect(text({ ...r, reason: 'delete_enrollment' })).toBe(
      'Алина Исакова · Математика · 8 класс Б — абонемент 12 уроков удалён',
    )
  })
})

describe('dates moved after the fact (#60)', () => {
  it('group start: «Математика · 8 класс Б — старт группы перенесён с 18.09 на 01.09»', () => {
    const group = { id: GROUP, name: '8 класс Б', start_date: '2026-09-18', status: 'active' }
    const r = row({
      entity: 'groups',
      entityId: GROUP,
      before: group,
      after: { ...group, start_date: '2026-09-01' },
    })
    expect(text(r)).toBe('Математика · 8 класс Б — старт группы перенесён с 18.09 на 01.09')
    const entry = describeAuditRow(r, lookups)
    expect(entry.badge).toEqual({ label: 'Группа', tone: 'teal' })
    expect(entry.link).toEqual({
      to: '/admin/groups/$groupId',
      params: { groupId: GROUP },
      label: 'Группа',
    })
    // a group missing from lookups falls back to its own name
    expect(text(r, EMPTY_LOOKUPS)).toBe('8 класс Б — старт группы перенесён с 18.09 на 01.09')
  })

  it('enrollment start: «Алина Исакова — зачисление в … перенесено с 18.09 на 01.09»', () => {
    const e = { id: ENROLLMENT, student_id: ALINA, group_id: GROUP, start_date: '2026-09-18' }
    expect(
      text(
        row({
          entity: 'enrollments',
          entityId: ENROLLMENT,
          before: e,
          after: { ...e, start_date: '2026-09-01' },
        }),
      ),
    ).toBe('Алина Исакова — зачисление в Математика · 8 класс Б перенесено с 18.09 на 01.09')
  })

  it('subscription start follows the enrollment', () => {
    const s = {
      id: SUB,
      enrollment_id: ENROLLMENT,
      lessons_total: 12,
      price_final: 3200,
      status: 'active',
      started_at: '2026-09-18',
    }
    expect(
      text(
        row({
          entity: 'subscriptions',
          entityId: SUB,
          kind: 'payment',
          before: s,
          after: { ...s, started_at: '2026-09-01' },
        }),
      ),
    ).toBe(
      'Алина Исакова · Математика · 8 класс Б — начало абонемента 12 уроков перенесено с 18.09 на 01.09',
    )
  })
})

describe('admin undo (#73)', () => {
  const OTHER_GROUP = 'b0000000-0000-4000-8000-000000000004'
  const ASEL = 'f0000000-0000-4000-8000-000000000002'
  const undo: AuditLookups = {
    ...lookups,
    teachers: { [GULZAT]: 'Гульзат Асанова', [ASEL]: 'Асель Нурова' },
    groups: { ...lookups.groups, [OTHER_GROUP]: { name: '9 класс А', subject: 'Физика' } },
  }
  const e = { id: ENROLLMENT, student_id: ALINA, group_id: GROUP, start_date: '2026-09-01' }

  it('removed enrollment is marked as a mistake, without a service reason note', () => {
    const r = row({
      entity: 'enrollments',
      entityId: ENROLLMENT,
      action: 'delete',
      before: e,
      reason: 'remove_enrollment',
    })
    expect(text(r, undo)).toBe(
      'Алина Исакова — зачисление в Математика · 8 класс Б удалено (ошибочное)',
    )
    expect(describeAuditRow(r, undo).note).toBeNull()
  })

  it('transferred enrollment names both groups', () => {
    expect(
      text(
        row({
          entity: 'enrollments',
          entityId: ENROLLMENT,
          before: e,
          after: { ...e, group_id: OTHER_GROUP },
          reason: 'transfer_enrollment',
        }),
        undo,
      ),
    ).toBe('Алина Исакова — переведён(а) из Математика · 8 класс Б в Физика · 9 класс А')
  })

  it('«Записан по ошибке» (#81): deleted enrollment, void record, deleted «был» with the reason', () => {
    expect(
      text(
        row({
          entity: 'enrollments',
          entityId: ENROLLMENT,
          action: 'delete',
          before: e,
          reason: 'delete_enrollment',
        }),
        undo,
      ),
    ).toBe('Алина Исакова — зачисление в Математика · 8 класс Б удалено (ошибочное)')
    const voided = row({
      entity: 'enrollments',
      entityId: ENROLLMENT,
      before: { ...e, status: 'active', end_date: null },
      after: { ...e, status: 'finished', end_date: null },
      reason: 'delete_enrollment',
    })
    expect(text(voided, undo)).toBe(
      'Алина Исакова — зачисление в Математика · 8 класс Б аннулировано (ошибочное)',
    )
    const mark = describeAuditRow(
      row({
        entity: 'attendance',
        action: 'delete',
        before: { id: 'm1', lesson_id: LESSON, student_id: ALINA, status: 'present' },
        reason: 'delete_enrollment',
        kind: 'retro',
      }),
      undo,
    )
    expect(plain(mark.parts)).toBe(
      'Отметка Алина Исакова удалена (была Был) · Математика · 8 класс Б, 10.10 в 09:00',
    )
    expect(mark.note).toBe('Причина: записан(а) по ошибке')
  })

  it('«Ушёл» (#81): the enrollment closed from a date, the reason in words', () => {
    const r = row({
      entity: 'enrollments',
      entityId: ENROLLMENT,
      before: { ...e, status: 'active', end_date: null },
      after: { ...e, status: 'finished', end_date: '2026-09-30' },
      reason: 'withdraw_enrollment',
    })
    expect(text(r, undo)).toBe(
      'Алина Исакова — зачисление в Математика · 8 класс Б закрыто с 30.09.2026',
    )
    expect(describeAuditRow(r, undo).note).toBe('Причина: ученик ушёл из группы')
  })

  it('group teacher change carries the date from the reason', () => {
    const g = { id: GROUP, name: '8 класс Б', teacher_id: GULZAT }
    const r = row({
      entity: 'groups',
      entityId: GROUP,
      before: g,
      after: { ...g, teacher_id: ASEL },
      reason: 'change_group_teacher:2026-09-01',
    })
    expect(text(r, undo)).toBe(
      'учитель группы Математика · 8 класс Б сменён с Гульзат Асанова на Асель Нурова с 01.09',
    )
    expect(describeAuditRow(r, undo).note).toBeNull()
  })

  it('group lesson length carries the date and the tariff minutes from the reason (#100)', () => {
    const g = { id: GROUP, name: '8 класс Б', lesson_duration_min: null }
    const r = row({
      entity: 'groups',
      entityId: GROUP,
      before: g,
      after: { ...g, lesson_duration_min: 90 },
      reason: 'set_group_duration:2026-10-25:60:90',
    })
    expect(text(r, undo)).toBe('Математика · 8 класс Б — Длительность занятий: 60 → 90 мин с 25.10')
    expect(describeAuditRow(r, undo).badge.label).toBe('Группа')
    expect(describeAuditRow(r, undo).note).toBeNull()
    const back = row({
      entity: 'groups',
      entityId: GROUP,
      before: { ...g, lesson_duration_min: 90 },
      after: g,
      reason: 'set_group_duration:2026-11-01:90:60',
    })
    expect(text(back, undo)).toBe(
      'Математика · 8 класс Б — Длительность занятий: 90 → 60 мин (по тарифу) с 01.11',
    )
  })

  it('deleted group', () => {
    expect(
      text(
        row({
          entity: 'groups',
          entityId: 'b0000000-0000-4000-8000-0000000000ff',
          action: 'delete',
          before: { name: 'Ошибочная группа' },
          reason: 'delete_group',
        }),
        undo,
      ),
    ).toBe('группа Ошибочная группа удалена')
  })

  it('lesson teacher moved', () => {
    expect(
      text(
        row({
          before: { ...lesson, teacher_id: GULZAT },
          after: { ...lesson, teacher_id: ASEL },
        }),
        undo,
      ),
    ).toBe('Занятие 10.10: учитель Гульзат Асанова → Асель Нурова')
  })
})

describe('afterschool_plans (#82)', () => {
  const plan = {
    id: '30000000-0000-4000-8000-000000000001',
    enrollment_id: ENROLLMENT,
    valid_from: '2026-10-01',
    hours: [2, 0, 1, 0, 2, 0, 0],
  }

  it('the plan of the student from a date, linked to А6', () => {
    const r = row({ entity: 'afterschool_plans', action: 'insert', after: plan })
    expect(text(r)).toBe('Алина Исакова — график продлёнки с 01.10.2026: ПН 2 · СР 1 · ПТ 2 ч')
    expect(describeAuditRow(r, lookups).link?.label).toBeTruthy()
  })

  it('half hours with a comma', () => {
    expect(
      text(
        row({
          entity: 'afterschool_plans',
          before: plan,
          after: { ...plan, hours: [1.5, 0, 0, 0, 0, 0, 0] },
        }),
      ),
    ).toBe('Алина Исакова — график продлёнки с 01.10.2026: ПН 1,5 ч')
  })
})

describe('admin superuser actions (#94)', () => {
  const ASEL = 'f0000000-0000-4000-8000-000000000002'
  const l2: AuditLookups = { ...lookups, teachers: { ...lookups.teachers, [ASEL]: 'Асель Нурова' } }
  const REASON = 'ошибка ввода'
  const entry = (r: AuditRow, l: AuditLookups = l2) => describeAuditRow(r, l)

  it('close_payroll_period: month closed, comment', () => {
    const e = entry(
      row({
        entity: 'payroll_periods',
        action: 'insert',
        after: { month: '2026-09-01', comment: 'сверили' },
        reason: 'сверили',
      }),
    )
    expect(plain(e.parts)).toBe('Месяц закрыт: сентябрь 2026')
    expect(e.note).toBe('Комментарий: «сверили»')
  })

  it('reopen_payroll_period: month opened, reason', () => {
    const e = entry(
      row({
        entity: 'payroll_periods',
        action: 'delete',
        before: { month: '2026-09-01' },
        reason: REASON,
      }),
    )
    expect(plain(e.parts)).toBe('Месяц открыт: сентябрь 2026')
    expect(e.note).toBe('Причина: «ошибка ввода»')
  })

  it('update_payroll_adjustment: what changed', () => {
    const adv = {
      teacher_id: GULZAT,
      kind: 'advance',
      amount: 5000,
      issued_on: '2026-09-18',
      month: '2026-09-01',
      comment: null,
    }
    const e = entry(
      row({
        entity: 'payroll_adjustments',
        before: adv,
        after: { ...adv, amount: 6000, month: '2026-10-01' },
        reason: REASON,
      }),
    )
    expect(plain(e.parts)).toBe(
      'Гульзат Асанова — аванс изменён: сумма 5 000 → 6 000 сом · месяц ЗП сентябрь → октябрь',
    )
    expect(e.note).toBe('Причина: «ошибка ввода»')
  })

  it('update_lesson: moved, new length and teacher', () => {
    const held = { ...lesson, status: 'held', duration_min: 60, teacher_id: GULZAT }
    const e = entry(
      row({
        before: held,
        after: {
          ...held,
          lesson_date: '2026-10-11',
          duration_min: 90,
          teacher_id: ASEL,
        },
        reason: REASON,
      }),
    )
    expect(plain(e.parts)).toBe(
      'Занятие Математика · 8 класс Б, 10.10 в 09:00 перенесено на 11.10 в 09:00 · длительность 60 → 90 мин · учитель Гульзат Асанова → Асель Нурова',
    )
    expect(e.note).toBe('Причина: «ошибка ввода»')
  })

  it('update_lesson: only the length', () => {
    expect(
      text(
        row({
          before: { ...lesson, duration_min: 60 },
          after: { ...lesson, duration_min: 90 },
        }),
      ),
    ).toBe('Занятие Математика · 8 класс Б, 10.10 в 09:00 · длительность 60 → 90 мин')
  })

  it('a holiday lesson brought back and a lesson opened in the period', () => {
    expect(
      text(
        row({
          before: { ...lesson, status: 'cancelled', cancel_reason: 'holiday' },
          after: lesson,
        }),
      ),
    ).toBe('Занятие Математика · 8 класс Б, 10.10 в 09:00 возвращено в расписание')
    expect(text(row({ before: { ...lesson, is_locked: true }, after: lesson }))).toBe(
      'Занятие Математика · 8 класс Б, 10.10 в 09:00 открыто в периоде',
    )
  })

  const tariff = {
    group_type: 'group',
    valid_from: '2026-11-01',
    package_price: 3500,
    lessons_in_package: 12,
  }

  it('update_tariff_version: price and hour price', () => {
    const e = entry(
      row({
        entity: 'tariffs',
        entityId: 't3',
        before: { ...tariff, package_price: 3200 },
        after: tariff,
        reason: REASON,
      }),
    )
    expect(plain(e.parts)).toBe('Тариф «Групповая» с 01.11.2026: 3 200 → 3 500 сом')
    expect(e.note).toBe('Причина: «ошибка ввода»')
    expect(
      text(
        row({
          entity: 'tariffs',
          before: { ...tariff, group_type: 'afterschool', hour_price: 500 },
          after: { ...tariff, group_type: 'afterschool', hour_price: 550 },
        }),
      ),
    ).toBe('Тариф «Продлёнка» с 01.11.2026: цена часа 500 → 550 сом')
  })

  it('delete_tariff_version: cancelled with a reason', () => {
    const e = entry(row({ entity: 'tariffs', action: 'delete', before: tariff, reason: REASON }))
    expect(plain(e.parts)).toBe('Тариф «Групповая» с 01.11.2026 отменён')
    expect(e.note).toBe('Причина: «ошибка ввода»')
  })

  it('plan_tariffs_from_today', () => {
    const e = entry(
      row({
        entity: 'tariffs',
        action: 'insert',
        entityId: 't4',
        after: { ...tariff, valid_from: '2026-10-12', package_price: 3600 },
        reason: 'tariff_from_today',
      }),
    )
    expect(e.note).toBe('Причина: новая цена действует с сегодняшнего дня')
  })

  const holiday = { day: '2026-11-07', name: 'День революции' }

  it('save_holiday: added, renamed, back-dated', () => {
    expect(text(row({ entity: 'holidays', action: 'insert', after: holiday }))).toBe(
      'Праздник добавлен: 07.11 — День революции',
    )
    expect(
      text(
        row({
          entity: 'holidays',
          before: holiday,
          after: { ...holiday, name: 'Праздник' },
        }),
      ),
    ).toBe('Праздник переименован: 07.11 — День революции → Праздник')
    const e = entry(
      row({
        entity: 'holidays',
        action: 'insert',
        after: { day: '2026-10-05', name: 'Выходной' },
        reason: REASON,
      }),
    )
    expect(plain(e.parts)).toBe('Праздник добавлен (задним числом): 05.10 — Выходной')
    expect(e.badge.label).toBe('Правка')
    expect(e.note).toBe('Причина: «ошибка ввода»')
  })

  it('delete_holidays', () => {
    expect(text(row({ entity: 'holidays', action: 'delete', before: holiday }))).toBe(
      'Праздник удалён: 07.11 — День революции',
    )
  })

  const trial = {
    full_name: 'Нурлан',
    grade: 5,
    parent_phone: '+996700000000',
    source: 'instagram',
    note: null,
    lesson_id: LESSON,
    group_id: GROUP,
    status: 'scheduled',
  }

  it('update_trial: lead fields', () => {
    const e = entry(
      row({
        entity: 'trials',
        before: trial,
        after: { ...trial, grade: 6, source: '2gis' },
        reason: REASON,
      }),
    )
    expect(plain(e.parts)).toMatch(/^Нурлан — пробное изменено: класс 5 → 6 · источник .+ → .+$/)
    expect(e.note).toBe('Причина: «ошибка ввода»')
  })

  it('reopen_trial: back to the funnel', () => {
    expect(
      text(
        row({
          entity: 'trials',
          before: { ...trial, status: 'closed', came: true },
          after: { ...trial, status: 'attended', came: true },
          reason: REASON,
        }),
      ),
    ).toBe('Нурлан — возвращён(а) в воронку: был(а) на пробном')
  })

  it('delete_correction_request', () => {
    const e = entry(
      row({
        entity: 'attendance_correction_requests',
        action: 'delete',
        before: { lesson_id: LESSON, teacher_id: GULZAT, marks: [], status: 'pending' },
        reason: REASON,
      }),
    )
    expect(plain(e.parts)).toBe(
      'запрос Гульзат Асанова на исправление отметок занятия Математика · 8 класс Б, 10.10 в 09:00 удалён',
    )
    expect(e.note).toBe('Причина: «ошибка ввода»')
  })

  it('delete_group: the reason of the admin, cascaded rows name the group', () => {
    const gone = 'b0000000-0000-4000-8000-0000000000fe'
    const l: AuditLookups = {
      ...l2,
      groups: { ...l2.groups, [gone]: { name: '9 класс', subject: '' } },
    }
    const g = entry(
      row({
        entity: 'groups',
        entityId: gone,
        action: 'delete',
        before: { name: '9 класс' },
        reason: REASON,
      }),
      l,
    )
    expect(plain(g.parts)).toBe('группа 9 класс удалена')
    expect(g.note).toBe('Причина: «ошибка ввода»')
    expect(
      plain(
        entry(
          row({
            action: 'delete',
            before: { ...lesson, group_id: gone },
            reason: REASON,
          }),
          l,
        ).parts,
      ),
    ).toBe('Занятие 9 класс, 10.10 в 09:00 удалено')
  })

  it('delete_student and what went with them', () => {
    const e = entry(
      row({
        entity: 'students',
        action: 'delete',
        before: { full_name: 'Нурлан Асанов' },
        reason: REASON,
      }),
    )
    expect(plain(e.parts)).toBe('Ученик удалён: Нурлан Асанов')
    expect(e.note).toBe('Причина: «ошибка ввода»')
    expect(
      text(
        row({
          entity: 'attendance',
          action: 'delete',
          before: { lesson_id: LESSON, student_id: ALINA, status: 'present' },
          reason: REASON,
        }),
      ),
    ).toContain('Отметка Алина Исакова удалена')
  })

  it('delete_subject: with a reason', () => {
    const e = entry(
      row({ entity: 'subjects', action: 'delete', before: { name: 'Шахматы' }, reason: REASON }),
    )
    expect(plain(e.parts)).toBe('Предмет удалён: Шахматы')
    expect(e.note).toBe('Причина: «ошибка ввода»')
  })
})
