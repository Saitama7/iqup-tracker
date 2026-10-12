vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { confirmErrorReason } from './api'

describe('confirmErrorReason (#41)', () => {
  it('a failed fetch has no code — no connection', () => {
    expect(confirmErrorReason({ code: '', message: 'TypeError: Load failed' })).toBe(
      'нет связи с сервером — проверьте интернет',
    )
  })

  it('a missing confirm_lesson (migration not applied) is named, not hidden', () => {
    expect(
      confirmErrorReason({
        code: 'PGRST202',
        message: 'Could not find the function public.confirm_lesson(p_lesson_id, p_marks)',
      }),
    ).toBe('сервер не обновлён — сообщите администратору')
  })

  it('rules of the database', () => {
    expect(confirmErrorReason({ code: '42501', message: 'permission denied' })).toBe(
      'отметить может только учитель группы',
    )
    expect(confirmErrorReason({ code: 'P0001', message: 'freeze limit reached' })).toBe(
      'лимит заморозок 2 на абонемент — отметьте «Не был»',
    )
    expect(confirmErrorReason({ code: 'P0001', message: 'lesson is in a closed period' })).toBe(
      'период закрыт — исправления через администратора',
    )
  })

  it('anything else — generic, never silent', () => {
    expect(confirmErrorReason({ code: '500', message: 'boom' })).toBe(
      'ошибка сервера — попробуйте ещё раз',
    )
  })
})
