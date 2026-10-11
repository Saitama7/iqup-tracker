// Live mask for the login phone field. The `+996` prefix is drawn next to the input
// (artboard У1), so the field holds the 9 national digits: `552 775 771`.
export function maskPhoneInput(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  // Pasted international form: 996 552 775 771 → 552 775 771
  if (digits.startsWith('996') && digits.length > 9) digits = digits.slice(3)
  // Local habit: 0552 775 771 → 552 775 771 (0 is the trunk prefix)
  if (digits.startsWith('0')) digits = digits.slice(1)
  digits = digits.slice(0, 9)
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean).join(' ')
}
