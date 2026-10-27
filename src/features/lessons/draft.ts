import { MARKS, type Mark, type RosterRow } from './attendance'

/**
 * Marks before «Провести» are a client draft (И19). It survives leaving the page and a reload:
 * localStorage per lesson, cleared once the lesson is held / cancelled. Storage may be missing
 * or full (Safari private mode) — then the draft simply lives in the page state.
 */

const PREFIX = 'iqup:lesson-draft:'
/** A draft nobody came back to is dropped after two weeks. */
export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000

interface StoredDraft {
  savedAt: number
  marks: Record<string, Mark>
}

export const draftKey = (lessonId: string) => `${PREFIX}${lessonId}`

export function encodeDraft(marks: ReadonlyMap<string, Mark>, savedAt: number): string {
  const stored: StoredDraft = { savedAt, marks: Object.fromEntries(marks) }
  return JSON.stringify(stored)
}

const isMark = (v: unknown): v is Mark => MARKS.includes(v as Mark)

function parse(raw: string | null): StoredDraft | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { savedAt, marks } = value as Record<string, unknown>
    if (typeof savedAt !== 'number' || typeof marks !== 'object' || marks === null) return null
    return { savedAt, marks: marks as StoredDraft['marks'] }
  } catch {
    return null
  }
}

/**
 * The draft for the current roster: students no longer on the lesson are dropped; a «Заморозка»
 * stays — there is no freeze limit (К9). null — nothing to restore.
 */
export function decodeDraft(
  raw: string | null,
  roster: readonly Pick<RosterRow, 'studentId'>[],
  now: number,
): Map<string, Mark> | null {
  const stored = parse(raw)
  if (!stored || now - stored.savedAt > DRAFT_TTL_MS) return null
  const marks = new Map<string, Mark>()
  for (const row of roster) {
    const mark = stored.marks[row.studentId]
    if (!isMark(mark)) continue
    marks.set(row.studentId, mark)
  }
  return marks.size ? marks : null
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadDraft(
  lessonId: string,
  roster: readonly Pick<RosterRow, 'studentId'>[],
  now: number,
): Map<string, Mark> | null {
  try {
    return decodeDraft(storage()?.getItem(draftKey(lessonId)) ?? null, roster, now)
  } catch {
    return null
  }
}

export function saveDraft(lessonId: string, marks: ReadonlyMap<string, Mark>, now: number) {
  const s = storage()
  if (!s) return
  try {
    pruneDrafts(s, now)
    s.setItem(draftKey(lessonId), encodeDraft(marks, now))
  } catch {
    // Quota / private mode — the draft stays in memory only.
  }
}

export function clearDraft(lessonId: string) {
  try {
    storage()?.removeItem(draftKey(lessonId))
  } catch {
    // Nothing to clean up without storage.
  }
}

/** Removes expired or unreadable drafts of other lessons. */
export function pruneDrafts(s: Storage, now: number) {
  const stale: string[] = []
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i)
    if (!key?.startsWith(PREFIX)) continue
    const stored = parse(s.getItem(key))
    if (!stored || now - stored.savedAt > DRAFT_TTL_MS) stale.push(key)
  }
  for (const key of stale) s.removeItem(key)
}
