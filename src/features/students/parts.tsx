import { ChevronDown } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { chipClass } from '@/features/tariffs/parts'
import { cn } from '@/lib/utils'
import { STATUS_LABEL, type StudentStatus } from './model'

// Shared by А5 / А6 and the enrollment dialog; same look as А8 / А9 (tariffs/parts.tsx).

/** Native select: the iOS picker on the phone, plain option roles for e2e. */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <select
        {...props}
        className="min-h-11 w-full min-w-0 appearance-none rounded-xl border-[1.5px] border-line-strong bg-card pr-9 pl-3.5 text-base font-bold text-ink outline-none focus:border-ink disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted"
        strokeWidth={2.5}
        aria-hidden
      />
    </div>
  )
}

const STATUS_CHIP: Record<StudentStatus, string> = {
  active: 'bg-present-soft text-present-strong',
  exhausted: 'bg-warn-soft text-warn-strong',
  not_enrolled: 'bg-stone text-ink-muted',
}

export function StatusChip({ status }: { status: StudentStatus }) {
  return <span className={cn(chipClass, STATUS_CHIP[status])}>{STATUS_LABEL[status]}</span>
}

export function FormDialog({
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto rounded-[20px] border-line bg-card p-6 sm:max-w-md">
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
