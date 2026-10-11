vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { currentRate, passwordSchema, summarizeTeacher } from './api'

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

describe('summarizeTeacher', () => {
  const s1 = '00000000-0000-4000-8000-000000000001'
  const s2 = '00000000-0000-4000-8000-000000000002'
  const s3 = '00000000-0000-4000-8000-000000000003'

  it('counts live groups and distinct active students', () => {
    const summary = summarizeTeacher(
      {
        created_at: '2024-09-02T04:00:00Z',
        teacher_rates: [{ percent: 45, valid_from: '2024-09-01' }],
        groups: [
          {
            subject: 'Математика',
            status: 'active',
            enrollments: [
              { student_id: s1, status: 'active' },
              { student_id: s2, status: 'finished' },
            ],
          },
          {
            subject: 'математика ',
            status: 'forming',
            enrollments: [
              { student_id: s1, status: 'active' },
              { student_id: s2, status: 'active' },
            ],
          },
          {
            subject: 'Физика',
            status: 'archived',
            enrollments: [{ student_id: s3, status: 'active' }],
          },
        ],
      },
      '2026-10-11',
    )
    expect(summary).toEqual({
      percent: 45,
      groups: 2,
      students: 2,
      subjects: ['математика'],
      since: '2024-09-02T04:00:00Z',
    })
  })
})
