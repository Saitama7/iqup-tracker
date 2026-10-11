// Phone login helpers — shared by the SPA (src/lib/phone.ts) and Edge Functions.
// Canonical form: 996XXXXXXXXX (Kyrgyzstan, 9-digit national number). Docs: 02-architecture.md §5.

const CANONICAL = /^996\d{9}$/

export class InvalidPhoneError extends Error {
  constructor(input: string) {
    super(`Некорректный номер телефона: ${input}`)
    this.name = 'InvalidPhoneError'
  }
}

/** '0552 775 771' | '+996 552 775 771' | '996552775771' | '552775771' → '996552775771' */
export function normalizePhone(input: string): string {
  const trimmed = input.trim()
  if (!/^\+?[\d\s()-]+$/.test(trimmed)) throw new InvalidPhoneError(input)

  const digits = trimmed.replace(/\D/g, '')
  let national: string
  if (digits.length === 12 && digits.startsWith('996')) national = digits.slice(3)
  else if (digits.length === 10 && digits.startsWith('0')) national = digits.slice(1)
  else if (digits.length === 9 && !trimmed.startsWith('+')) national = digits
  else throw new InvalidPhoneError(input)

  // National numbers never start with 0 (that's the trunk prefix).
  if (national.startsWith('0')) throw new InvalidPhoneError(input)
  return `996${national}`
}

export function isCanonicalPhone(phone: string): boolean {
  return CANONICAL.test(phone)
}

/** '996552775771' → '0552 775 771' (how people write it locally) */
export function formatPhone(phone: string): string {
  if (!CANONICAL.test(phone)) throw new InvalidPhoneError(phone)
  const n = phone.slice(3)
  return `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`
}

/** Synthetic Supabase Auth email for a phone login. */
export function phoneToEmail(input: string): string {
  return `${normalizePhone(input)}@iqup.local`
}
