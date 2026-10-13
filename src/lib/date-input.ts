// Typed dates and times on the phone: iOS shows a digits-only pad for inputMode="numeric" — no «.» and
// no «:» — so the separators are put in as the digits are typed. A separator typed by hand
// («1.9.2026» on a desktop keyboard, «,» from the decimal pad) is kept.

const DATE_SEPARATORS = './-,'

/** «01092026» → «01.09.2026»; «1.9.2026» stays; extra digits are dropped. */
export function maskDateInput(raw: string): string {
  const parts = ['']
  for (const ch of raw) {
    const i = parts.length - 1
    const part = parts[i] ?? ''
    if (ch >= '0' && ch <= '9') {
      if (part.length < (i < 2 ? 2 : 4)) parts[i] = part + ch
      else if (i < 2) parts.push(ch)
    } else if (DATE_SEPARATORS.includes(ch) && part !== '' && i < 2) {
      parts.push('')
    }
  }
  return parts.join('.')
}

/** «900» → «9:00», «1030» → «10:30»: hours are whatever is left of the last two digits. */
export function maskTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  return digits.length <= 2 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`
}
