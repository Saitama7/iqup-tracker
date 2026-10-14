import { describe, expect, it } from 'vitest'
import { fromGroup, fromMyMonth, lessonReturn, parseLessonSearch } from './return-to'

const G = '00000000-0000-4000-b000-000000000001'

describe('lesson return (#72, #76)', () => {
  it('only known sources and well-formed params survive the URL', () => {
    expect(parseLessonSearch({ from: 'my-month', month: '2026-09', group: G })).toEqual({
      from: 'my-month',
      month: '2026-09',
      group: G,
    })
    expect(parseLessonSearch({ from: 'elsewhere', month: '09-2026', group: 42, x: 1 })).toEqual({})
    expect(parseLessonSearch(undefined)).toEqual({})
  })

  it('«Мой месяц» — same month and group, to the next unconfirmed lesson', () => {
    expect(lessonReturn(fromMyMonth('2026-09', G))).toEqual({
      to: '/my-month',
      search: { month: '2026-09', group: G },
      hash: 'unconfirmed',
    })
  })

  it('the group page — that group; nothing — «Сегодня»', () => {
    expect(lessonReturn(fromGroup(G))).toEqual({ to: '/groups/$groupId', params: { groupId: G } })
    expect(lessonReturn({ from: 'group' })).toEqual({ to: '/today' })
    expect(lessonReturn({})).toEqual({ to: '/today' })
  })
})
