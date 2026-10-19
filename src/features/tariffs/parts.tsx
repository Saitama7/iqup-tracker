import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Same look as А8 (users-page): cards, table heads, 44 px inputs and buttons.
export const cardClass = 'rounded-[20px] border border-line bg-card'
export const thClass =
  'px-3.5 py-3 text-left text-[11px] font-extrabold tracking-[0.06em] whitespace-nowrap text-ink-muted uppercase'
export const tdClass = 'border-b border-line px-3.5 py-3 align-middle text-sm'
export const numClass = 'text-right tabular-nums whitespace-nowrap'
export const labelClass = 'text-[11px] font-extrabold tracking-[0.06em] text-ink-muted uppercase'
export const inputClass =
  'min-h-11 w-full min-w-0 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 text-base font-bold text-ink outline-none placeholder:font-semibold placeholder:text-placeholder focus:border-ink'
export const chipClass =
  'inline-block rounded-full px-2.5 py-1 text-xs leading-[1.3] font-extrabold whitespace-nowrap'

export function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
    </div>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm font-bold text-burned">
      {children}
    </p>
  )
}

export function SubmitButton({
  children,
  pending,
  disabled,
  describedBy,
  onClick,
  variant = 'primary',
  className,
}: {
  children: ReactNode
  pending?: boolean
  disabled?: boolean
  /** aria-describedby — why the button is disabled. */
  describedBy?: string
  onClick?: () => void
  variant?: 'primary' | 'outline' | 'danger'
  className?: string
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      onClick={onClick}
      disabled={pending || disabled}
      aria-describedby={describedBy}
      className={cn(
        'flex min-h-11 items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-extrabold whitespace-nowrap disabled:opacity-50',
        variant === 'primary' && 'bg-ink text-brand',
        variant === 'outline' && 'border-[1.5px] border-line-strong bg-card text-ink',
        variant === 'danger' && 'border-[1.5px] border-line-strong bg-card text-burned-strong',
        className,
      )}
    >
      {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

/** Small centred dialog of А9 (holidays, subjects). */
export function SmallDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 rounded-[20px] border-line bg-card p-6 sm:max-w-md">
        <div className="flex flex-col gap-1.5 pr-6">
          <DialogTitle className="font-display text-lg font-bold">{title}</DialogTitle>
          <DialogDescription className="text-sm font-bold text-ink-muted">
            {description}
          </DialogDescription>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  )
}
