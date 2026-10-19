import { describe, expect, it } from 'vitest'
import { deleteSubjectErrorMessage, deleteSubjectForm } from './api'

describe('deleteSubjectForm', () => {
  const id = '3f2b1c3e-8c1a-4b57-9b43-6d5a2a0e9c11'
  it('requires a reason and trims it', () => {
    expect(deleteSubjectForm.safeParse({ id, reason: '  ' }).error?.issues[0]?.message).toBe(
      'Укажите причину',
    )
    expect(deleteSubjectForm.parse({ id, reason: ' дубль ' }).reason).toBe('дубль')
  })
})

describe('deleteSubjectErrorMessage', () => {
  it('maps a subject used by groups', () => {
    expect(deleteSubjectErrorMessage({ code: '23503' })).toBe(
      'Предмет используется в группах — его можно только скрыть',
    )
    expect(deleteSubjectErrorMessage({ code: '42501' })).toBe('Предметы ведёт администратор')
  })
})
