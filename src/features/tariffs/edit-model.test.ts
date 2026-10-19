import { describe, expect, it } from 'vitest'
import { afterschoolChanged, versionFormDefaults, versionInEffect } from './edit-model'
import { lessonsWord } from './edit-api'
import type { TariffVersion } from './model'

const row = (type: string, price: number, hour: number | null) => ({
  type,
  before: null,
  after: { group_type: type, package_price: price, hour_price: hour },
})

const version = {
  validFrom: '2026-10-01',
  rows: [row('group', 3200, null), row('afterschool', 6000, 150)],
} as unknown as TariffVersion

describe('edit-model', () => {
  it('versionInEffect: today counts', () => {
    expect(versionInEffect(version, '2026-10-01')).toBe(true)
    expect(versionInEffect(version, '2026-09-30')).toBe(false)
  })

  it('prefills prices and the hour price', () => {
    const d = versionFormDefaults(version)
    expect(d.prices.group).toBe('3200')
    expect(d.prices.mini).toBe('')
    expect(d.hourPrice).toBe('150')
  })

  it('afterschoolChanged follows package and hour price', () => {
    expect(afterschoolChanged(version, { afterschoolPrice: 6000, hourPrice: 150 })).toBe(false)
    expect(afterschoolChanged(version, { afterschoolPrice: 6500, hourPrice: 150 })).toBe(true)
    expect(afterschoolChanged(version, { afterschoolPrice: 6000, hourPrice: null })).toBe(true)
  })
})

describe('lessonsWord', () => {
  it('declines', () => {
    expect([1, 2, 5, 11, 21, 22].map(lessonsWord)).toEqual([
      '1 занятие',
      '2 занятия',
      '5 занятий',
      '11 занятий',
      '21 занятие',
      '22 занятия',
    ])
  })
})
