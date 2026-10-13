import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DateInput, MonthPickerButton } from './date-picker'

function setViewport(desktop: boolean) {
  window.matchMedia = (query: string) =>
    ({
      matches: desktop,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList
}

function Field({ initial, min }: { initial: string; min?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <label htmlFor="d">Дата</label>
      <DateInput id="d" value={value} onChange={setValue} min={min} />
    </>
  )
}

/** Day button of the shown month (not an outside day of the neighbours). */
function dayButton(root: HTMLElement, n: string): HTMLElement {
  const button = within(root)
    .getAllByText(n, { selector: 'button' })
    .find((b) => !b.closest('[data-outside]'))
  if (!button) throw new Error(`no day ${n}`)
  return button
}

describe('DateInput (#62)', () => {
  beforeEach(() => {
    setViewport(false)
  })

  it('a day picked in the calendar fills the field as ДД.ММ.ГГГГ', async () => {
    const user = userEvent.setup()
    render(<Field initial="05.10.2026" />)
    await user.click(screen.getByRole('button', { name: 'Открыть календарь' }))
    const sheet = await screen.findByRole('dialog')
    await user.click(dayButton(sheet, '1'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText('Дата')).toHaveValue('01.10.2026')
  })

  it('typing keeps the mask', async () => {
    const user = userEvent.setup()
    render(<Field initial="" />)
    const input = screen.getByLabelText('Дата')
    input.focus()
    await user.type(input, '01092026')
    expect(input).toHaveValue('01.09.2026')
  })

  it('days before min are disabled', async () => {
    const user = userEvent.setup()
    render(<Field initial="10.10.2026" min="2026-10-05" />)
    await user.click(screen.getByRole('button', { name: 'Открыть календарь' }))
    const sheet = await screen.findByRole('dialog')
    const day = (n: string) => dayButton(sheet, n)
    expect(day('4')).toBeDisabled()
    expect(day('5')).toBeEnabled()
  })
})

describe('MonthPickerButton (#62)', () => {
  it('picks a month of the previous year; months after max are disabled', async () => {
    setViewport(true)
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <MonthPickerButton value="2026-10" max="2026-10" onSelect={onSelect}>
        Октябрь 2026
      </MonthPickerButton>,
    )
    await user.click(screen.getByRole('button', { name: /Октябрь 2026/ }))
    expect(await screen.findByRole('button', { name: 'Ноябрь' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Предыдущий год' }))
    await user.click(screen.getByRole('button', { name: 'Сентябрь' }))
    expect(onSelect).toHaveBeenCalledWith('2025-09')
  })
})
