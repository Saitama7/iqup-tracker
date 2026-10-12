// Passwords are issued by the admin (Д1) and never contain whitespace, so anything blank that comes
// along with a copy from WhatsApp/Excel — spaces, NBSP, tabs, line breaks, zero-width marks — is noise.
const BLANK = /[\s\p{Cf}]/gu // \p{Cf}: zero-width space/joiners, word joiner, BOM

export function cleanPassword(raw: string): string {
  return raw.replace(BLANK, '')
}
