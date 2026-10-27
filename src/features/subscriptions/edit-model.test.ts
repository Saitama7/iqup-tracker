import { describe, expect, it } from 'vitest'
import { balanceLine, payrollLine, termsCaption } from './edit-model'
import { withTransferPrice } from './exit-model'

describe('«Изменить абонемент» preview (#109)', () => {
  it('payroll: one mark 300 → 450, the month +150', () => {
    expect(
      payrollLine({
        teacherId: 't',
        teacherName: 'Жазгуль Т.',
        month: '2026-10-01',
        marks: 1,
        markBefore: 300,
        markAfter: 450,
        amountBefore: 2520,
        amountAfter: 2670,
      }),
    ).toBe('Жазгуль: октябрь 300 → 450 за занятие, +150 × 1 = +150 сом')
  })

  it('payroll: a bigger package lowers the pay', () => {
    expect(
      payrollLine({
        teacherId: 't',
        teacherName: 'Айпери',
        month: '2026-09-01',
        marks: 8,
        markBefore: 450,
        markAfter: 300,
        amountBefore: 5333,
        amountAfter: 4133,
      }),
    ).toBe('Айпери: сентябрь 450 → 300 за занятие, −150 × 8 = −1 200 сом')
  })

  it('balance: left or debt', () => {
    const b = {
      lessonsTotal: 12,
      priceFinal: 5400,
      paidSom: 5400,
      lessonsUsed: 10,
      lessonsLeft: 2,
      debtLessons: 0,
      debtSom: 0,
    }
    expect(balanceLine(b)).toBe('Оплачено 5 400 из 5 400 · остаток 2 урока')
    expect(balanceLine({ ...b, lessonsLeft: -2, debtLessons: 2, debtSom: 900 })).toBe(
      'Оплачено 5 400 из 5 400 · долг 2 урока · 900 сом',
    )
    expect(termsCaption(8, 7200)).toBe('8 уроков · 7 200')
  })

  it('transfer with the admin price: to pay and surplus from it', () => {
    const p = {
      startDate: '2026-10-27',
      wholeMove: false,
      lessonsTotal: 8,
      price: 7200,
      remainder: 3000,
      toPay: 4200,
      surplus: 0,
    }
    expect(withTransferPrice(p, null)).toBe(p)
    expect(withTransferPrice(p, 2000)).toMatchObject({ price: 2000, toPay: 0, surplus: 1000 })
    expect(withTransferPrice({ ...p, wholeMove: true }, 2000).price).toBe(7200)
  })
})
