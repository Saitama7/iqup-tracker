// «Мой месяц» pay card: tilt after the finger and a count-up of the sum. One of the three 3D accents
// (docs/02-architecture.md §3): rotateX/Y by pointer, Motion `animate` for the number; only
// transform / opacity move. prefers-reduced-motion → a flat card and the final number at once.
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'
import { useEffect, type PointerEvent, type ReactNode } from 'react'
import { formatSom } from '@/features/tariffs/model'
import { cn } from '@/lib/utils'

/** Max tilt, degrees. */
const TILT = 8
const SPRING = { stiffness: 220, damping: 22 }

export function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion() ?? false
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-TILT, TILT]), SPRING)
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [TILT, -TILT]), SPRING)

  const track = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    x.set((e.clientX - box.left) / box.width - 0.5)
    y.set((e.clientY - box.top) / box.height - 0.5)
  }
  const reset = () => {
    x.set(0)
    y.set(0)
  }

  if (reduce) return <div className={className}>{children}</div>
  return (
    <div style={{ perspective: 900 }}>
      <motion.div
        data-testid="pay-card-tilt"
        className={cn('touch-pan-y', className)}
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        onPointerMove={track}
        onPointerDown={track}
        onPointerLeave={reset}
        onPointerUp={reset}
        onPointerCancel={reset}
      >
        {children}
      </motion.div>
    </div>
  )
}

/** «11 040» counting up from 0 when it first shows and from the old value when it changes. */
export function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion() ?? false
  const shown = useMotionValue(reduce ? value : 0)
  const text = useTransform(shown, (v) => formatSom(v))

  useEffect(() => {
    if (reduce) {
      shown.set(value)
      return
    }
    const controls = animate(shown, value, { duration: 0.9, ease: 'easeOut' })
    return () => {
      controls.stop()
    }
  }, [value, reduce, shown])

  return <motion.span data-testid="pay-sum">{text}</motion.span>
}
