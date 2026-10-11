import { type CreateUserDeps, handleCreateUser, type Role } from './handler'

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
    findProfile: vi.fn(() =>
      Promise.resolve<{ roles: Role[]; is_active: boolean } | null>({
        roles: ['admin'],
        is_active: true,
      }),
    ),
    teacherExists: vi.fn(() => Promise.resolve(true)),
    addTeacherRate: vi.fn(() => Promise.resolve<'ok' | 'exists'>('ok')),
    setProfileRoles: vi.fn(() => Promise.resolve()),
    setAuthRoles: vi.fn(() => Promise.resolve()),
    setProfileActive: vi.fn(() => Promise.resolve()),
    setAuthBanned: vi.fn(() => Promise.resolve()),
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
    expect(deps.updatePassword).toHaveBeenCalledWith('u-42', 'newpass-1')
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

  describe('update_rate', () => {
    const TEACHER_ID = '00000000-0000-4000-a000-000000000001'
    const body = {
      action: 'update_rate',
      teacher_id: TEACHER_ID,
      percent: 50,
      valid_from: '2026-11-01',
    }

    it('adds a new rate row, never touches old ones', async () => {
      const deps = makeDeps(ADMIN)
      const res = await handleCreateUser({ authorization: 'Bearer a', body }, deps)
      expect(res).toEqual({ status: 201, body: { teacher_id: TEACHER_ID } })
      expect(deps.addTeacherRate).toHaveBeenCalledWith({
        teacher_id: TEACHER_ID,
        percent: 50,
        valid_from: '2026-11-01',
      })
      expect(deps.insertTeacherRate).not.toHaveBeenCalled()
    })

    it('409 when a rate from that date already exists', async () => {
      const deps = makeDeps(ADMIN, {
        addTeacherRate: vi.fn(() => Promise.resolve<'ok' | 'exists'>('exists')),
      })
      const res = await handleCreateUser({ authorization: 'Bearer a', body }, deps)
      expect(res).toMatchObject({ status: 409, body: { error: 'rate_exists' } })
    })

    it('404 for an unknown teacher, 400 for a bad date or percent, 403 for non-admin', async () => {
      const unknown = makeDeps(ADMIN, { teacherExists: vi.fn(() => Promise.resolve(false)) })
      expect((await handleCreateUser({ authorization: 'Bearer a', body }, unknown)).status).toBe(
        404,
      )
      const deps = makeDeps(ADMIN)
      for (const bad of [
        { ...body, valid_from: '2026-02-30' },
        { ...body, percent: 0 },
        { ...body, percent: 120 },
      ]) {
        expect(
          (await handleCreateUser({ authorization: 'Bearer a', body: bad }, deps)).status,
        ).toBe(400)
      }
      const teacher = makeDeps(TEACHER)
      expect((await handleCreateUser({ authorization: 'Bearer t', body }, teacher)).status).toBe(
        403,
      )
      expect(deps.addTeacherRate).not.toHaveBeenCalled()
      expect(teacher.addTeacherRate).not.toHaveBeenCalled()
    })
  })

  describe('update_roles', () => {
    const USER = '00000000-0000-4000-8000-0000000000aa'

    it('updates profiles.roles and app_metadata.roles', async () => {
      const deps = makeDeps(ADMIN)
      const res = await handleCreateUser(
        {
          authorization: 'Bearer a',
          body: { action: 'update_roles', user_id: USER, roles: ['admin', 'teacher', 'teacher'] },
        },
        deps,
      )
      expect(res).toEqual({ status: 200, body: { user_id: USER, roles: ['admin', 'teacher'] } })
      expect(deps.setProfileRoles).toHaveBeenCalledWith(USER, ['admin', 'teacher'])
      expect(deps.setAuthRoles).toHaveBeenCalledWith(USER, ['admin', 'teacher'])
    })

    it('restores profile roles when the auth update fails', async () => {
      const deps = makeDeps(ADMIN, {
        setAuthRoles: vi.fn(() => Promise.reject(new Error('auth down'))),
      })
      await expect(
        handleCreateUser(
          {
            authorization: 'Bearer a',
            body: { action: 'update_roles', user_id: USER, roles: ['teacher'] },
          },
          deps,
        ),
      ).rejects.toThrow('auth down')
      expect(deps.setProfileRoles).toHaveBeenLastCalledWith(USER, ['admin'])
    })

    it('admin cannot drop own admin role; empty roles rejected; unknown user 404', async () => {
      const self = makeDeps({ id: USER, roles: ['admin'] })
      const res = await handleCreateUser(
        {
          authorization: 'Bearer a',
          body: { action: 'update_roles', user_id: USER, roles: ['teacher'] },
        },
        self,
      )
      expect(res).toMatchObject({ status: 409, body: { error: 'self_lockout' } })
      expect(self.setAuthRoles).not.toHaveBeenCalled()

      const empty = await handleCreateUser(
        { authorization: 'Bearer a', body: { action: 'update_roles', user_id: USER, roles: [] } },
        makeDeps(ADMIN),
      )
      expect(empty.status).toBe(400)

      const missing = await handleCreateUser(
        {
          authorization: 'Bearer a',
          body: { action: 'update_roles', user_id: USER, roles: ['teacher'] },
        },
        makeDeps(ADMIN, { findProfile: vi.fn(() => Promise.resolve(null)) }),
      )
      expect(missing.status).toBe(404)
    })
  })

  describe('set_active', () => {
    const USER = '00000000-0000-4000-8000-0000000000bb'

    it('deactivates: auth ban + profiles.is_active = false', async () => {
      const deps = makeDeps(ADMIN)
      const res = await handleCreateUser(
        { authorization: 'Bearer a', body: { action: 'set_active', user_id: USER, active: false } },
        deps,
      )
      expect(res).toEqual({ status: 200, body: { user_id: USER, active: false } })
      expect(deps.setAuthBanned).toHaveBeenCalledWith(USER, true)
      expect(deps.setProfileActive).toHaveBeenCalledWith(USER, false)
    })

    it('reactivates: lifts the ban', async () => {
      const deps = makeDeps(ADMIN, {
        findProfile: vi.fn(() =>
          Promise.resolve<{ roles: Role[]; is_active: boolean } | null>({
            roles: ['teacher'],
            is_active: false,
          }),
        ),
      })
      await handleCreateUser(
        { authorization: 'Bearer a', body: { action: 'set_active', user_id: USER, active: true } },
        deps,
      )
      expect(deps.setAuthBanned).toHaveBeenCalledWith(USER, false)
      expect(deps.setProfileActive).toHaveBeenCalledWith(USER, true)
    })

    it('rolls the ban back when the profile update fails', async () => {
      const deps = makeDeps(ADMIN, {
        setProfileActive: vi.fn(() => Promise.reject(new Error('db down'))),
      })
      await expect(
        handleCreateUser(
          {
            authorization: 'Bearer a',
            body: { action: 'set_active', user_id: USER, active: false },
          },
          deps,
        ),
      ).rejects.toThrow('db down')
      expect(deps.setAuthBanned).toHaveBeenLastCalledWith(USER, false)
    })

    it('admin cannot deactivate self', async () => {
      const deps = makeDeps({ id: USER, roles: ['admin'] })
      const res = await handleCreateUser(
        { authorization: 'Bearer a', body: { action: 'set_active', user_id: USER, active: false } },
        deps,
      )
      expect(res).toMatchObject({ status: 409, body: { error: 'self_lockout' } })
      expect(deps.setAuthBanned).not.toHaveBeenCalled()
    })
  })
})
