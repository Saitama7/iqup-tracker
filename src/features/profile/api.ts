import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase/client'
import { bishkekDate } from '@/lib/time'

const profileSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  phone: z.string(),
})

const rateSchema = z.object({
  percent: z.number(),
  valid_from: z.string(),
})

export interface Profile {
  id: string
  fullName: string
  phone: string
}

export const profileQuery = (userId: string) =>
  queryOptions({
    queryKey: ['profile', userId],
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .eq('id', userId)
        .single()
      if (error) throw error
      const p = profileSchema.parse(data)
      return { id: p.id, fullName: p.full_name, phone: p.phone }
    },
    staleTime: 5 * 60_000,
  })

/** Rate in effect on `date` — the latest valid_from not after it. */
export function currentRate(
  rates: readonly { percent: number; valid_from: string }[],
  date: string,
): number | null {
  let best: { percent: number; valid_from: string } | null = null
  for (const r of rates) {
    if (r.valid_from <= date && (!best || r.valid_from > best.valid_from)) best = r
  }
  return best ? best.percent : null
}

// Teacher's own percent: RLS lets a teacher read only their teachers row and rates.
export const teacherPercentQuery = (userId: string, nowMs: number) => {
  const today = bishkekDate(nowMs)
  return queryOptions({
    queryKey: ['teacher-percent', userId, today],
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from('teachers')
        .select('teacher_rates(percent, valid_from)')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      return currentRate(z.array(rateSchema).parse(data.teacher_rates), today)
    },
  })
}

export const passwordSchema = z
  .object({
    password: z.string().min(8, 'Минимум 8 символов'),
    repeat: z.string(),
  })
  .refine((v) => v.password === v.repeat, {
    message: 'Пароли не совпадают',
    path: ['repeat'],
  })

export async function changePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}
