import { act, renderHook } from '@testing-library/react'
import { createNowStore, useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'
import {
  confirmCopy,
  countsCaption,
  dayCounts,
  deckOrder,
  inCurrentWindow,
  lessonState,
  minutesLeft,
  splitDays,
  timeRange,
  unconfirmedChip,
  unconfirmedInMonth,
  unconfirmedTitle,
  untilLabel,
  type LessonTiming,
} from './select'

// Bishkek wall clock → instant (UTC+6).
const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+06:00`)
const DAY = '2026-10-08'

const lesson = (id: string, start: string, over: Partial<LessonTiming> = {}): LessonTiming => ({
  id,
  lesson_date: DAY,
  planned_start: `${start}:00`,
  duration_min: 60,
  status: 'planned',
  ...over,
})

describe('lessonState', () => {
  const l = lesson('a', '14:00')

  it('upcoming until 15 min before start', () => {
    expect(lessonState(l, at(DAY, '13:44') + 59_999)).toBe('upcoming')
    expect(lessonState(l, at(DAY, '13:45'))).toBe('current')
  })

  it('current until the end, then ended_unconfirmed', () => {
    expect(lessonState(l, at(DAY, '14:59') + 59_999)).toBe('current')
    expect(lessonState(l, at(DAY, '15:00'))).toBe('ended_unconfirmed')
    expect(lessonState(l, at(DAY, '23:59'))).toBe('ended_unconfirmed')
  })

  it('held and cancelled do not depend on time', () => {
    expect(lessonState({ ...l, status: 'held' }, at(DAY, '10:00'))).toBe('held')
    expect(lessonState({ ...l, status: 'cancelled' }, at(DAY, '14:30'))).toBe('cancelled')
  })

  it('midnight: a lesson of the next day is upcoming at 23:59 and the date flips at 00:00', () => {
    const early = lesson('n', '00:10', { lesson_date: '2026-10-09' })
    expect(lessonState(early, at(DAY, '23:54'))).toBe('upcoming')
    expect(lessonState(early, at(DAY, '23:55'))).toBe('current')
    expect(bishkekDate(at(DAY, '23:59') + 59_999)).toBe(DAY)
    expect(bishkekDate(at('2026-10-09', '00:00'))).toBe('2026-10-09')
  })

  it('a lesson running over midnight ends on the next day', () => {
    const late = lesson('l', '23:30')
    expect(lessonState(late, at('2026-10-09', '00:29'))).toBe('current')
    expect(lessonState(late, at('2026-10-09', '00:30'))).toBe('ended_unconfirmed')
  })
})

describe('confirmCopy (#41)', () => {
  const l = lesson('a', '14:00')
  const action = (now: number, over: Partial<LessonTiming> = {}) =>
    confirmCopy(lessonState({ ...l, ...over }, now)).action

  it('today, from the start until the end — «Провести занятие»', () => {
    expect(action(at(DAY, '13:45'))).toBe('Провести занятие')
    expect(action(at(DAY, '14:59'))).toBe('Провести занятие')
  })

  it('past the end today or an earlier day — «Подтвердить занятие»', () => {
    expect(action(at(DAY, '15:00'))).toBe('Подтвердить занятие')
    expect(action(at(DAY, '10:00'), { lesson_date: '2026-10-07' })).toBe('Подтвердить занятие')
  })

  it('texts follow the verb', () => {
    expect(confirmCopy('ended_unconfirmed')).toMatchObject({
      hint: 'Отметьте всех, чтобы подтвердить',
      done: 'Занятие подтверждено',
      failed: 'Не удалось подтвердить занятие',
    })
    expect(confirmCopy('current')).toMatchObject({
      hint: 'Отметьте всех, чтобы провести',
      done: 'Занятие проведено',
      failed: 'Не удалось провести занятие',
    })
  })
})

describe('inCurrentWindow', () => {
  const l = lesson('a', '14:00')

  it('from −15 min to end +30 min, inclusive', () => {
    expect(inCurrentWindow(l, at(DAY, '13:45') - 1)).toBe(false)
    expect(inCurrentWindow(l, at(DAY, '13:45'))).toBe(true)
    expect(inCurrentWindow(l, at(DAY, '15:30'))).toBe(true)
    expect(inCurrentWindow(l, at(DAY, '15:30') + 1)).toBe(false)
  })

  it('only planned lessons', () => {
    expect(inCurrentWindow({ ...l, status: 'held' }, at(DAY, '14:10'))).toBe(false)
  })
})

describe('deckOrder', () => {
  const l09 = lesson('09', '09:00', { status: 'held' })
  const l11 = lesson('11', '11:00')
  const l14 = lesson('14', '14:00')
  const l16 = lesson('16', '16:00')
  const l17 = lesson('17', '17:00', { status: 'cancelled' })
  const all = [l16, l14, l17, l09, l11]
  const ids = (now: number) => deckOrder(all, now).map((l) => l.id)

  it('current on top, then upcoming, unconfirmed past last; held and cancelled out', () => {
    expect(ids(at(DAY, '14:24'))).toEqual(['14', '16', '11'])
  })

  it('before any window — the nearest upcoming on top', () => {
    expect(ids(at(DAY, '08:00'))).toEqual(['11', '14', '16'])
  })

  it('ended lesson stays on top for 30 min after its end', () => {
    expect(ids(at(DAY, '15:30'))).toEqual(['14', '16', '11'])
    expect(ids(at(DAY, '15:31'))).toEqual(['16', '11', '14'])
  })

  it('the earlier lesson wins when two windows overlap', () => {
    // 14:00 is in its +30 tail, 15:00 lesson already in its −15 head
    const l15 = lesson('15', '15:00')
    expect(deckOrder([l15, l14], at(DAY, '15:10')).map((l) => l.id)).toEqual(['14', '15'])
  })

  it('after the last lesson — only unconfirmed ones remain, by time', () => {
    expect(ids(at(DAY, '20:00'))).toEqual(['11', '14', '16'])
  })
})

describe('captions', () => {
  it('minutesLeft rounds up and stops at 0', () => {
    const l = lesson('a', '14:00')
    expect(minutesLeft(l, at(DAY, '14:24'))).toBe(36)
    expect(minutesLeft(l, at(DAY, '14:24') + 1)).toBe(36)
    expect(minutesLeft(l, at(DAY, '15:10'))).toBe(0)
  })

  it('untilLabel: minutes under an hour, whole hours after', () => {
    const l = lesson('a', '16:00')
    expect(untilLabel(l, at(DAY, '15:20'))).toBe('через 40 мин')
    expect(untilLabel(l, at(DAY, '14:24'))).toBe('через 1 ч')
    expect(untilLabel(l, at(DAY, '12:59'))).toBe('через 3 ч')
  })

  it('counts skip cancelled lessons', () => {
    const counts = dayCounts([
      lesson('1', '09:00', { status: 'held' }),
      lesson('2', '11:00', { status: 'held' }),
      lesson('3', '14:00'),
      lesson('4', '16:00'),
      lesson('5', '17:00', { status: 'cancelled' }),
    ])
    expect(countsCaption(counts)).toBe('4 занятия · 2 проведено · осталось 2')
    expect(countsCaption(dayCounts([lesson('1', '09:00')]))).toBe(
      '1 занятие · 0 проведено · осталось 1',
    )
  })

  it('timeRange', () => {
    expect(timeRange(lesson('a', '14:00'))).toBe('14:00–15:00')
    expect(timeRange({ planned_start: '08:00:00', duration_min: 180 })).toBe('08:00–11:00')
  })
})

describe('splitDays', () => {
  it('today by time, tomorrow without cancelled', () => {
    const rows = [
      lesson('t2', '14:00'),
      lesson('t1', '09:00', { status: 'held' }),
      lesson('y1', '15:00', { lesson_date: '2026-10-07' }),
      lesson('y2', '09:00', { lesson_date: '2026-10-07', status: 'held' }),
      lesson('m1', '15:00', { lesson_date: '2026-10-09' }),
      lesson('m2', '16:00', { lesson_date: '2026-10-09', status: 'cancelled' }),
    ]
    const ids = (ls: LessonTiming[]) => ls.map((l) => l.id)
    const d = splitDays(rows, DAY)
    expect(ids(d.today)).toEqual(['t1', 't2'])
    expect(ids(d.tomorrow)).toEqual(['m1'])
  })
})

describe('unconfirmedInMonth', () => {
  const ids = (ls: LessonTiming[]) => ls.map((l) => l.id)
  const now = at(DAY, '14:24')

  it('planned lessons of earlier days of this month, nearest first; today and last month left out', () => {
    const rows = [
      lesson('today', '09:00'), // ended today — it is on the deck, not in the banner
      lesson('y15', '15:00', { lesson_date: '2026-10-07' }),
      lesson('y09', '09:00', { lesson_date: '2026-10-07' }),
      lesson('held', '11:00', { lesson_date: '2026-10-06', status: 'held' }),
      lesson('cancelled', '11:00', { lesson_date: '2026-10-05', status: 'cancelled' }),
      lesson('first', '09:00', { lesson_date: '2026-10-01' }),
      lesson('sep', '15:00', { lesson_date: '2026-09-30' }),
      lesson('tomorrow', '15:00', { lesson_date: '2026-10-09' }),
    ]
    const u = unconfirmedInMonth(rows, now)
    expect(ids(u.lessons)).toEqual(['y15', 'y09', 'first'])
    expect(u.onlyYesterday).toBe(false)
    expect(unconfirmedTitle(u)).toBe('Не подтверждено: 3 занятия')
    expect(unconfirmedChip(u)).toBe('3 не подтверждено')
  })

  it('only yesterday → «Вчера не подтверждено»', () => {
    const u = unconfirmedInMonth([lesson('y', '15:00', { lesson_date: '2026-10-07' })], now)
    expect(u.onlyYesterday).toBe(true)
    expect(unconfirmedTitle(u)).toBe('Вчера не подтверждено')
    expect(unconfirmedChip(u)).toBe('1 не подтверждено за вчера')
  })

  it('on the 1st yesterday is last month — nothing to show', () => {
    const u = unconfirmedInMonth(
      [lesson('sep', '15:00', { lesson_date: '2026-09-30' })],
      at('2026-10-01', '10:00'),
    )
    expect(u.lessons).toEqual([])
    expect(u.onlyYesterday).toBe(false)
  })

  it('the Bishkek day decides, not UTC: 00:30 in Bishkek is already the next day', () => {
    const u = unconfirmedInMonth(
      [lesson('y', '15:00', { lesson_date: '2026-10-07' })],
      at('2026-10-08', '00:30'), // still 7 Oct in UTC
    )
    expect(u.onlyYesterday).toBe(true)
  })

  it('«12 занятий» plural', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      lesson(`l${i}`, '09:00', { lesson_date: `2026-10-0${(i % 7) + 1}` }),
    )
    expect(unconfirmedTitle(unconfirmedInMonth(rows, now))).toBe('Не подтверждено: 12 занятий')
  })
})

describe('with useNow (local clock, no refetch)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('at 15:00 the 14:00 lesson becomes ended_unconfirmed without a reload', () => {
    vi.setSystemTime(at(DAY, '14:59') + 30_000)
    const store = createNowStore()
    const l = lesson('14', '14:00')
    const { result } = renderHook(() => lessonState(l, useNow(store)))
    expect(result.current).toBe('current')

    act(() => {
      vi.advanceTimersByTime(30_000) // next tick lands on 15:00
    })
    expect(result.current).toBe('ended_unconfirmed')
  })
})
