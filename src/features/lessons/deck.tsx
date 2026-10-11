// У2 deck: lessons not held yet, current on top, the next one peeks out as a strip behind.
// One of the three 3D accents (docs/02-architecture.md §3): perspective + rotateX, Motion drag.
// prefers-reduced-motion → no 3D and no swipe, plain buttons instead.
import { Link } from '@tanstack/react-router'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from 'motion/react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TeacherLesson } from './api'
import { groupCaption } from './parts'
import { lessonState, minutesLeft, timeRange, untilLabel } from './select'

const SWIPE_PX = 80
const SWIPE_VELOCITY = 500

export function Deck({ lessons, now }: { lessons: TeacherLesson[]; now: number }) {
  const reduce = useReducedMotion() ?? false
  // Selected card by id: when the order changes (a lesson got held or cancelled) we either keep it
  // or fall back to the top — the current lesson.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [direction, setDirection] = useState<1 | -1>(1)
  const found = lessons.findIndex((l) => l.id === selectedId)
  const index = found >= 0 ? found : 0
  const top = lessons[index]
  const count = lessons.length
  const next = count > 1 ? lessons[(index + 1) % count] : undefined

  const go = (step: 1 | -1) => {
    if (count < 2) return
    setDirection(step)
    setSelectedId(lessons[(index + step + count) % count]?.id ?? null)
  }

  if (!top) return null

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="relative h-[252px]"
        style={reduce ? undefined : { perspective: 1000 }}
        role="group"
        aria-roledescription="колода"
        aria-label="Непроведённые занятия"
      >
        {next && <BackStrip lesson={next} now={now} reduce={reduce} />}
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <TopCard
            key={top.id}
            lesson={top}
            now={now}
            reduce={reduce}
            direction={direction}
            canSwipe={count > 1 && !reduce}
            onSwipe={go}
          />
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-ink-muted">
        <span className="inline-flex items-center gap-[5px]">
          {lessons.map((l, i) => (
            <span
              key={l.id}
              aria-hidden
              className={cn(
                'inline-block h-1.5 rounded-full',
                i === index ? 'w-4 bg-ink' : 'w-1.5 bg-deck-dot',
              )}
            />
          ))}
          <span className="ml-1 whitespace-nowrap" aria-live="polite">
            {index + 1} из {count} · только непроведённые
          </span>
        </span>
        {count > 1 &&
          (reduce ? (
            <span className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Предыдущее занятие"
                onClick={() => {
                  go(-1)
                }}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Следующее занятие"
                onClick={() => {
                  go(1)
                }}
              >
                <ChevronRight aria-hidden />
              </Button>
            </span>
          ) : (
            <span className="whitespace-nowrap">смахни ← следующее</span>
          ))}
      </div>
    </div>
  )
}

function BackStrip({
  lesson,
  now,
  reduce,
}: {
  lesson: TeacherLesson
  now: number
  reduce: boolean
}) {
  const state = lessonState(lesson, now)
  const right =
    state === 'upcoming'
      ? untilLabel(lesson, now)
      : state === 'current'
        ? 'сейчас'
        : 'не подтверждено'
  return (
    <motion.div
      key={lesson.id}
      initial={reduce ? { opacity: 0 } : { opacity: 0, rotateX: 18 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, rotateX: 6 }}
      transition={{ duration: 0.25 }}
      style={{ transformOrigin: '50% 100%' }}
      aria-hidden
      className="absolute inset-x-3.5 top-0 flex h-[70px] items-start justify-between gap-3 rounded-[22px] bg-deck-back px-[18px] py-[7px] text-[11px] font-extrabold text-ink-muted"
    >
      <span className="truncate whitespace-nowrap">
        Далее · {lesson.planned_start.slice(0, 5)} · {lesson.group.subject} {lesson.group.name}
      </span>
      <span className="whitespace-nowrap">{right}</span>
    </motion.div>
  )
}

function TopCard({
  lesson,
  now,
  reduce,
  direction,
  canSwipe,
  onSwipe,
}: {
  lesson: TeacherLesson
  now: number
  reduce: boolean
  direction: 1 | -1
  canSwipe: boolean
  onSwipe: (step: 1 | -1) => void
}) {
  const x = useMotionValue(0)
  const rotateY = useTransform(x, [-240, 0, 240], [14, 0, -14])
  const dragged = useRef(false)

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_PX || info.velocity.x < -SWIPE_VELOCITY) onSwipe(1)
    else if (info.offset.x > SWIPE_PX || info.velocity.x > SWIPE_VELOCITY) onSwipe(-1)
    // the click that ends a drag must not open the lesson
    setTimeout(() => {
      dragged.current = false
    }, 0)
  }

  const { chip, right } = cardLabels(lesson, now)

  return (
    <motion.div
      custom={direction}
      variants={reduce ? fadeVariants : flipVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      drag={canSwipe ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      dragSnapToOrigin
      onDragStart={() => {
        dragged.current = true
      }}
      onDragEnd={handleDragEnd}
      style={reduce ? undefined : { x, rotateY, transformOrigin: '50% 0%' }}
      className="absolute inset-x-0 top-[26px] h-[226px] touch-pan-y"
    >
      <Link
        to="/lessons/$lessonId"
        params={{ lessonId: lesson.id }}
        draggable={false}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        className="flex h-full flex-col justify-between rounded-[24px] bg-brand p-5 text-ink shadow-brand select-none"
        aria-label={`${lesson.group.subject} · ${lesson.group.name}, ${chip}. Отметить посещаемость`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 text-xs font-extrabold whitespace-nowrap text-brand">
            <span className="inline-block size-2 rounded-full bg-brand" aria-hidden />
            {chip}
          </span>
          <span className="text-xs font-extrabold whitespace-nowrap opacity-70">{right}</span>
        </span>
        <span className="flex flex-col gap-1">
          <span className="font-display text-[22px] leading-[1.15] font-bold">
            {lesson.group.subject}
            <br />
            {lesson.group.name}
          </span>
          <span className="text-sm font-bold opacity-75">{groupCaption(lesson)}</span>
        </span>
        <span className="flex items-center justify-between rounded-2xl bg-ink px-[18px] py-3.5 text-[15px] font-extrabold text-paper">
          Отметить посещаемость
          <ArrowRight className="size-5 text-brand" strokeWidth={2.5} aria-hidden />
        </span>
      </Link>
    </motion.div>
  )
}

// Next card comes from the strip behind (tilted back), the swiped one leaves sideways.
const flipVariants = {
  enter: { opacity: 0, y: -26, rotateX: 24, x: 0 },
  center: { opacity: 1, y: 0, rotateX: 0, x: 0 },
  exit: (dir: 1 | -1) => ({ opacity: 0, x: dir * -360, rotateY: dir * 18 }),
}

const fadeVariants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
}

function cardLabels(lesson: TeacherLesson, now: number) {
  const state = lessonState(lesson, now)
  const range = timeRange(lesson)
  if (state === 'current')
    return { chip: `Сейчас · ${range}`, right: `ещё ${minutesLeft(lesson, now)} мин` }
  if (state === 'upcoming') return { chip: `Далее · ${range}`, right: untilLabel(lesson, now) }
  return { chip: `Не подтверждено · ${range}`, right: 'закончилось' }
}

/** УД1: the deck's top card, static — the day table sits right below it. */
export function CurrentLessonCard({ lesson, now }: { lesson: TeacherLesson; now: number }) {
  const { chip, right } = cardLabels(lesson, now)
  return (
    <Link
      to="/lessons/$lessonId"
      params={{ lessonId: lesson.id }}
      className="flex min-h-[260px] flex-col justify-between gap-6 rounded-[24px] bg-brand p-[26px] text-ink shadow-brand"
      aria-label={`${lesson.group.subject} · ${lesson.group.name}, ${chip}. Отметить посещаемость`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-ink px-3.5 py-[7px] text-[13px] font-extrabold whitespace-nowrap text-brand">
          <span className="inline-block size-2 rounded-full bg-brand" aria-hidden />
          {chip}
        </span>
        <span className="text-[13px] font-extrabold whitespace-nowrap opacity-70">{right}</span>
      </span>
      <span className="flex flex-col gap-1.5">
        {/* One line on 1280 like the artboard: the column is ~4 px narrower than there. */}
        <span className="font-display text-[28px] leading-[1.1] font-bold tracking-tight text-balance">
          {lesson.group.subject} · {lesson.group.name}
        </span>
        <span className="text-[15px] font-bold opacity-75">{groupCaption(lesson)}</span>
      </span>
      <span className="flex items-center justify-between rounded-2xl bg-ink px-5 py-4 text-base font-extrabold text-paper">
        Отметить посещаемость
        <ArrowRight className="size-[22px] text-brand" strokeWidth={2.5} aria-hidden />
      </span>
    </Link>
  )
}
