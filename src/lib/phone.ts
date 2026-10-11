// Single source of truth lives next to Edge Functions so both runtimes share it.
export {
  InvalidPhoneError,
  formatPhone,
  isCanonicalPhone,
  normalizePhone,
  phoneToEmail,
} from '../../supabase/functions/_shared/phone.ts'
