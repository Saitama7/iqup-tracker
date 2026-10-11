import {
  buildUsersView,
  countsCaption,
  generatePassword,
  groupsCaption,
  plural,
  rightsCaption,
  statusText,
  userStatus,
  type UsersSource,
} from './model'

const NOW = Date.parse('2026-10-11T06:00:00Z') // 12:00 in Bishkek

const ids = {
  gulzat: '00000000-0000-4000-8000-000000000001',
  aiperi: '00000000-0000-4000-8000-000000000002',
  kanykei: '00000000-0000-4000-8000-000000000003',
  aigerim: '00000000-0000-4000-8000-000000000004',
  elmira: '00000000-0000-4000-8000-000000000005',
}

const src: UsersSource = {
  profiles: [
    {
      id: ids.gulzat,
      full_name: 'Гульзат Асанова',
      phone: '996555123456',
      roles: ['teacher'],
      is_active: true,
    },
    {
      id: ids.aiperi,
      full_name: 'Айпери Жусупова',
      phone: '996555201001',
      roles: ['teacher'],
      is_active: true,
    },
    {
      id: ids.kanykei,
      full_name: 'Каныкей',
      phone: '996552775771',
      roles: ['admin', 'teacher'],
      is_active: true,
    },
    {
      id: ids.aigerim,
      full_name: 'Айгерим Маматова',
      phone: '996555300300',
      roles: ['accountant'],
      is_active: true,
    },
    {
      id: ids.elmira,
      full_name: 'Эльмира Садыкова',
      phone: '996555201005',
      roles: ['teacher'],
      is_active: false,
    },
  ],
  teachers: [
    {
      id: 't-gulzat',
      user_id: ids.gulzat,
      full_name: 'Гульзат Асанова',
      phone: '996555123456',
      teacher_rates: [
        { percent: 45, valid_from: '2026-09-01' },
        { percent: 50, valid_from: '2026-11-01' },
      ],
      groups: [
        { subject: 'Математика', status: 'active' },
        { subject: 'Математика', status: 'active' },
        { subject: 'Физика', status: 'archived' },
      ],
    },
    {
      id: 't-aiperi',
      user_id: ids.aiperi,
      full_name: 'Айпери Жусупова',
      phone: '996555201001',
      teacher_rates: [{ percent: 50, valid_from: '2026-09-01' }],
      groups: [{ subject: 'Химия', status: 'active' }],
    },
    {
      id: 't-kanykei',
      user_id: ids.kanykei,
      full_name: 'Каныкей',
      phone: '996552775771',
      teacher_rates: [],
      groups: [],
    },
    {
      id: 't-elmira',
      user_id: ids.elmira,
      full_name: 'Эльмира Садыкова',
      phone: '996555201005',
      teacher_rates: [{ percent: 45, valid_from: '2026-09-01' }],
      groups: [],
    },
    {
      id: 't-new',
      user_id: null,
      full_name: 'Бекзат Ормонов',
      phone: '996555201002',
      teacher_rates: [],
      groups: [],
    },
  ],
  lastSignIn: {
    [ids.gulzat]: '2026-10-10T08:00:00Z',
    [ids.aiperi]: '2026-09-29T08:00:00Z',
    [ids.kanykei]: '2026-10-11T05:00:00Z',
    [ids.aigerim]: null,
    [ids.elmira]: '2026-10-01T08:00:00Z',
  },
}

describe('buildUsersView', () => {
  const view = buildUsersView(src, NOW)

  it('lists every teachers row by name, with or without login', () => {
    expect(view.teachers.map((t) => t.fullName)).toEqual([
      'Айпери Жусупова',
      'Бекзат Ормонов',
      'Гульзат Асанова',
      'Каныкей',
      'Эльмира Садыкова',
    ])
  })

  it('uses the rate in effect today and shows the upcoming one separately', () => {
    const gulzat = view.teachers.find((t) => t.teacherId === 't-gulzat')
    expect(gulzat).toMatchObject({
      percent: 45,
      percentFrom: '2026-09-01',
      nextRate: { percent: 50, validFrom: '2026-11-01' },
      groupsCaption: 'Математика · 2 группы',
    })
    expect(gulzat?.history.map((r) => r.validFrom)).toEqual(['2026-11-01', '2026-09-01'])
  })

  it('derives statuses from login, activity and is_active', () => {
    const status = (id: string) => view.teachers.find((t) => t.teacherId === id)?.status
    expect(status('t-gulzat')).toEqual({ kind: 'active' })
    expect(status('t-aiperi')).toEqual({ kind: 'idle', days: 12 })
    expect(status('t-elmira')).toEqual({ kind: 'inactive' })
    expect(status('t-new')).toEqual({ kind: 'no_login' })
  })

  it('staff table: admins first, then accountants; teachers-only excluded', () => {
    expect(view.staff.map((s) => s.fullName)).toEqual(['Каныкей', 'Айгерим Маматова'])
    expect(view.staff[1]?.status).toEqual({ kind: 'never' })
  })

  it('counts active people per role', () => {
    expect(view.counts).toEqual({ teachers: 4, admins: 1, accountants: 1 })
    expect(countsCaption(view.counts)).toBe('4 учителя · 1 администратор · 1 бухгалтер')
  })
})

describe('captions', () => {
  it('plural', () => {
    expect(
      [1, 2, 5, 11, 21, 22, 25, 112].map((n) => plural(n, ['группа', 'группы', 'групп'])),
    ).toEqual(['группа', 'группы', 'групп', 'групп', 'группа', 'группы', 'групп', 'групп'])
  })

  it('groupsCaption keeps abbreviations, lowercases the rest after the first', () => {
    expect(
      groupsCaption([
        { subject: 'Математика', status: 'active' },
        { subject: 'ОРТ', status: 'forming' },
        { subject: 'ОРТ', status: 'active' },
      ]),
    ).toBe('Математика, ОРТ · 3 группы')
    expect(
      groupsCaption([
        { subject: 'Химия', status: 'active' },
        { subject: 'Биология', status: 'active' },
      ]),
    ).toBe('Биология, химия · 2 группы')
    expect(groupsCaption([{ subject: 'Химия', status: 'archived' }])).toBe('Нет групп')
  })

  it('statusText and rights', () => {
    expect(statusText({ kind: 'idle', days: 12 })).toBe('Не входил(а) 12 дн.')
    expect(statusText({ kind: 'active' })).toBe('Доступ открыт')
    expect(statusText({ kind: 'never' })).toBe('Не входил(а)')
    expect(statusText({ kind: 'inactive' })).toBe('Доступ закрыт')
    expect(rightsCaption(['admin', 'teacher'])).toBe('всё')
    expect(rightsCaption(['accountant'])).toBe('просмотр · закрытие периода · корректировки')
  })

  it('userStatus: 6 days ago is still active', () => {
    expect(userStatus({ is_active: true }, '2026-10-05T08:00:00Z', NOW)).toEqual({ kind: 'active' })
    expect(userStatus({ is_active: true }, '2026-10-04T08:00:00Z', NOW)).toEqual({
      kind: 'idle',
      days: 7,
    })
  })
})

describe('generatePassword', () => {
  it('iqup-XXXX without look-alike characters, 8+ chars for Auth', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword()
      expect(p).toMatch(/^iqup-[a-hjkmnp-z2-9]{4}$/)
      expect(p.length).toBeGreaterThanOrEqual(8)
    }
  })

  it('uses the given random source', () => {
    expect(generatePassword(() => new Uint8Array([0, 1, 2, 30]))).toBe('iqup-abc9')
  })
})
