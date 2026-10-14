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
    const e = describeAuditRow(row({ entity: 'holidays', action: 'insert', after: {} }), lookups)
    expect(plain(e.parts)).toBe('holidays: запись добавлена')
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
  it('without lookups: «Ученик», still readable', () => {
    expect(
      text(
        row({ entity: 'payments', action: 'delete', before: payment, kind: 'payment' }),
        EMPTY_LOOKUPS,
      ),
    ).toBe('Ученик — платёж 1 600 сом (Mbank) удалён')
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
