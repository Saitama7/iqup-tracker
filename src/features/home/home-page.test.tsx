import { render, screen } from '@testing-library/react'
import { HomePage } from './home-page'

describe('HomePage', () => {
  it('renders title and brand button', () => {
    render(<HomePage />)
    expect(screen.getByRole('heading', { level: 1, name: 'IQ UP Tracker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Начать' })).toHaveClass('bg-brand')
  })
})
