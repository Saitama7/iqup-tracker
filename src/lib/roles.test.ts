import { hasRole, homePath, parseRoles } from './roles'

describe('parseRoles', () => {
  it('reads app_metadata.roles', () => {
    expect(parseRoles({ roles: ['admin', 'teacher'] })).toEqual(['admin', 'teacher'])
  })

  it.each([undefined, null, {}, { roles: 'admin' }, { roles: null }])('empty for %j', (meta) => {
    expect(parseRoles(meta)).toEqual([])
  })

  it('drops unknown and duplicate roles', () => {
    expect(parseRoles({ roles: ['teacher', 'root', 'teacher', 1] })).toEqual(['teacher'])
  })
})

describe('homePath', () => {
  it.each([
    [['teacher'], '/today'],
    [['admin'], '/admin'],
    [['accountant'], '/payroll'],
    [['admin', 'teacher'], '/admin'],
    [['teacher', 'admin'], '/admin'],
    [[], '/profile'],
  ] as const)('%j → %s', (roles, path) => {
    expect(homePath(roles)).toBe(path)
  })
})

describe('hasRole', () => {
  it('checks membership', () => {
    expect(hasRole(['admin', 'teacher'], 'teacher')).toBe(true)
    expect(hasRole(['teacher'], 'admin')).toBe(false)
  })
})
