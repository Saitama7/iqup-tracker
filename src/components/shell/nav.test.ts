import { isPushedScreen, MORE, NAV, TABS, resolveView, viewCaption, viewsFor } from './nav'

describe('viewsFor', () => {
  it('orders views by priority', () => {
    expect(viewsFor(['teacher', 'admin'])).toEqual(['admin', 'teacher'])
    expect(viewsFor(['accountant'])).toEqual(['accountant'])
    expect(viewsFor([])).toEqual([])
  })
})

describe('resolveView', () => {
  const kanykei = ['admin', 'teacher'] as const

  it('follows the URL section', () => {
    expect(resolveView('/admin', kanykei, null)).toBe('admin')
    expect(resolveView('/today', kanykei, 'admin')).toBe('teacher')
    expect(resolveView('/my-month', kanykei, null)).toBe('teacher')
  })

  it('keeps the last view on shared pages', () => {
    expect(resolveView('/profile', kanykei, 'teacher')).toBe('teacher')
    expect(resolveView('/profile', kanykei, null)).toBe('admin')
  })

  it('ignores views the user does not have', () => {
    expect(resolveView('/admin', ['teacher'], null)).toBe('teacher')
    expect(resolveView('/profile', ['teacher'], 'admin')).toBe('teacher')
  })
})

describe('NAV / TABS', () => {
  it('teacher tab bar is Сегодня / Группы / Мой месяц (У2)', () => {
    expect(TABS.teacher.map((i) => i.label)).toEqual(['Сегодня', 'Группы', 'Мой месяц'])
  })

  it('admin tab bar matches АМ1', () => {
    expect(TABS.admin.map((i) => i.label)).toEqual([
      'Сегодня',
      'Ученики',
      'Оплата',
      'Группы',
      'Ещё',
    ])
  })

  it('admin «Ещё» sheet lists the remaining sections, built ones as links', () => {
    expect(TABS.admin.at(-1)?.more).toBe(true)
    expect(MORE.admin.map((i) => i.label)).toEqual([
      'Расписание',
      'Группы',
      'Пробные',
      'Учителя и доступ',
      'Тарифы и праздники',
      'Журнал изменений',
      'Профиль',
    ])
    expect(MORE.admin.filter((i) => i.to).map((i) => i.to)).toEqual([
      '/admin/schedule',
      '/admin/groups',
      '/admin/users',
      '/admin/settings',
      '/admin/audit',
      '/profile',
    ])
  })

  it('admin «Ученики» tab and sidebar item open А5', () => {
    expect(TABS.admin.find((i) => i.label === 'Ученики')?.to).toBe('/admin/students')
    expect(NAV.admin.find((i) => i.label === 'Ученики')?.to).toBe('/admin/students')
  })

  it('admin «Расписание» opens А2 from the sidebar and the «Ещё» sheet', () => {
    expect(NAV.admin.find((i) => i.label === 'Расписание')?.to).toBe('/admin/schedule')
    expect(MORE.admin.find((i) => i.label === 'Расписание')?.to).toBe('/admin/schedule')
  })

  it('«Журнал изменений» opens А10 for admin (sidebar, «Ещё») and accountant (#45)', () => {
    const audit = (items: { label: string; to: string | null }[]) =>
      items.find((i) => i.label === 'Журнал изменений')?.to
    expect(audit(NAV.admin)).toBe('/admin/audit')
    expect(audit(MORE.admin)).toBe('/admin/audit')
    expect(audit(NAV.accountant)).toBe('/admin/audit')
    // the accountant keeps their own menu on /admin/audit
    expect(resolveView('/admin/audit', ['accountant'], null)).toBe('accountant')
  })

  it('accountant has no tab bar (БМ1)', () => {
    expect(TABS.accountant).toEqual([])
  })

  it('teacher sidebar matches УД1', () => {
    expect(NAV.teacher.map((i) => i.label)).toEqual(['Сегодня', 'Группы и ученики', 'Мой месяц'])
  })
})

describe('viewCaption', () => {
  it('describes the role as on the sidebar card', () => {
    expect(viewCaption('teacher', 45)).toBe('учитель · 45 %')
    expect(viewCaption('teacher', null)).toBe('учитель')
    expect(viewCaption('admin', 45)).toBe('администратор')
    expect(viewCaption('accountant', null)).toBe('бухгалтер · просмотр')
  })
})

describe('isPushedScreen', () => {
  it('profile and a student card hide the tab bar, the list keeps it', () => {
    expect(isPushedScreen('/profile')).toBe(true)
    expect(isPushedScreen('/admin/students/1f0c')).toBe(true)
    expect(isPushedScreen('/admin/students')).toBe(false)
    expect(isPushedScreen('/admin/groups/1f0c')).toBe(true)
    expect(isPushedScreen('/admin/groups')).toBe(false)
    expect(isPushedScreen('/admin')).toBe(false)
  })

  it('teacher: a lesson and a group are pushed, «Группы» keeps the tab bar', () => {
    expect(isPushedScreen('/lessons/1f0c')).toBe(true)
    expect(isPushedScreen('/groups/1f0c')).toBe(true)
    expect(isPushedScreen('/groups')).toBe(false)
    expect(isPushedScreen('/today')).toBe(false)
  })
})
