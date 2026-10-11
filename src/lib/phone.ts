// Single source of truth lives next to Edge Functions so both runtimes share it.
import { formatPhone } from '../../supabase/functions/_shared/phone.ts'

export {
  InvalidPhoneError,
  formatPhone,
  isCanonicalPhone,
  normalizePhone,
  phoneToEmail,
} from '../../supabase/functions/_shared/phone.ts'

/** '996555123456' → '+996 555 123 456' (artboard У7) */
export function formatPhoneIntl(phone: string): string {
  return `+996 ${formatPhone(phone).slice(1)}`
}
