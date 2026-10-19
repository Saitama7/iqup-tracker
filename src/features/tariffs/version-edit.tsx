// #94 · «Изменить цены» / «Удалить версию» of a tariff version in А9а (update_tariff_version,
// delete_tariff_version). The database decides; errors show under the form.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type SubmitEvent } from 'react'
import { toast } from 'sonner'
import { AUDIT_KEY } from '@/features/audit/api'
import { FormDialog } from '@/features/students/parts'
import { useNow } from '@/lib/now'
import { bishkekDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { settingsQuery } from './api'
import { GROUP_TYPES } from './current'
import {
  AFTERSCHOOL_WARNING,
  afterschoolChanged,
  IN_EFFECT_WARNING,
  versionFormDefaults,
  versionInEffect,
} from './edit-model'
import {
  deleteTariffForm,
  deleteTariffVersion,
  updateTariffForm,
  updateTariffVersion,
} from './edit-api'
import { formatDateLong, GROUP_TYPE_LABEL, type TariffVersion } from './model'
import { ErrorText, Field, inputClass, SubmitButton } from './parts'

function useInvalidate() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: settingsQuery().queryKey }),
      queryClient.invalidateQueries({ queryKey: [AUDIT_KEY] }),
    ])
}

const warningClass = 'rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong'

function ReasonField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Field id={id} label="Причина">
      <input
        id={id}
        value={value}
        maxLength={500}
        placeholder="обязательно, например «ошиблись в цене»"
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value)
        }}
        className={inputClass}
      />
    </Field>
  )
}

type Action = 'edit' | 'delete'

/** Buttons under a version card + their dialogs. */
export function VersionActions({ version }: { version: TariffVersion }) {
  const [action, setAction] = useState<Action | null>(null)
  const close = () => {
    setAction(null)
  }
  const label = `с ${formatDateLong(version.validFrom)}`
  return (
    <div className="flex flex-wrap gap-2">
      <SubmitButton
        variant="outline"
        onClick={() => {
          setAction('edit')
        }}
      >
        Изменить цены
      </SubmitButton>
      <SubmitButton
        variant="danger"
        onClick={() => {
          setAction('delete')
        }}
      >
        Удалить версию
      </SubmitButton>
      <FormDialog
        open={action === 'edit'}
        onOpenChange={(o) => {
          if (!o) close()
        }}
        title="Изменить цены"
        description={`Версия ${label}. Запись с причиной останется в журнале изменений.`}
      >
        {action === 'edit' && <EditForm version={version} onDone={close} />}
      </FormDialog>
      <FormDialog
        open={action === 'delete'}
        onOpenChange={(o) => {
          if (!o) close()
        }}
        title="Удалить версию?"
        description={`Версия ${label}. Запись с причиной останется в журнале изменений.`}
      >
        {action === 'delete' && <DeleteForm version={version} onDone={close} />}
      </FormDialog>
    </div>
  )
}

function EditForm({ version, onDone }: { version: TariffVersion; onDone: () => void }) {
  const id = useId()
  const today = bishkekDate(useNow())
  const invalidate = useInvalidate()
  const defaults = versionFormDefaults(version)
  const [prices, setPrices] = useState(defaults.prices)
  const [hourPrice, setHourPrice] = useState(defaults.hourPrice)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inEffect = versionInEffect(version, today)

  const mutation = useMutation({
    mutationFn: updateTariffVersion,
    onSuccess: () => {
      void invalidate()
      toast.success('Цены изменены')
      onDone()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  const parsed = updateTariffForm.safeParse({
    validFrom: version.validFrom,
    prices,
    hourPrice,
    reason: reason || 'x',
  })
  const showAfterschool =
    inEffect &&
    parsed.success &&
    afterschoolChanged(version, {
      afterschoolPrice: parsed.data.prices.afterschool,
      hourPrice: parsed.data.hourPrice,
    })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = updateTariffForm.safeParse({
      validFrom: version.validFrom,
      prices,
      hourPrice,
      reason,
    })
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Проверьте поля формы')
      return
    }
    setError(null)
    mutation.mutate(result.data)
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Изменить цены"
      className="flex flex-col gap-3.5"
    >
      {GROUP_TYPES.map((type) => (
        <div key={type} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3">
          <label htmlFor={`${id}-${type}`} className="text-sm font-extrabold">
            {GROUP_TYPE_LABEL[type]}
          </label>
          <input
            id={`${id}-${type}`}
            inputMode="numeric"
            autoComplete="off"
            className={cn(inputClass, 'text-right tabular-nums')}
            value={prices[type]}
            onChange={(e) => {
              setPrices((p) => ({ ...p, [type]: e.target.value }))
              setError(null)
            }}
          />
        </div>
      ))}
      <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3">
        <div className="flex min-w-0 flex-col">
          <label htmlFor={`${id}-hour`} className="text-sm font-extrabold">
            Продлёнка · цена часа
          </label>
          <span className="text-xs font-bold text-ink-muted">пусто — считать от цены пакета</span>
        </div>
        <input
          id={`${id}-hour`}
          inputMode="numeric"
          autoComplete="off"
          className={cn(inputClass, 'text-right tabular-nums')}
          value={hourPrice}
          onChange={(e) => {
            setHourPrice(e.target.value)
            setError(null)
          }}
        />
      </div>
      {inEffect && <p className={warningClass}>{IN_EFFECT_WARNING}</p>}
      {showAfterschool && <p className={warningClass}>{AFTERSCHOOL_WARNING}</p>}
      <ReasonField
        id={`${id}-reason`}
        value={reason}
        onChange={(v) => {
          setReason(v)
          setError(null)
        }}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <SubmitButton pending={mutation.isPending} className="min-h-12">
        Сохранить
      </SubmitButton>
    </form>
  )
}

function DeleteForm({ version, onDone }: { version: TariffVersion; onDone: () => void }) {
  const id = useId()
  const today = bishkekDate(useNow())
  const invalidate = useInvalidate()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: deleteTariffVersion,
    onSuccess: () => {
      void invalidate()
      toast.success('Версия тарифа удалена')
      onDone()
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = deleteTariffForm.safeParse({ validFrom: version.validFrom, reason })
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Укажите причину')
      return
    }
    setError(null)
    mutation.mutate(result.data)
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Удалить версию"
      className="flex flex-col gap-3.5"
    >
      <p className={warningClass}>
        {versionInEffect(version, today)
          ? 'Действует предыдущая версия. Удалить можно, только если по этой версии не куплено ни одного абонемента.'
          : 'Запланированная версия будет удалена — в силе останется действующий тариф.'}
      </p>
      <ReasonField
        id={`${id}-reason`}
        value={reason}
        onChange={(v) => {
          setReason(v)
          setError(null)
        }}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <div className="grid grid-cols-2 gap-2.5">
        <SubmitButton variant="outline" onClick={onDone}>
          Не удалять
        </SubmitButton>
        <SubmitButton variant="danger" pending={mutation.isPending}>
          Удалить версию
        </SubmitButton>
      </div>
    </form>
  )
}
