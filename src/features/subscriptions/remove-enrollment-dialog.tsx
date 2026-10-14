import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { GROUPS_KEY } from '@/features/groups/api'
import { BALANCES_KEY, PAYMENTS_KEY } from '@/features/payments/api'
import { STUDENTS_KEY } from '@/features/students/api'
import { groupLabel, type GroupBrief } from '@/features/students/model'
import { FormDialog } from '@/features/students/parts'
import { formatSom } from '@/features/tariffs/model'
import { ErrorText, SubmitButton } from '@/features/tariffs/parts'
import { TransferEnrollmentForm, transferTargets } from './transfer-enrollment-form'
import { removeEnrollment, undoInfoQuery, type UndoInfo } from './undo-api'

const noteClass = 'rounded-xl bg-accent px-3 py-2.5 text-sm font-bold text-warn-strong'

function Refusal({ children }: { children: ReactNode }) {
  return (
    <p role="status" className={noteClass}>
      {children}
    </p>
  )
}

/** What the removal deletes — shown before the button, so nothing is a surprise. */
function WillDelete({ info, label }: { info: UndoInfo; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-extrabold tracking-[0.06em] text-ink-muted uppercase">
        Будет удалено
      </span>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm font-bold">
        <li>Зачисление в {label}</li>
        <li>Абонементов: {info.subscriptions}</li>
        {info.frozen > 0 && <li>Отметок «заморожен»: {info.frozen}</li>}
      </ul>
      {info.hasTrial && (
        <p className="text-xs font-bold text-ink-muted">
          Пробное вернётся в статус «был на пробном».
        </p>
      )}
    </div>
  )
}

/**
 * «Убрать из группы» (А6, А4, #73): an enrollment entered by mistake. Loads what it would touch and
 * refuses with a reason when «был» marks (ЗП), a closed period or payments stand in the way —
 * payments are immutable, so those go with «Перевести в другую группу».
 */
export function RemoveEnrollmentDialog({
  open,
  onOpenChange,
  enrollmentId,
  studentName,
  group,
  startDate,
  groups,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  enrollmentId: string
  studentName: string
  group: GroupBrief | null
  startDate: string
  groups: readonly GroupBrief[]
}) {
  const queryClient = useQueryClient()
  const info = useQuery(undoInfoQuery(enrollmentId))
  const [mode, setMode] = useState<'confirm' | 'transfer'>('confirm')
  const [error, setError] = useState<string | null>(null)
  const label = group ? groupLabel(group) : 'группу'

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: STUDENTS_KEY }),
      queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] }),
      queryClient.invalidateQueries({ queryKey: [PAYMENTS_KEY] }),
      queryClient.invalidateQueries({ queryKey: GROUPS_KEY }),
      queryClient.invalidateQueries({ queryKey: ['group-lessons'] }),
      queryClient.invalidateQueries({ queryKey: ['trials'] }),
    ])

  const remove = useMutation({
    mutationFn: () => removeEnrollment(enrollmentId),
    onSuccess: async () => {
      await refresh()
      toast.success(`${studentName} убран(а) из группы`)
      onOpenChange(false)
    },
    onError: (e) => {
      setError(e.message)
    },
  })

  const data = info.data
  const blocked = data && (data.consumed > 0 || data.locked > 0)

  let body: ReactNode
  if (info.isPending) {
    body = <div className="h-24 animate-pulse rounded-xl bg-muted" aria-label="Загрузка" />
  } else if (info.isError) {
    body = <ErrorText>{info.error.message}</ErrorText>
  } else if (!data) {
    body = <ErrorText>Не удалось загрузить данные зачисления</ErrorText>
  } else if (mode === 'transfer') {
    body = (
      <TransferEnrollmentForm
        enrollmentId={enrollmentId}
        startDate={startDate}
        targets={transferTargets(groups, group)}
        onBack={() => {
          setMode('confirm')
        }}
        onDone={async (target) => {
          await refresh()
          toast.success(`${studentName} переведён(а) в ${groupLabel(target)}`)
          onOpenChange(false)
        }}
      />
    )
  } else {
    body = (
      <>
        {data.consumed > 0 && (
          <Refusal>
            У ученика есть отметки «был» — за них начислена ЗП. Завершите зачисление вместо
            удаления.
          </Refusal>
        )}
        {data.consumed === 0 && data.locked > 0 && (
          <Refusal>Есть отметки в закрытом периоде.</Refusal>
        )}
        {!blocked && <WillDelete info={data} label={label} />}
        {!blocked && data.payments > 0 && (
          <Refusal>
            Есть оплаты ({formatSom(data.paidTotal)} сом) — оплаты не удаляются. Переведите ученика
            в другую группу того же типа.
          </Refusal>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <div className="grid gap-2.5 min-[420px]:grid-cols-2">
          {!blocked && (
            <SubmitButton
              variant="outline"
              onClick={() => {
                setError(null)
                setMode('transfer')
              }}
            >
              Перевести в другую группу
            </SubmitButton>
          )}
          {!blocked && data.payments === 0 && (
            <SubmitButton
              variant="danger"
              pending={remove.isPending}
              onClick={() => {
                setError(null)
                remove.mutate()
              }}
            >
              Убрать из группы
            </SubmitButton>
          )}
          {blocked && (
            <SubmitButton
              variant="outline"
              onClick={() => {
                onOpenChange(false)
              }}
            >
              Закрыть
            </SubmitButton>
          )}
        </div>
      </>
    )
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'transfer' ? 'Перевести в другую группу' : 'Убрать из группы?'}
      description={`${studentName} · ${label}`}
    >
      {body}
    </FormDialog>
  )
}
