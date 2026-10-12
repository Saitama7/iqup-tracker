import type { Balance, Mark } from './attendance'
import {
  clearDraft,
  decodeDraft,
  draftKey,
  DRAFT_TTL_MS,
  encodeDraft,
  loadDraft,
  pruneDrafts,
  saveDraft,
} from './draft'

const NOW = Date.parse('2026-10-08T14:20:00+06:00')

const balance = (freezes: number): Balance => ({
  subscriptionId: 's1',
  total: 12,
  left: 6,
  freezes,
  freezeLimit: 2,
  lessonPrice: 266.67,
})

const roster = [
  { studentId: 'a', balance: balance(0) },
  { studentId: 'b', balance: balance(2) },
  { studentId: 'c', balance: null },
]

const marks = (entries: [string, Mark][]) => new Map<string, Mark>(entries)

describe('decodeDraft', () => {
  it('restores marks of students on the roster', () => {
    const raw = encodeDraft(
      marks([
        ['a', 'absent_frozen'],
        ['b', 'present'],
        ['c', 'absent_burned'],
      ]),
      NOW,
    )
    expect(decodeDraft(raw, roster, NOW + 60_000)).toEqual(
      marks([
        ['a', 'absent_frozen'],
        ['b', 'present'],
        ['c', 'absent_burned'],
      ]),
    )
  })

  it('drops students who left the lesson and unknown statuses', () => {
    const raw = JSON.stringify({ savedAt: NOW, marks: { a: 'present', gone: 'present', c: 'x' } })
    expect(decodeDraft(raw, roster, NOW)).toEqual(marks([['a', 'present']]))
  })

  it('drops a freeze the subscription has no freezes left for (В2)', () => {
    const raw = encodeDraft(marks([['b', 'absent_frozen']]), NOW)
    expect(decodeDraft(raw, roster, NOW)).toBeNull()
  })

  it('ignores missing, broken and expired drafts', () => {
    expect(decodeDraft(null, roster, NOW)).toBeNull()
    expect(decodeDraft('{', roster, NOW)).toBeNull()
    expect(decodeDraft('[]', roster, NOW)).toBeNull()
    expect(decodeDraft(JSON.stringify({ marks: { a: 'present' } }), roster, NOW)).toBeNull()
    const old = encodeDraft(marks([['a', 'present']]), NOW - DRAFT_TTL_MS - 1)
    expect(decodeDraft(old, roster, NOW)).toBeNull()
  })
})

describe('localStorage draft', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves, loads and clears a draft per lesson', () => {
    saveDraft('l1', marks([['a', 'present']]), NOW)
    saveDraft('l2', marks([['c', 'absent_burned']]), NOW)
    expect(loadDraft('l1', roster, NOW)).toEqual(marks([['a', 'present']]))
    expect(loadDraft('l2', roster, NOW)).toEqual(marks([['c', 'absent_burned']]))
    clearDraft('l1')
    expect(loadDraft('l1', roster, NOW)).toBeNull()
    expect(loadDraft('l2', roster, NOW)).not.toBeNull()
  })

  it('prunes expired and broken drafts, keeps other keys', () => {
    localStorage.setItem(draftKey('old'), encodeDraft(marks([['a', 'present']]), 0))
    localStorage.setItem(draftKey('broken'), 'nope')
    localStorage.setItem(draftKey('fresh'), encodeDraft(marks([['a', 'present']]), NOW))
    localStorage.setItem('sb-auth', 'token')
    pruneDrafts(localStorage, NOW)
    expect(localStorage.getItem(draftKey('old'))).toBeNull()
    expect(localStorage.getItem(draftKey('broken'))).toBeNull()
    expect(localStorage.getItem(draftKey('fresh'))).not.toBeNull()
    expect(localStorage.getItem('sb-auth')).toBe('token')
  })

  it('survives a storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => {
      saveDraft('l1', marks([['a', 'present']]), NOW)
    }).not.toThrow()
    spy.mockRestore()
    expect(loadDraft('l1', roster, NOW)).toBeNull()
  })
})
