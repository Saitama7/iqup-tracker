import { NAV, TABS, resolveView, viewCaption, viewsFor } from './nav'

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
