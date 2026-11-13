vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))

import { describe, expect, it, vi } from 'vitest'
import { GROUP_TYPES } from '@/features/tariffs/current'
import { editableRow } from './edit-api'

describe('editableRow', () => {
  // #145: the schema listed three types, «Изменить абонемент» failed for mini and pair groups.
  it.each(GROUP_TYPES)('accepts a package of a %s group', (group_type) => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      lessons_total: 12,
      price_full: 4400,
      price_final: 4400,
      discount_percent: 0,
      hours_total: null,
      status: 'active',
      tariff: {
        group_type,
        valid_from: '2026-09-01',
        lessons_in_package: 12,
        package_price: 4400,
        lesson_duration_min: 90,
      },
      enrollment: { group: { lesson_duration_min: null } },
    }
    expect(editableRow.parse(row).tariff.group_type).toBe(group_type)
  })
})
