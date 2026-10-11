// Live mask for the login phone field: `0XXX XXX XXX` (how people in Bishkek write numbers).
export function maskPhoneInput(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  // Pasted international form: 996 552 775 771 → 0552 775 771
  if (digits.startsWith('996') && digits.length > 10) digits = `0${digits.slice(3)}`
  digits = digits.slice(0, 10)
  return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 10)].filter(Boolean).join(' ')
}
