import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/page'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'
import { useIsDesktop } from '@/lib/use-is-desktop'
import { cn } from '@/lib/utils'
import { SubjectsSection } from '@/features/subjects/subjects-section'
import { settingsQuery } from './api'
import { tariffHourPrice } from '@/features/afterschool/model'
import { lessonPrice, teacherShare } from './current'
import { HistorySheet } from './history-sheet'
import { HolidaysSection } from './holidays-section'
import { PlanTariffsDialog } from './plan-dialog'
import {
  buildVersions,
  currentTariffs,
  formatDateLong,
  formatLessonPrice,
  formatSom,
  GROUP_TYPE_LABEL,
  holidayItems,
  RULES,
  seatsLabel,
  type Tariff,
} from './model'
import { cardClass, numClass, tdClass, thClass } from './parts'

const sectionHead =
  'flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-[18px] py-3.5'
const sectionTitle = 'text-[15px] font-extrabold'
const sectionCaption = 'text-xs font-bold text-ink-muted'

// А9 Тарифы и праздники (docs/design/AdminSettings.dc.html), А9а — history-sheet.tsx.
export function SettingsPage() {
  const isDesktop = useIsDesktop()
  const now = useNow()
  const today = bishkekDate(now)
  const query = useQuery(settingsQuery())
  const data = query.data
  const [historyOpen, setHistoryOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)

  const versions = useMemo(() => (data ? buildVersions(data, today) : []), [data, today])
  const tariffs = useMemo(() => (data ? currentTariffs(data.tariffs, today) : []), [data, today])
  const holidays = useMemo(() => (data ? holidayItems(data.holidays, today) : []), [data, today])
  const current = versions.find((v) => v.status === 'current')
  const planned = versions.filter((v) => v.status === 'planned').at(-1)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Настройки центра" title="Тарифы и праздники" />

      {query.isPending ? (
        <div className={cn(cardClass, 'h-64 animate-pulse')} aria-label="Загрузка" />
      ) : query.isError ? (
        <p role="alert" className={cn(cardClass, 'p-5 font-bold text-burned')}>
          Не удалось загрузить тарифы. Проверьте интернет и обновите страницу.
        </p>
      ) : (
        <>
          <section className={cn(cardClass, 'overflow-x-auto')} aria-label="Тарифы">
            <div className={sectionHead}>
              <div>
                <h2 className={sectionTitle}>
                  Тарифы
                  {current && ` · действуют с ${formatDateLong(current.validFrom)}`}
                </h2>
                <p className={sectionCaption}>
                  Абонемент фиксирует цену на дату покупки — изменение тарифа не трогает уже
                  купленные
                </p>
                {planned && (
                  <p className="text-xs font-extrabold text-teal">
                    Запланирован новый тариф с {formatDateLong(planned.validFrom)}
                  </p>
                )}
              </div>
              <div className={cn('flex gap-2', !isDesktop && 'w-full flex-col')}>
                <button
                  type="button"
                  onClick={() => {
                    setHistoryOpen(true)
                  }}
                  className="min-h-11 flex-1 rounded-xl border-[1.5px] border-line-strong bg-card px-3.5 text-[13px] font-extrabold whitespace-nowrap"
                >
                  История тарифов
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlanOpen(true)
                  }}
                  className="min-h-11 flex-1 rounded-xl bg-ink px-4 text-[13px] font-extrabold whitespace-nowrap text-brand"
                >
                  Новая версия тарифов
                </button>
              </div>
            </div>
            {isDesktop ? <TariffTable tariffs={tariffs} /> : <TariffCards tariffs={tariffs} />}
          </section>

          <div
            className={cn(
              'grid items-start gap-6',
              isDesktop ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-1 gap-4',
            )}
          >
            <Rules />
            <HolidaysSection items={holidays} today={today} />
          </div>

          <SubjectsSection />
        </>
      )}

      {data && (
        <>
          <HistorySheet
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            versions={versions}
            onPlan={() => {
              setPlanOpen(true)
            }}
          />
          <PlanTariffsDialog
            open={planOpen}
            onOpenChange={setPlanOpen}
            tariffs={data.tariffs}
            subscriptions={data.subscriptions}
            today={today}
          />
        </>
      )}
    </div>
  )
}

// ─── Tariffs ────────────────────────────────────────────────────────────────

const share = (t: Tariff) => `${teacherShare(t, 45)} / ${teacherShare(t, 50)}`
/** Продлёнка по часам: учителю за ученико-час — % × цена часа (И62). */
const hourShare = (t: Tariff) => {
  const h = tariffHourPrice(t)
  return `${Math.round((h * 45) / 100)} / ${Math.round((h * 50) / 100)}`
}

function TariffTable({ tariffs }: { tariffs: Tariff[] }) {
  return (
    <table className="w-full min-w-[820px] border-collapse">
      <thead>
        <tr className="border-b border-line">
          <th className={thClass}>Тип группы</th>
          <th className={cn(thClass, 'text-right')}>Мест</th>
          <th className={cn(thClass, 'text-right')}>Уроков в пакете</th>
          <th className={cn(thClass, 'text-right')}>Цена пакета</th>
          <th className={cn(thClass, 'text-right')}>Цена урока</th>
          <th className={cn(thClass, 'text-right')}>Длительность</th>
          <th className={cn(thClass, 'text-right')}>Заморозок</th>
          <th className={cn(thClass, 'text-right')}>Учителю 45 % / 50 %</th>
        </tr>
      </thead>
      <tbody>
        {tariffs.map((t) => (
          <tr key={t.id} className="[&:last-child>td]:border-0">
            <td className={cn(tdClass, 'font-extrabold')}>{GROUP_TYPE_LABEL[t.group_type]}</td>
            <td className={cn(tdClass, numClass)}>{seatsLabel(t.max_students)}</td>
            <td className={cn(tdClass, numClass)}>{t.lessons_in_package}</td>
            <td className={cn(tdClass, numClass, 'font-extrabold')}>
              {formatSom(t.package_price)}
            </td>
            <td className={cn(tdClass, numClass)}>
              {formatLessonPrice(lessonPrice(t))}
              {t.group_type === 'afterschool' && (
                <span className="block text-xs font-bold text-teal">
                  час {formatSom(tariffHourPrice(t))}
                </span>
              )}
            </td>
            <td className={cn(tdClass, numClass)}>{t.lesson_duration_min} мин</td>
            <td className={cn(tdClass, numClass)}>{t.freeze_limit ?? 'без лимита'}</td>
            <td className={cn(tdClass, numClass, 'text-ink-muted')}>
              {share(t)}
              {t.group_type === 'afterschool' && (
                <span className="block text-xs font-bold text-teal">час {hourShare(t)}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Phone: one card per group type instead of the 8-column table. */
function TariffCards({ tariffs }: { tariffs: Tariff[] }) {
  return (
    <ul className="flex flex-col">
      {tariffs.map((t) => (
        <li
          key={t.id}
          className="flex flex-col gap-1.5 border-b border-line px-4 py-3.5 last:border-0"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-extrabold">{GROUP_TYPE_LABEL[t.group_type]}</span>
            <span className="font-display text-base font-bold whitespace-nowrap">
              {formatSom(t.package_price)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-[13px] text-ink-muted">
            <span>
              {t.lessons_in_package} уроков · {t.lesson_duration_min} мин · мест{' '}
              {seatsLabel(t.max_students)}
            </span>
            <span className="whitespace-nowrap">урок {formatLessonPrice(lessonPrice(t))}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-[13px] text-ink-muted">
            <span>
              {t.freeze_limit === null ? 'Заморозки без лимита' : `Заморозок ${t.freeze_limit}`}
            </span>
            <span className="whitespace-nowrap">учителю 45 % / 50 %: {share(t)}</span>
          </div>
          {t.group_type === 'afterschool' && (
            <div className="flex items-baseline justify-between gap-3 text-[13px] font-bold text-teal">
              <span className="whitespace-nowrap">
                по часам: час {formatSom(tariffHourPrice(t))}
              </span>
              <span className="whitespace-nowrap">учителю {hourShare(t)} за час</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

// ─── Rules (read-only until R2) ─────────────────────────────────────────────

function Rules() {
  return (
    <section
      aria-label="Скидки и правила"
      className={cn(cardClass, 'flex flex-col gap-3 px-5 py-[18px]')}
    >
      <h2 className={sectionTitle}>Скидки и правила</h2>
      <ul className="flex flex-col">
        {RULES.map((r) => (
          <li
            key={r.title}
            className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0"
          >
            <div>
              <div className="text-sm font-extrabold">{r.title}</div>
              <div className={sectionCaption}>{r.caption}</div>
            </div>
            <span className="font-display text-base font-bold whitespace-nowrap">{r.value}</span>
          </li>
        ))}
      </ul>
      <p className="rounded-xl bg-muted px-3 py-2.5 text-xs font-bold text-ink-muted">
        Скидки влияют только на цену для ученика. ЗП учителя всегда считается от полной цены тарифа.
      </p>
    </section>
  )
}
