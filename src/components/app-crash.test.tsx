import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetApp } from '@/lib/app-reset'
import { AppErrorBoundary } from './app-crash'

vi.mock('@/lib/app-reset', () => ({ resetApp: vi.fn(() => Promise.resolve()) }))

function Boom(): never {
  throw new Error('column groups.subject does not exist')
}

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the error screen instead of a blank page and resets the app on click', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Что-то пошло не так' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Обновить приложение' }))
    expect(resetApp).toHaveBeenCalledOnce()
  })

  it('renders children when nothing throws', () => {
    render(
      <AppErrorBoundary>
        <p>ok</p>
      </AppErrorBoundary>,
    )
    expect(screen.getByText('ok')).toBeInTheDocument()
  })
})
