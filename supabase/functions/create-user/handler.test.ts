import { type CreateUserDeps, handleCreateUser } from './handler'

const ADMIN = { id: 'admin-1', roles: ['admin'] }
const TEACHER = { id: 'teacher-1', roles: ['teacher'] }

function makeDeps(
  caller: { id: string; roles: string[] } | null,
  overrides: Partial<CreateUserDeps> = {},
) {
  const deps = {
    getCaller: vi.fn(() => Promise.resolve(caller)),
    createAuthUser: vi.fn(() => Promise.resolve({ id: 'new-user' })),
    deleteAuthUser: vi.fn(() => Promise.resolve()),
    insertProfile: vi.fn(() => Promise.resolve()),
    findTeacherIdByUser: vi.fn(() => Promise.resolve('teacher-row')),
    insertTeacherRate: vi.fn(() => Promise.resolve()),
    findUserIdByPhone: vi.fn(() => Promise.resolve(null)),
    updatePassword: vi.fn(() => Promise.resolve()),
    today: vi.fn(() => '2026-10-11'),
    ...overrides,
  } satisfies CreateUserDeps
  return deps
}

const validBody = {
  phone: '0555 123 456',
  full_name: 'Гульзат Асанова',
  roles: ['teacher'],
  password: 'iqup-demo',
  percent: 45,
}

describe('handleCreateUser', () => {
  it('401 without bearer token', async () => {
    const deps = makeDeps(ADMIN)
    const res = await handleCreateUser({ authorization: null, body: validBody }, deps)
    expect(res.status).toBe(401)
    expect(deps.getCaller).not.toHaveBeenCalled()
  })

  it('401 for invalid token', async () => {
    const res = await handleCreateUser(
      { authorization: 'Bearer bad', body: validBody },
      makeDeps(null),
    )
    expect(res.status).toBe(401)
  })

  it('403 for a non-admin caller and touches nothing', async () => {
    const deps = makeDeps(TEACHER)
    const res = await handleCreateUser({ authorization: 'Bearer t', body: validBody }, deps)
    expect(res).toMatchObject({ status: 403, body: { error: 'forbidden' } })
    expect(deps.createAuthUser).not.toHaveBeenCalled()
    expect(deps.updatePassword).not.toHaveBeenCalled()
  })

  it('403 for non-admin reset_password', async () => {
    const deps = makeDeps(TEACHER)
    const res = await handleCreateUser(
      {
        authorization: 'Bearer t',
        body: { action: 'reset_password', phone: '0555123456', password: 'newpass-1' },
      },
      deps,
    )
    expect(res.status).toBe(403)
    expect(deps.updatePassword).not.toHaveBeenCalled()
  })

  it('creates a teacher: normalized phone, synthetic email, rate from today', async () => {
    const deps = makeDeps(ADMIN)
    const res = await handleCreateUser({ authorization: 'Bearer a', body: validBody }, deps)
    expect(res).toEqual({
      status: 201,
      body: { user_id: 'new-user', teacher_id: 'teacher-row', phone: '996555123456' },
    })
    expect(deps.createAuthUser).toHaveBeenCalledWith({
      email: '996555123456@iqup.local',
      password: 'iqup-demo',
      roles: ['teacher'],
    })
    expect(deps.insertProfile).toHaveBeenCalledWith({
      id: 'new-user',
      phone: '996555123456',
      full_name: 'Гульзат Асанова',
      roles: ['teacher'],
    })
    expect(deps.insertTeacherRate).toHaveBeenCalledWith({
      teacher_id: 'teacher-row',
      percent: 45,
      valid_from: '2026-10-11',
    })
  })

  it('creates an accountant without teacher rows', async () => {
    const deps = makeDeps(ADMIN)
    const res = await handleCreateUser(
      {
        authorization: 'Bearer a',
        body: {
          phone: '+996 555 300 300',
          full_name: 'Айгерим',
          roles: ['accountant'],
          password: 'secret-1',
        },
      },
      deps,
    )
    expect(res.status).toBe(201)
    expect(deps.findTeacherIdByUser).not.toHaveBeenCalled()
    expect(deps.insertTeacherRate).not.toHaveBeenCalled()
  })

  it('409 when the phone is taken', async () => {
    const deps = makeDeps(ADMIN, { findUserIdByPhone: vi.fn(() => Promise.resolve('existing')) })
    const res = await handleCreateUser({ authorization: 'Bearer a', body: validBody }, deps)
    expect(res).toMatchObject({ status: 409, body: { error: 'phone_taken' } })
    expect(deps.createAuthUser).not.toHaveBeenCalled()
  })

  it('409 when auth reports the email exists', async () => {
    const deps = makeDeps(ADMIN, {
      createAuthUser: vi.fn(() => Promise.resolve({ error: 'email_exists' as const })),
    })
    const res = await handleCreateUser({ authorization: 'Bearer a', body: validBody }, deps)
    expect(res.status).toBe(409)
  })

  it('400 on invalid phone or unknown role', async () => {
    const deps = makeDeps(ADMIN)
    const badPhone = await handleCreateUser(
      { authorization: 'Bearer a', body: { ...validBody, phone: '12345' } },
      deps,
    )
    const badRole = await handleCreateUser(
      { authorization: 'Bearer a', body: { ...validBody, roles: ['owner'] } },
      deps,
    )
    expect(badPhone.status).toBe(400)
    expect(badRole.status).toBe(400)
    expect(deps.createAuthUser).not.toHaveBeenCalled()
  })

  it('400 when percent is given for a non-teacher', async () => {
    const res = await handleCreateUser(
      { authorization: 'Bearer a', body: { ...validBody, roles: ['admin'] } },
      makeDeps(ADMIN),
    )
    expect(res.status).toBe(400)
  })

  it('rolls back the auth user when the profile insert fails', async () => {
    const deps = makeDeps(ADMIN, {
      insertProfile: vi.fn(() => Promise.reject(new Error('db down'))),
    })
    await expect(
      handleCreateUser({ authorization: 'Bearer a', body: validBody }, deps),
    ).rejects.toThrow('db down')
    expect(deps.deleteAuthUser).toHaveBeenCalledWith('new-user')
  })

  it('admin resets a password by phone', async () => {
    const deps = makeDeps(ADMIN, { findUserIdByPhone: vi.fn(() => Promise.resolve('u-42')) })
    const res = await handleCreateUser(
      {
        authorization: 'Bearer a',
        body: { action: 'reset_password', phone: '0555 123 456', password: 'newpass-1' },
      },
      deps,
    )
    expect(res).toEqual({ status: 200, body: { user_id: 'u-42' } })
    expect(deps.findUserIdByPhone).toHaveBeenCalledWith('996555123456')
    expect(deps.updatePassword).toHaveBeenCalledWith('u-42', 'newpass')
  })

  it('404 when resetting an unknown phone', async () => {
    const res = await handleCreateUser(
      {
        authorization: 'Bearer a',
        body: { action: 'reset_password', phone: '0555 000 001', password: 'newpass-1' },
      },
      makeDeps(ADMIN),
    )
    expect(res.status).toBe(404)
  })
})
