import { describe, expect, it } from 'vitest'
import {
  FROM_DASHBOARD,
  FROM_TODAY,
  fromAdminGroup,
  fromGroup,
  fromMyMonth,
  fromSchedule,
  lessonReturn,
  lessonSource,
  parseLessonSearch,
} from './return-to'

const G = '00000000-0000-4000-b000-000000000001'
const T = '00000000-0000-4000-b000-000000000002'

describe('lesson return (#72, #76, #89)', () => {
  it('only known sources and well-formed params survive the URL', () => {
    expect(parseLessonSearch({ from: 'my-month', month: '2026-09', group: G })).toEqual({
      from: 'my-month',
      month: '2026-09',
      group: G,
    })
    expect(parseLessonSearch({ from: 'elsewhere', month: '09-2026', group: 42, x: 1 })).toEqual({})
    expect(parseLessonSearch(undefined)).toEqual({})
  })

  it('the extended sources: admin group with its tab, schedule with its week', () => {
    expect(parseLessonSearch({ from: 'admin-group', group: G, tab: 'lessons' })).toEqual({
      from: 'admin-group',
      group: G,
      tab: 'lessons',
    })
    expect(
      parseLessonSearch({
        from: 'schedule',
        date: '2026-09-23',
        teacher: T,
        filter: 'unconfirmed',
      }),
    ).toEqual({ from: 'schedule', date: '2026-09-23', teacher: T, filter: 'unconfirmed' })
    expect(parseLessonSearch({ from: 'dashboard' })).toEqual({ from: 'dashboard' })
    expect(parseLessonSearch({ from: 'today' })).toEqual({ from: 'today' })
    // malformed params are dropped one by one, the source stays
    expect(
      parseLessonSearch({ from: 'schedule', date: '23.09.2026', tab: 'payments', filter: 'all' }),
    ).toEqual({ from: 'schedule' })
  })

  it('«Мой месяц» — same month and group, to the next unconfirmed lesson', () => {
    expect(lessonReturn(fromMyMonth('2026-09', G))).toEqual({
      to: '/my-month',
      search: { month: '2026-09', group: G },
      hash: 'unconfirmed',
    })
  })

  it("the teacher's group page — that group on the same tab; nothing — «Сегодня»", () => {
    expect(lessonReturn(fromGroup(G))).toEqual({
      to: '/groups/$groupId',
      params: { groupId: G },
      search: { tab: undefined },
    })
    expect(lessonReturn(fromGroup(G, 'lessons'))).toEqual({
      to: '/groups/$groupId',
      params: { groupId: G },
      search: { tab: 'lessons' },
    })
    expect(lessonReturn({ from: 'group' })).toEqual({ to: '/today' })
    expect(lessonReturn({})).toEqual({ to: '/today' })
  })

  it("the admin's group page А4 — back to «Занятия»", () => {
    expect(lessonReturn(fromAdminGroup(G, 'lessons'))).toEqual({
      to: '/admin/groups/$groupId',
      params: { groupId: G },
      search: { tab: 'lessons' },
    })
    expect(lessonSource({ from: 'admin-group' })).toBeNull()
  })

  it('А2 — the same week, teacher and filter; the dashboard; «Сегодня»', () => {
    expect(lessonReturn(fromSchedule({ date: '2026-09-23', teacher: T }))).toEqual({
      to: '/admin/schedule',
      search: { date: '2026-09-23', teacher: T, filter: undefined },
    })
    expect(lessonReturn(FROM_DASHBOARD)).toEqual({ to: '/admin' })
    expect(lessonReturn(FROM_TODAY)).toEqual({ to: '/today' })
    expect(lessonSource({})).toBeNull()
  })
})
