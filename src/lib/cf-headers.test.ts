import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// public/_headers (Cloudflare Pages, #56): entry points revalidate, hashed assets cache forever.
function parseHeaders(text: string): Map<string, string> {
  const rules = new Map<string, string>()
  let path: string | null = null
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    if (!line.startsWith(' ')) path = line.trim()
    else if (path && /^\s+Cache-Control:/i.test(line))
      rules.set(path, line.slice(line.indexOf(':') + 1).trim())
  }
  return rules
}

const rules = parseHeaders(readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8'))

describe('public/_headers', () => {
  it.each(['/', '/index.html', '/sw.js', '/registerSW.js', '/manifest.webmanifest'])(
    '%s is no-cache',
    (path) => {
      expect(rules.get(path)).toBe('no-cache')
    },
  )

  it('/assets/* is immutable for a year', () => {
    expect(rules.get('/assets/*')).toBe('public, max-age=31536000, immutable')
  })
})
