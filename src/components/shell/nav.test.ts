import { NAV, resolveView, viewsFor } from './nav'

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

describe('NAV', () => {
  it('teacher tab bar is Сегодня / Группы / Мой месяц', () => {
    expect(NAV.teacher.filter((i) => i.mobile).map((i) => i.label)).toEqual([
      'Сегодня',
      'Группы',
      'Мой месяц',
    ])
  })
})
