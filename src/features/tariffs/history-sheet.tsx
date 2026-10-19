import { X } from 'lucide-react'
import { useState } from 'react'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { lessonPrice } from './current'
import {
  formatDateLong,
  formatLessonPrice,
  formatSom,
  GROUP_TYPE_LABEL,
  subscriptionsCaption,
  versionSummary,
  type TariffVersion,
} from './model'
import { cardClass, chipClass, numClass } from './parts'
import { VersionActions } from './version-edit'

const thClass =
  'px-2.5 py-2 text-left text-[11px] font-extrabold tracking-[0.06em] whitespace-nowrap text-ink-muted uppercase'
const tdClass = 'border-b border-line px-2.5 py-2 text-sm align-middle'

const PILL: Record<TariffVersion['status'], { text: string; className: string }> = {
  planned: { text: 'запланирован', className: 'bg-teal-soft text-teal-strong' },
  current: { text: 'текущий', className: 'bg-ink text-brand' },
  archive: { text: 'архив', className: 'bg-stone text-ink-muted' },
}

// А9а История тарифов (docs/design/SettingsTariffHistory.dc.html): Sheet on the right.
export function HistorySheet({
  open,
  onOpenChange,
  versions,
  onPlan,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  versions: TariffVersion[]
  onPlan: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-[18px] overflow-y-auto border-line bg-paper p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] min-[900px]:p-7 sm:max-w-[700px]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <SheetTitle className="font-display text-[22px] leading-tight font-bold">
              История тарифов
            </SheetTitle>
            <SheetDescription className="text-[13px] font-bold text-ink-muted">
              Каждая версия действует с даты. Абонемент хранит цену на дату покупки, поэтому старые
              уроки всегда считаются по старому тарифу — и ученику, и в ЗП.
            </SheetDescription>
          </div>
          <SheetClose
            aria-label="Закрыть"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-card"
          >
            <X className="size-4" aria-hidden />
          </SheetClose>
        </div>

        <button
          type="button"
          onClick={onPlan}
          className="min-h-11 self-start rounded-[14px] bg-ink px-4 text-sm font-extrabold text-brand"
        >
          + Запланировать новый тариф с даты…
        </button>

        <ol aria-label="Версии тарифа" className="relative flex flex-col gap-3 pl-[22px]">
          <span aria-hidden className="absolute top-2.5 bottom-2.5 left-[7px] w-0.5 bg-line" />
          {versions.map((v, i) => (
            <VersionCard key={v.validFrom} version={v} next={versions[i - 1]} />
          ))}
        </ol>

        <p className="rounded-xl bg-muted px-3.5 py-3 text-xs font-bold text-ink-muted">
          Пример: Айжан купила абонемент 28 августа за 3 000 — её 12 уроков идут по 250, и ЗП
          учителя за них = 250 × 45 %. Соседка по группе, купившая 2 сентября, платит 3 200 и даёт
          учителю 266,67 × 45 % за урок. Так и было на бумаге — система только делает это видимым.
        </p>
      </SheetContent>
    </Sheet>
  )
}

function VersionCard({ version: v, next }: { version: TariffVersion; next?: TariffVersion }) {
  const [expanded, setExpanded] = useState(false)
  const pill =
    v.status === 'archive' && v.first ? { ...PILL.archive, text: 'первый' } : PILL[v.status]
  const caption = subscriptionsCaption(v, next)
  const full = v.status !== 'archive' || expanded

  return (
    <li
      aria-label={`с ${formatDateLong(v.validFrom)}`}
      className={cn(
        cardClass,
        'relative flex flex-col gap-2.5 p-4',
        v.status === 'current' && 'border-2 border-ink',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-4 -left-[21px] size-3 rounded-full border-2',
          v.status === 'current' ? 'border-ink bg-brand' : 'border-sand bg-paper',
          v.status === 'planned' && 'border-teal',
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <b className="whitespace-nowrap">с {formatDateLong(v.validFrom)}</b>
          <span className={cn(chipClass, pill.className)}>{pill.text}</span>
        </span>
        <span className="text-xs font-bold text-ink-muted">{v.author}</span>
      </div>

      {full ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={thClass}>Тип</th>
                <th className={cn(thClass, 'text-right')}>Было</th>
                <th className={cn(thClass, 'text-right')}>Стало</th>
                <th className={cn(thClass, 'text-right max-sm:hidden')}>Цена урока</th>
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.type} className="[&:last-child>td]:border-0">
                  <td className={cn(tdClass, 'font-extrabold')}>{GROUP_TYPE_LABEL[r.type]}</td>
                  <td className={cn(tdClass, numClass, 'text-ink-muted line-through')}>
                    {r.before ? formatSom(r.before.package_price) : '—'}
                  </td>
                  <td className={cn(tdClass, numClass, 'font-extrabold')}>
                    {formatSom(r.after.package_price)}
                    {/* Phone: no room for the 4th column — lesson price under the new price. */}
                    <span className="block text-xs font-bold text-ink-muted sm:hidden">
                      урок {formatLessonPrice(lessonPrice(r.after), true)}
                    </span>
                  </td>
                  <td className={cn(tdClass, numClass, 'text-xs text-ink-muted max-sm:hidden')}>
                    {r.before && `${formatLessonPrice(lessonPrice(r.before), true)} → `}
                    {formatLessonPrice(lessonPrice(r.after), true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3 text-[13px]">
          <span className="font-bold text-ink-muted">{versionSummary(v)}</span>
          <button
            type="button"
            onClick={() => {
              setExpanded(true)
            }}
            className="min-h-8 text-[13px] font-extrabold whitespace-nowrap text-teal hover:text-teal-strong"
          >
            Показать →
          </button>
        </div>
      )}

      {caption && <p className="text-xs font-bold text-ink-muted">{caption}</p>}
      {v.status !== 'archive' && <VersionActions version={v} />}
    </li>
  )
}
