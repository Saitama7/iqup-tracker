import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DateInput, DatePickerButton, MonthPickerButton, yearRange } from './date-picker'

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

  it('typing keeps the mask (desktop: straight into the field)', async () => {
    setViewport(true)
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

describe('DateInput on the phone (#64)', () => {
  beforeEach(() => {
    setViewport(false)
  })

  it('a tap on the field opens the calendar; «Закрыть» leaves the field unfocused', async () => {
    const user = userEvent.setup()
    render(<Field initial="05.10.2026" />)
    const input = screen.getByLabelText('Дата')
    await user.click(input)
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(input).not.toHaveFocus()
    // and the next tap opens the calendar again, not the keyboard
    await user.click(input)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('«Ввести вручную» closes the sheet and focuses the field for typing', async () => {
    const user = userEvent.setup()
    render(<Field initial="" />)
    const input = screen.getByLabelText('Дата')
    await user.click(input)
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: 'Ввести вручную' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(input).toHaveFocus()
    await user.keyboard('01092026')
    expect(input).toHaveValue('01.09.2026')
    // while typing, a tap moves the caret instead of reopening the calendar
    await user.click(input)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('after «Ввести вручную» and a tap elsewhere, a tap on the field opens the sheet again (#66)', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Field initial="" />
        <button type="button">Другое</button>
      </>,
    )
    const input = screen.getByLabelText('Дата')
    await user.click(input)
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Ввести вручную' }),
    )
    expect(input).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Другое' }))
    expect(input).not.toHaveFocus()
    await user.click(input)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(input).not.toHaveFocus()
  })

  it('a field focused by its dialog still opens the calendar on a tap', async () => {
    const user = userEvent.setup()
    render(<Field initial="" />)
    const input = screen.getByLabelText('Дата')
    act(() => {
      input.focus()
    })
    await user.click(input)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('DateInput on desktop (#64)', () => {
  beforeEach(() => {
    setViewport(true)
  })

  it('no «Ввести вручную»: a click in the field is a caret; the icon toggles the popover', async () => {
    const user = userEvent.setup()
    render(<Field initial="05.10.2026" />)
    await user.click(screen.getByLabelText('Дата'))
    expect(screen.queryByRole('dialog')).toBeNull()
    const icon = screen.getByRole('button', { name: 'Открыть календарь' })
    await user.click(icon)
    const popover = await screen.findByRole('dialog')
    expect(within(popover).queryByRole('button', { name: 'Ввести вручную' })).toBeNull()
    await user.click(icon)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a click into another field closes the popover and keeps the focus there (#66)', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Field initial="05.10.2026" />
        <label htmlFor="n">Название</label>
        <input id="n" />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Открыть календарь' }))
    await screen.findByRole('dialog')
    const other = screen.getByLabelText('Название')
    await user.click(other)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await new Promise((r) => setTimeout(r, 200))
    expect(other).toHaveFocus()
    await user.keyboard('Нооруз')
    expect(other).toHaveValue('Нооруз')
    expect(screen.getByLabelText('Дата')).toHaveValue('05.10.2026')
  })

  it('a click on the page outside any field does not pull the focus back into the field (#68)', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Field initial="05.10.2026" />
        <p>Подпись</p>
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Открыть календарь' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByText('Подпись'))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await new Promise((r) => setTimeout(r, 200))
    expect(screen.getByLabelText('Дата')).not.toHaveFocus()
  })

  it('a click into the field itself closes the popover; «Закрыть» returns the focus to it', async () => {
    const user = userEvent.setup()
    render(<Field initial="05.10.2026" />)
    const input = screen.getByLabelText('Дата')
    const icon = screen.getByRole('button', { name: 'Открыть календарь' })
    await user.click(icon)
    await screen.findByRole('dialog')
    await user.click(input)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(input).toHaveFocus()
    await user.click(icon)
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Закрыть' }),
    )
    await waitFor(() => {
      expect(input).toHaveFocus()
    })
  })
})

describe('DatePickerButton (#64)', () => {
  it('a second click on the title closes the popover', async () => {
    setViewport(true)
    const user = userEvent.setup()
    render(
      <DatePickerButton value="2026-10-07" onSelect={vi.fn()} title="Перейти к неделе" week>
        5 – 11 октября
      </DatePickerButton>,
    )
    const title = screen.getByRole('button', { name: /5 – 11 октября/ })
    await user.click(title)
    const popover = await screen.findByRole('dialog', { name: 'Перейти к неделе' })
    // the whole week of the value is highlighted: Monday 5 – Sunday 11
    const week = popover.querySelectorAll('td.bg-stone')
    expect([...week].map((td) => td.textContent)).toEqual(['5', '6', '7', '8', '9', '10', '11'])
    // Chrome focuses the title on press, before the click: that focus must not dismiss the
    // popover first (the click would then reopen it)
    act(() => {
      title.focus()
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(title)
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(title)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('yearRange (#64)', () => {
  it('5 back and 2 ahead of today, widened to the value', () => {
    expect(yearRange('2026-10-14', null)).toEqual({ from: 2021, to: 2028 })
    expect(yearRange('2026-10-14', '2015-03-01')).toEqual({ from: 2015, to: 2028 })
    expect(yearRange('2026-10-14', '2031-01-01')).toEqual({ from: 2021, to: 2031 })
  })

  it('a typo year does not go below 1900 (#66)', () => {
    expect(yearRange('2026-10-14', '0202-01-01')).toEqual({ from: 1900, to: 2028 })
  })

  it('nor above 2100 (#68)', () => {
    expect(yearRange('2026-10-14', '9999-01-01')).toEqual({ from: 2021, to: 2100 })
  })
})
