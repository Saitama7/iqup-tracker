import { describe, expect, it } from 'vitest'
import { calcMonth } from '@/features/payroll/calc'
import type { StudentRow } from '@/features/students/model'
import {
  conversionBySource,
  enrollStartDefault,
  fillCaption,
  isUpcoming,
  isWaiting,
  lessonOptionLabel,
  lessonTrials,
  markLabel,
  monthConversion,
  plusTrials,
  pupilsWord,
  shortPerson,
  studentsByPhone,
  trialDiscountHistory,
  trialStudentId,
  trialsCaption,
  trialsOn,
  trialsWord,
  trialWhen,
  upcomingRows,
  waitingTrials,
  weekStats,
  type Trial,
} from './model'

const TODAY = '2026-10-12' // Monday

let seq = 0
function trial(p: Partial<Trial> = {}): Trial {
  seq += 1
  return {
    id: `t${seq}`,
    student_id: null,
    full_name: `Ученик ${seq}`,
    grade: 8,
    parent_phone: '996555000001',
    group_id: 'g1',
    lesson_id: 'l1',
    status: 'scheduled',
    came: null,
    source: 'instagram',
    note: null,
    enrollment_id: null,
    created_at: '2026-10-01T10:00:00Z',
    marked_at: null,
    lessonDate: TODAY,
    lessonStart: '14:00',
    lessonStatus: 'planned',
    group: {
      id: 'g1',
      name: '8 класс Б',
      subject: 'Математика',
      status: 'active',
      teacherId: 'tc1',
      teacherName: 'Гульзат Асанова',
    },
    authorName: 'Каныкей',
    ...p,
  }
}

describe('words', () => {
  it('declines «пробный» and «ученик»', () => {
    expect([1, 2, 5, 11, 21, 22].map(trialsWord)).toEqual([
      '1 пробный',
      '2 пробных',
      '5 пробных',
      '11 пробных',
      '21 пробный',
      '22 пробных',
    ])
    expect([1, 3, 4, 5, 12].map(pupilsWord)).toEqual([
      '1 ученик',
      '3 ученика',
      '4 ученика',
      '5 учеников',
      '12 учеников',
    ])
    expect(plusTrials(0)).toBe('')
    expect(plusTrials(1)).toBe('+1 пробный')
  })

  it('shortens a name as on the artboards', () => {
    expect(shortPerson('Розаина Бекова')).toBe('Розаина Б.')
    expect(shortPerson('Нурай')).toBe('Нурай')
  })

  it('says when the trial is', () => {
    expect(trialWhen(TODAY, '14:00', TODAY)).toBe('Сегодня 14:00')
    expect(trialWhen('2026-10-13', '09:00', TODAY)).toBe('Завтра 09:00')
    expect(trialWhen('2026-10-11', '09:00', TODAY)).toBe('Вчера 09:00')
    expect(trialWhen('2026-10-19', '19:00', TODAY)).toBe('Пн 19 окт 19:00')
    expect(lessonOptionLabel(TODAY, '14:00', TODAY)).toBe('Пн 12 окт · 14:00 · сегодня')
    expect(lessonOptionLabel('2026-10-15', '14:00', TODAY)).toBe('Чт 15 окт · 14:00')
    expect(lessonOptionLabel('2026-10-11', '14:00', TODAY)).toBe('Вс 11 окт · 14:00 · вчера')
  })
})

describe('А11 lists', () => {
  it('upcoming: scheduled today or later, not cancelled', () => {
    expect(isUpcoming(trial(), TODAY)).toBe(true)
    expect(isUpcoming(trial({ lessonDate: '2026-10-11' }), TODAY)).toBe(false)
    expect(isUpcoming(trial({ lessonStatus: 'cancelled' }), TODAY)).toBe(false)
    expect(isUpcoming(trial({ status: 'attended' }), TODAY)).toBe(false)
  })

  it('waiting: marked, or the lesson passed / was cancelled without a mark', () => {
    expect(isWaiting(trial({ status: 'attended', came: true }), TODAY)).toBe(true)
    expect(isWaiting(trial({ status: 'no_show', came: false }), TODAY)).toBe(true)
    expect(isWaiting(trial({ lessonDate: '2026-10-10' }), TODAY)).toBe(true)
    expect(isWaiting(trial({ lessonStatus: 'cancelled' }), TODAY)).toBe(true)
    expect(isWaiting(trial(), TODAY)).toBe(false)
    expect(isWaiting(trial({ status: 'enrolled', came: true, enrollment_id: 'e' }), TODAY)).toBe(
      false,
    )
    expect(isWaiting(trial({ status: 'closed', came: false }), TODAY)).toBe(false)
  })

  it('folds a group booking into one row, «вся группа» for a forming group', () => {
    const forming = { ...trial().group, id: 'g2', status: 'forming' as const }
    const rows = upcomingRows(
      [
        trial({ lesson_id: 'l2', lessonDate: '2026-10-13', lessonStart: '09:00' }),
        trial({ lesson_id: 'l3', group_id: 'g2', group: forming, lessonDate: '2026-10-19' }),
        trial({ lesson_id: 'l3', group_id: 'g2', group: forming, lessonDate: '2026-10-19' }),
        trial({ lesson_id: 'l1' }),
        trial({ lesson_id: 'l1' }),
      ],
      TODAY,
    )
    expect(rows.map((r) => [r.lessonId, r.trials.length, r.wholeGroup])).toEqual([
      ['l1', 2, false],
      ['l2', 1, false],
      ['l3', 2, true],
    ])
  })

  it('waiting list: newest lesson first', () => {
    const a = trial({ status: 'attended', came: true, lessonDate: '2026-10-06' })
    const b = trial({ status: 'no_show', came: false, lessonDate: '2026-10-09' })
    expect(waitingTrials([a, b, trial()], TODAY).map((t) => t.id)).toEqual([b.id, a.id])
  })

  it('labels the teacher mark without gender (И1)', () => {
    expect(markLabel({ status: 'attended', came: true })).toBe('Был(а)')
    expect(markLabel({ status: 'no_show', came: false })).toBe('Не пришёл(ла)')
    expect(markLabel({ status: 'scheduled', came: null })).toBe('Не отмечен')
    expect(markLabel({ status: 'closed', came: false })).toBe('Не пришёл(ла)')
  })
})

describe('KPI and conversion', () => {
  it('counts the week Mon–Sun and whole forming groups', () => {
    const forming = { ...trial().group, id: 'g2', status: 'forming' as const }
    const stats = weekStats(
      [
        trial({ lessonDate: '2026-10-12' }),
        trial({ lessonDate: '2026-10-18', group_id: 'g3', lesson_id: 'l9' }),
        trial({ lesson_id: 'l5', group_id: 'g2', group: forming, lessonDate: '2026-10-14' }),
        trial({ lesson_id: 'l5', group_id: 'g2', group: forming, lessonDate: '2026-10-14' }),
        trial({ lessonDate: '2026-10-19' }), // next week
        trial({ status: 'closed', lessonDate: '2026-10-13' }),
      ],
      '2026-10-15',
    )
    expect(stats).toEqual({ trials: 4, groups: 3, wholeGroups: 1 })
  })

  it('records → came → paid of the month, by source', () => {
    const list = [
      trial({ lessonDate: '2026-09-05', status: 'enrolled', came: true, enrollment_id: 'e1' }),
      trial({ lessonDate: '2026-09-06', status: 'closed', came: true }),
      trial({ lessonDate: '2026-09-07', status: 'closed', came: false, source: 'referral' }),
      trial({ lessonDate: '2026-09-08', status: 'attended', came: true, source: 'referral' }),
      trial({ lessonDate: '2026-10-01', status: 'enrolled', came: true, enrollment_id: 'e2' }),
    ]
    expect(monthConversion(list, '2026-09-01')).toEqual({
      booked: 4,
      came: 3,
      paid: 1,
      percent: 33,
    })
    expect(monthConversion([], '2026-09-01').percent).toBeNull()
    expect(conversionBySource(list, '2026-09-01')).toEqual([
      { source: 'instagram', conversion: { booked: 2, came: 2, paid: 1, percent: 50 } },
      { source: 'referral', conversion: { booked: 2, came: 1, paid: 0, percent: 0 } },
    ])
  })
})

describe('teacher and group screens', () => {
  it('lists the lesson trials and the day trials, without closed ones', () => {
    const a = trial({ full_name: 'Розаина Бекова' })
    const b = trial({ full_name: 'Адема Кадырова' })
    const c = trial({ status: 'closed' })
    const d = trial({ lesson_id: 'l2', lessonDate: '2026-10-13' })
    expect(lessonTrials([a, b, c, d], 'l1').map((t) => t.full_name)).toEqual([
      'Адема Кадырова',
      'Розаина Бекова',
    ])
    expect(trialsOn([a, b, c, d], '2026-10-13')).toEqual([d])
    expect(trialsCaption([a])).toBe('+1 пробный · Розаина')
    expect(trialsCaption([a, b])).toBe('+2 пробных')
  })

  it('Ж2: group fill never includes trials', () => {
    expect(fillCaption(8, 10, 2)).toEqual({ fill: '8 / 10', trials: '+ 2 пробных' })
    expect(fillCaption(8, 10, 0)).toEqual({ fill: '8 / 10', trials: null })
  })

  it('Ж2/Ж6: a trial is not a student-lesson — payroll sees only attendance', () => {
    // calcMonth takes lessons with attendance; trials are a separate table and never become marks
    // (case 16: a held lesson with only trials pays 0).
    const withTrialOnly = calcMonth(
      [
        {
          id: 'l1',
          group_id: 'g1',
          lesson_date: '2026-10-12',
          duration_min: 60,
          status: 'held',
          attendance: [],
        },
      ],
      [{ percent: 45, valid_from: '2026-09-01' }],
    )
    expect(withTrialOnly.amount).toBe(0)
    expect(withTrialOnly.studentLessons).toBe(0)
  })

  it('Ж5: the subscription starts on the group lesson after the trial', () => {
    const lessons = [{ date: '2026-10-10' }, { date: '2026-10-13' }, { date: '2026-10-15' }]
    // trial today → next lesson
    expect(enrollStartDefault('2026-10-10', lessons, '2026-10-10')).toBe('2026-10-13')
    // trial last week, paid today → next lesson from today on
    expect(enrollStartDefault('2026-10-06', lessons, '2026-10-12')).toBe('2026-10-13')
    // no lessons known → the day after the trial / today
    expect(enrollStartDefault('2026-10-12', [], '2026-10-12')).toBe('2026-10-13')
    expect(enrollStartDefault('2026-10-06', [], '2026-10-12')).toBe('2026-10-12')
  })
})

describe('the student a trial becomes (#54)', () => {
  const student = (p: Partial<StudentRow>): StudentRow => ({
    id: 's',
    full_name: 'Нурай Жумабаева',
    grade: 8,
    parent_name: null,
    parent_phone: '996555005401',
    is_returning: false,
    referred_by_student_id: null,
    notes: null,
    created_at: '2026-09-01T00:00:00Z',
    enrollments: [],
    ...p,
  })
  const former = student({ id: 'former', is_returning: true })
  const sibling = student({ id: 'sibling', full_name: 'Айбек Жумабаев' })
  const friend = student({ id: 'friend', full_name: 'Друг', referred_by_student_id: 'former' })
  const students = [former, sibling, friend]
  const lead = { student_id: null, full_name: ' нурай жумабаева ', parent_phone: '996555005401' }

  it('a lead with the same name and phone is the existing student, a sibling is not', () => {
    expect(trialStudentId(lead, students)).toBe('former')
    expect(trialStudentId({ ...lead, full_name: 'Айсулуу' }, students)).toBeNull()
    expect(trialStudentId({ ...lead, parent_phone: null }, students)).toBeNull()
    expect(trialStudentId({ ...lead, student_id: 'sibling' }, students)).toBe('sibling')
    // two students with the same name and phone: ambiguous → enroll_trial refuses, no history
    expect(trialStudentId(lead, [...students, student({ id: 'twin' })])).toBeNull()
  })

  it('discount history follows that student (В5)', () => {
    const source = { students, groups: [] }
    expect(trialDiscountHistory(source, lead)).toEqual({
      isReturning: true,
      subscriptions: [],
      friendsBrought: 1,
    })
    expect(trialDiscountHistory(source, { ...lead, full_name: 'Новый' })).toBeUndefined()
    expect(trialDiscountHistory(undefined, lead)).toBeUndefined()
  })

  it('students by parent phone for the booking hint', () => {
    expect(studentsByPhone(students, '996555005401').map((s) => s.id)).toEqual([
      'former',
      'sibling',
      'friend',
    ])
    expect(studentsByPhone(students, '996555000000')).toEqual([])
    expect(studentsByPhone(students, null)).toEqual([])
  })
})
