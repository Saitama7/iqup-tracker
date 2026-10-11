import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@playwright/test'
import { localSupabase } from '../../../scripts/local-supabase'

// Readers–writer lock on lesson counts other specs pin to the seed (И20, #27). payroll.spec sums the
// held September and the unconfirmed October to the som, А1 counts «Не подтверждено» — and they run in
// parallel with specs that add, hold or remove lessons for a while. Those take the lock for writing,
// the counting specs for reading.
// Lock files live next to the local stack's URL (worktrees share one stack) and carry the owner's
// pid, so a crashed worker never leaves the lock behind. If the OS hands a dead worker's pid to another
// live process before anyone polls (or a worker dies before writing its pid), the lock looks held
// forever — then remove the directory by hand.

const dir = join(
  tmpdir(),
  `iqup-e2e-seed-${createHash('sha1').update(localSupabase().apiUrl).digest('hex').slice(0, 8)}`,
)
const WRITER = join(dir, 'writer')
const POLL_MS = 200

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Is `file` held by a live process? A file of a dead one is removed. */
async function held(file: string) {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return false
  }
  const pid = Number(text)
  // writeFile is not atomic: the owner may have created the file and not written its pid yet
  if (!text || !Number.isInteger(pid) || pid <= 0) return true
  if (alive(pid)) return true
  await rm(file, { force: true })
  return false
}

async function anyReader() {
  for (const name of await readdir(dir)) {
    if (name.startsWith('reader-') && (await held(join(dir, name)))) return true
  }
  return false
}

async function acquireWrite() {
  for (;;) {
    try {
      await writeFile(WRITER, String(process.pid), { flag: 'wx' })
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      if (await held(WRITER)) await sleep(POLL_MS)
    }
  }
  while (await anyReader()) await sleep(POLL_MS)
  return () => rm(WRITER, { force: true })
}

async function acquireRead() {
  const mine = join(dir, `reader-${randomUUID()}`)
  for (;;) {
    if (await held(WRITER)) {
      await sleep(POLL_MS)
      continue
    }
    await writeFile(mine, String(process.pid))
    if (!(await held(WRITER))) break
    // a writer came in between: let it go first
    await rm(mine, { force: true })
    await sleep(POLL_MS)
  }
  return () => rm(mine, { force: true })
}

/**
 * Every test of the calling file holds the seed lock: `read` — the test checks the seed's sums,
 * `write` — it changes them for a while. Time spent waiting is added to the test's timeout.
 */
export function lockSeed(mode: 'read' | 'write') {
  let release: (() => Promise<void>) | undefined
  // eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured fixtures argument
  test.beforeEach(async ({}, testInfo) => {
    await mkdir(dir, { recursive: true })
    // the hook shares the test's timeout: lift it while waiting, then give the test its own back
    const original = testInfo.timeout
    testInfo.setTimeout(0)
    const started = Date.now()
    release = await (mode === 'write' ? acquireWrite() : acquireRead())
    testInfo.setTimeout(original + (Date.now() - started))
  })
  test.afterEach(async () => {
    await release?.()
    release = undefined
  })
}
