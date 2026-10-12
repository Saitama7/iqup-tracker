// Live mask for the login phone field. The `+996` prefix is drawn next to the input
// (artboard У1), so the field holds the 9 national digits: `552 775 771`.
export function maskPhoneInput(raw: string): string {
  let digits = pastedPhoneDigits(raw) ?? raw.replace(/\D/g, '')
  // Pasted international form: 996 552 775 771 → 552 775 771
  if (digits.startsWith('996') && digits.length > 9) digits = digits.slice(3)
  // Local habit: 0552 775 771 → 552 775 771 (0 is the trunk prefix)
  if (digits.startsWith('0')) digits = digits.slice(1)
  digits = digits.slice(0, 9)
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean).join(' ')
}

// A number written with separators: `+996 (552) 77-57-71`, `0552 775 771`, NBSP/tab/newline inside.
const NUMBER_RUN = /\+?\d[\d\s().-]*/g

/**
 * National digits of a whole phone number found in copied text («тел: +996 (552) 77-57-71, Каныкей»),
 * or null if there is none — then the mask keeps all digits as typed.
 */
export function pastedPhoneDigits(text: string): string | null {
  for (const [run] of text.matchAll(NUMBER_RUN)) {
    const digits = run.replace(/\D/g, '')
    if (digits.length === 12 && digits.startsWith('996')) return digits.slice(3)
    if (digits.length === 10 && digits.startsWith('0')) return digits.slice(1)
    if (digits.length === 9 && !digits.startsWith('0')) return digits
  }
  return null
}
