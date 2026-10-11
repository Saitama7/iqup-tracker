vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { currentRate, passwordSchema } from './api'

describe('currentRate', () => {
  const rates = [
    { percent: 45, valid_from: '2026-09-01' },
    { percent: 50, valid_from: '2026-11-01' },
  ]

  it('picks the latest rate already in effect', () => {
    expect(currentRate(rates, '2026-10-11')).toBe(45)
    expect(currentRate(rates, '2026-11-01')).toBe(50)
  })

  it('null before the first rate or without rates', () => {
    expect(currentRate(rates, '2026-08-31')).toBeNull()
    expect(currentRate([], '2026-10-11')).toBeNull()
  })
})

describe('passwordSchema', () => {
  it('requires 8+ chars and a matching repeat', () => {
    expect(passwordSchema.safeParse({ password: 'short', repeat: 'short' }).success).toBe(false)
    expect(passwordSchema.safeParse({ password: 'longenough', repeat: 'other' }).success).toBe(
      false,
    )
    expect(passwordSchema.safeParse({ password: 'longenough', repeat: 'longenough' }).success).toBe(
      true,
    )
  })
})
