export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      attendance: {
        Row: {
          consumes_credit: boolean | null
          id: string
          lesson_id: string
          marked_at: string
          marked_by: string | null
          status: Database['public']['Enums']['attendance_status']
          student_id: string
          subscription_id: string | null
        }
        ComputedFields: never
        Insert: {
          consumes_credit?: never
          id?: string
          lesson_id: string
          marked_at?: string
          marked_by?: string | null
          status: Database['public']['Enums']['attendance_status']
          student_id: string
          subscription_id?: string | null
        }
        Update: {
          consumes_credit?: never
          id?: string
          lesson_id?: string
          marked_at?: string
          marked_by?: string | null
          status?: Database['public']['Enums']['attendance_status']
          student_id?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'attendance_lesson_id_fkey'
            columns: ['lesson_id']
            isOneToOne: false
            referencedRelation: 'lessons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_lesson_id_fkey'
            columns: ['lesson_id']
            isOneToOne: false
            referencedRelation: 'v_lesson_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_marked_by_fkey'
            columns: ['marked_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_student_id_fkey'
            columns: ['student_id']
            isOneToOne: false
            referencedRelation: 'students'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_subscription_id_fkey'
            columns: ['subscription_id']
            isOneToOne: false
            referencedRelation: 'subscriptions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_subscription_id_fkey'
            columns: ['subscription_id']
            isOneToOne: false
            referencedRelation: 'v_student_balance'
            referencedColumns: ['subscription_id']
          },
          {
            foreignKeyName: 'attendance_subscription_id_fkey'
            columns: ['subscription_id']
            isOneToOne: false
            referencedRelation: 'v_subscription_balances'
            referencedColumns: ['subscription_id']
          },
        ]
      }
      attendance_correction_requests: {
        Row: {
          comment: string
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_comment: string | null
          id: string
          lesson_id: string
          marks: NonNullable<Json>
          status: string
          teacher_id: string
        }
        ComputedFields: never
        Insert: {
          comment: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_comment?: string | null
          id?: string
          lesson_id: string
          marks: NonNullable<Json>
          status?: string
          teacher_id?: string
        }
        Update: {
          comment?: string
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_comment?: string | null
          id?: string
          lesson_id?: string
          marks?: NonNullable<Json>
          status?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'attendance_correction_requests_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_correction_requests_decided_by_fkey'
            columns: ['decided_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_correction_requests_lesson_id_fkey'
            columns: ['lesson_id']
            isOneToOne: false
            referencedRelation: 'lessons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_correction_requests_lesson_id_fkey'
            columns: ['lesson_id']
            isOneToOne: false
            referencedRelation: 'v_lesson_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_correction_requests_teacher_id_fkey'
            columns: ['teacher_id']
            isOneToOne: false
            referencedRelation: 'teachers'
            referencedColumns: ['id']
          },
        ]
      }
      attendance_presets: {
        Row: {
          comment: string | null
          created_at: string
          created_by: string | null
          id: string
          lesson_id: string
          status: Database['public']['Enums']['attendance_status']
          student_id: string
        }
        ComputedFields: never
        Insert: {
          comment?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lesson_id: string
          status?: Database['public']['Enums']['attendance_status']
          student_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lesson_id?: string
          status?: Database['public']['Enums']['attendance_status']
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'attendance_presets_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_presets_lesson_id_fkey'
            columns: ['lesson_id']
            isOneToOne: false
            referencedRelation: 'lessons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_presets_lesson_id_fkey'
            columns: ['lesson_id']
            isOneToOne: false
            referencedRelation: 'v_lesson_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_presets_student_id_fkey'
            columns: ['student_id']
            isOneToOne: false
            referencedRelation: 'students'
            referencedColumns: ['id']
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          at: string
          before: Json | null
          entity: string
          entity_id: string
          id: string
          kind: string | null
          reason: string | null
        }
        ComputedFields: never
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity: string
          entity_id: string
          id?: string
          kind?: never
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity?: string
          entity_id?: string
          id?: string
          kind?: never
          reason?: string | null
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          created_at: string
          end_date: string | null
          group_id: string
          id: string
          start_date: string
          status: Database['public']['Enums']['enrollment_status']
          student_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          end_date?: string | null
          group_id: string
          id?: string
          start_date: string
          status?: Database['public']['Enums']['enrollment_status']
          student_id: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          group_id?: string
          id?: string
          start_date?: string
          status?: Database['public']['Enums']['enrollment_status']
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'enrollments_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'enrollments_student_id_fkey'
            columns: ['student_id']
            isOneToOne: false
            referencedRelation: 'students'
            referencedColumns: ['id']
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          end_date: string | null
          grade: number | null
          group_type: Database['public']['Enums']['group_type']
          id: string
          name: string
          room: string | null
          start_date: string
          status: Database['public']['Enums']['group_status']
          subject_id: string
          teacher_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          end_date?: string | null
          grade?: number | null
          group_type: Database['public']['Enums']['group_type']
          id?: string
          name: string
          room?: string | null
          start_date: string
          status?: Database['public']['Enums']['group_status']
          subject_id: string
          teacher_id: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          grade?: number | null
          group_type?: Database['public']['Enums']['group_type']
          id?: string
          name?: string
          room?: string | null
          start_date?: string
          status?: Database['public']['Enums']['group_status']
          subject_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'groups_subject_id_fkey'
            columns: ['subject_id']
            isOneToOne: false
            referencedRelation: 'subjects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'groups_teacher_id_fkey'
            columns: ['teacher_id']
            isOneToOne: false
            referencedRelation: 'teachers'
            referencedColumns: ['id']
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          day: string
          name: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          day: string
          name: string
        }
        Update: {
          created_at?: string
          day?: string
          name?: string
        }
        Relationships: []
      }
      lessons: {
        Row: {
          cancel_reason: Database['public']['Enums']['cancel_reason'] | null
          comment: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_late: boolean
          created_at: string
          duration_min: number
          group_id: string
          id: string
          is_extra: boolean
          is_locked: boolean
          lesson_date: string
          makes_up_for_lesson_id: string | null
          planned_start: string
          status: Database['public']['Enums']['lesson_status']
          substitute_teacher_id: string | null
          teacher_id: string
        }
        ComputedFields: never
        Insert: {
          cancel_reason?: Database['public']['Enums']['cancel_reason'] | null
          comment?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_late?: boolean
          created_at?: string
          duration_min: number
          group_id: string
          id?: string
          is_extra?: boolean
          is_locked?: boolean
          lesson_date: string
          makes_up_for_lesson_id?: string | null
          planned_start: string
          status?: Database['public']['Enums']['lesson_status']
          substitute_teacher_id?: string | null
          teacher_id: string
        }
        Update: {
          cancel_reason?: Database['public']['Enums']['cancel_reason'] | null
          comment?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_late?: boolean
          created_at?: string
          duration_min?: number
          group_id?: string
          id?: string
          is_extra?: boolean
          is_locked?: boolean
          lesson_date?: string
          makes_up_for_lesson_id?: string | null
          planned_start?: string
          status?: Database['public']['Enums']['lesson_status']
          substitute_teacher_id?: string | null
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lessons_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lessons_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lessons_makes_up_for_lesson_id_fkey'
            columns: ['makes_up_for_lesson_id']
            isOneToOne: false
            referencedRelation: 'lessons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lessons_makes_up_for_lesson_id_fkey'
            columns: ['makes_up_for_lesson_id']
            isOneToOne: false
            referencedRelation: 'v_lesson_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lessons_substitute_teacher_id_fkey'
            columns: ['substitute_teacher_id']
            isOneToOne: false
            referencedRelation: 'teachers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lessons_teacher_id_fkey'
            columns: ['teacher_id']
            isOneToOne: false
            referencedRelation: 'teachers'
            referencedColumns: ['id']
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          kind: Database['public']['Enums']['payment_kind']
          method: Database['public']['Enums']['payment_method'] | null
          paid_at: string
          reason: string | null
          subscription_id: string
          transfer_id: string | null
        }
        ComputedFields: never
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database['public']['Enums']['payment_kind']
          method?: Database['public']['Enums']['payment_method'] | null
          paid_at?: string
          reason?: string | null
          subscription_id: string
          transfer_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database['public']['Enums']['payment_kind']
          method?: Database['public']['Enums']['payment_method'] | null
          paid_at?: string
          reason?: string | null
          subscription_id?: string
          transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'payments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payments_subscription_id_fkey'
            columns: ['subscription_id']
            isOneToOne: false
            referencedRelation: 'subscriptions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payments_subscription_id_fkey'
            columns: ['subscription_id']
            isOneToOne: false
            referencedRelation: 'v_student_balance'
            referencedColumns: ['subscription_id']
          },
          {
            foreignKeyName: 'payments_subscription_id_fkey'
            columns: ['subscription_id']
            isOneToOne: false
            referencedRelation: 'v_subscription_balances'
            referencedColumns: ['subscription_id']
          },
        ]
      }
      payroll_adjustments: {
        Row: {
          amount: number
          comment: string | null
          created_at: string
          created_by: string | null
          id: string
          issued_on: string
          kind: Database['public']['Enums']['payroll_adjustment_kind']
          month: string
          teacher_id: string
        }
        ComputedFields: never
        Insert: {
          amount: number
          comment?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          issued_on: string
          kind?: Database['public']['Enums']['payroll_adjustment_kind']
          month: string
          teacher_id: string
        }
        Update: {
          amount?: number
          comment?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          issued_on?: string
          kind?: Database['public']['Enums']['payroll_adjustment_kind']
          month?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'payroll_adjustments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payroll_adjustments_teacher_id_fkey'
            columns: ['teacher_id']
            isOneToOne: false
            referencedRelation: 'teachers'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          phone: string
          roles: Database['public']['Enums']['role'][]
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          phone: string
          roles?: Database['public']['Enums']['role'][]
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string
          roles?: Database['public']['Enums']['role'][]
        }
        Relationships: []
      }
      schedule_rules: {
        Row: {
          created_at: string
          group_id: string
          id: string
          start_time: string
          valid_from: string
          valid_to: string | null
          weekday: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          start_time: string
          valid_from: string
          valid_to?: string | null
          weekday: number
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          start_time?: string
          valid_from?: string
          valid_to?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: 'schedule_rules_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
        ]
      }
      students: {
        Row: {
          created_at: string
          full_name: string
          grade: number | null
          id: string
          is_returning: boolean
          notes: string | null
          parent_name: string | null
          parent_phone: string | null
          referred_by_student_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          full_name: string
          grade?: number | null
          id?: string
          is_returning?: boolean
          notes?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          referred_by_student_id?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          grade?: number | null
          id?: string
          is_returning?: boolean
          notes?: string | null
          parent_name?: string | null
          parent_phone?: string | null
          referred_by_student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'students_referred_by_student_id_fkey'
            columns: ['referred_by_student_id']
            isOneToOne: false
            referencedRelation: 'students'
            referencedColumns: ['id']
          },
        ]
      }
      subjects: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          discount_percent: number
          discount_reason: Database['public']['Enums']['discount_reason']
          enrollment_id: string
          id: string
          lessons_total: number
          price_final: number
          price_full: number
          started_at: string
          status: Database['public']['Enums']['subscription_status']
          tariff_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          discount_percent?: number
          discount_reason?: Database['public']['Enums']['discount_reason']
          enrollment_id: string
          id?: string
          lessons_total: number
          price_final: number
          price_full: number
          started_at: string
          status?: Database['public']['Enums']['subscription_status']
          tariff_id: string
        }
        Update: {
          created_at?: string
          discount_percent?: number
          discount_reason?: Database['public']['Enums']['discount_reason']
          enrollment_id?: string
          id?: string
          lessons_total?: number
          price_final?: number
          price_full?: number
          started_at?: string
          status?: Database['public']['Enums']['subscription_status']
          tariff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'subscriptions_enrollment_id_fkey'
            columns: ['enrollment_id']
            isOneToOne: false
            referencedRelation: 'enrollments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'subscriptions_tariff_id_fkey'
            columns: ['tariff_id']
            isOneToOne: false
            referencedRelation: 'tariffs'
            referencedColumns: ['id']
          },
        ]
      }
      tariffs: {
        Row: {
          created_at: string
          created_by: string | null
          freeze_limit: number
          group_type: Database['public']['Enums']['group_type']
          id: string
          lesson_duration_min: number
          lessons_in_package: number
          max_students: number
          package_price: number
          valid_from: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          freeze_limit?: number
          group_type: Database['public']['Enums']['group_type']
          id?: string
          lesson_duration_min: number
          lessons_in_package: number
          max_students: number
          package_price: number
          valid_from: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          freeze_limit?: number
          group_type?: Database['public']['Enums']['group_type']
          id?: string
          lesson_duration_min?: number
          lessons_in_package?: number
          max_students?: number
          package_price?: number
          valid_from?: string
        }
        Relationships: []
      }
      teacher_rates: {
        Row: {
          created_at: string
          id: string
          percent: number
          teacher_id: string
          valid_from: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          percent: number
          teacher_id: string
          valid_from: string
        }
        Update: {
          created_at?: string
          id?: string
          percent?: number
          teacher_id?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: 'teacher_rates_teacher_id_fkey'
            columns: ['teacher_id']
            isOneToOne: false
            referencedRelation: 'teachers'
            referencedColumns: ['id']
          },
        ]
      }
      teachers: {
        Row: {
          created_at: string
          full_name: string
          id: string
          phone: string | null
          user_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          phone?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'teachers_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      trials: {
        Row: {
          came: boolean | null
          created_at: string
          created_by: string | null
          enrollment_id: string | null
          full_name: string
          grade: number | null
          group_id: string
          id: string
          lesson_id: string
          marked_at: string | null
          marked_by: string | null
          note: string | null
          parent_phone: string | null
          referred_by_student_id: string | null
          source: Database['public']['Enums']['trial_source'] | null
          status: Database['public']['Enums']['trial_status']
          student_id: string | null
        }
        ComputedFields: never
        Insert: {
          came?: boolean | null
          created_at?: string
          created_by?: string | null
          enrollment_id?: string | null
          full_name: string
          grade?: number | null
          group_id: string
          id?: string
          lesson_id: string
          marked_at?: string | null
          marked_by?: string | null
          note?: string | null
          parent_phone?: string | null
          referred_by_student_id?: string | null
          source?: Database['public']['Enums']['trial_source'] | null
          status?: Database['public']['Enums']['trial_status']
          student_id?: string | null
        }
        Update: {
          came?: boolean | null
          created_at?: string
          created_by?: string | null
          enrollment_id?: string | null
          full_name?: string
          grade?: number | null
          group_id?: string
          id?: string
          lesson_id?: string
          marked_at?: string | null
          marked_by?: string | null
          note?: string | null
          parent_phone?: string | null
          referred_by_student_id?: string | null
          source?: Database['public']['Enums']['trial_source'] | null
          status?: Database['public']['Enums']['trial_status']
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'trials_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trials_enrollment_id_fkey'
            columns: ['enrollment_id']
            isOneToOne: false
            referencedRelation: 'enrollments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trials_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trials_lesson_id_fkey'
            columns: ['lesson_id']
            isOneToOne: false
            referencedRelation: 'lessons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trials_lesson_id_fkey'
            columns: ['lesson_id']
            isOneToOne: false
            referencedRelation: 'v_lesson_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trials_marked_by_fkey'
            columns: ['marked_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trials_referred_by_student_id_fkey'
            columns: ['referred_by_student_id']
            isOneToOne: false
            referencedRelation: 'students'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'trials_student_id_fkey'
            columns: ['student_id']
            isOneToOne: false
            referencedRelation: 'students'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      v_audit_feed: {
        Row: {
          action: string | null
          actor_id: string | null
          after: Json | null
          at: string | null
          before: Json | null
          entity: string | null
          entity_id: string | null
          id: string | null
          kind: string | null
          marks: Json | null
          reason: string | null
          search: string | null
        }
        ComputedFields: never
        Insert: {
          action?: string | null
          actor_id?: string | null
          after?: Json | null
          at?: string | null
          before?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string | null
          kind?: string | null
          marks?: never
          reason?: string | null
          search?: never
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          after?: Json | null
          at?: string | null
          before?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string | null
          kind?: string | null
          marks?: never
          reason?: string | null
          search?: never
        }
        Relationships: []
      }
      v_lesson_status: {
        Row: {
          cancel_reason: Database['public']['Enums']['cancel_reason'] | null
          comment: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_late: boolean | null
          created_at: string | null
          duration_min: number | null
          effective_status: string | null
          group_id: string | null
          id: string | null
          is_extra: boolean | null
          is_locked: boolean | null
          lesson_date: string | null
          makes_up_for_lesson_id: string | null
          planned_start: string | null
          status: Database['public']['Enums']['lesson_status'] | null
          substitute_teacher_id: string | null
          teacher_id: string | null
        }
        ComputedFields: never
        Insert: {
          cancel_reason?: Database['public']['Enums']['cancel_reason'] | null
          comment?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_late?: boolean | null
          created_at?: string | null
          duration_min?: number | null
          effective_status?: never
          group_id?: string | null
          id?: string | null
          is_extra?: boolean | null
          is_locked?: boolean | null
          lesson_date?: string | null
          makes_up_for_lesson_id?: string | null
          planned_start?: string | null
          status?: Database['public']['Enums']['lesson_status'] | null
          substitute_teacher_id?: string | null
          teacher_id?: string | null
        }
        Update: {
          cancel_reason?: Database['public']['Enums']['cancel_reason'] | null
          comment?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_late?: boolean | null
          created_at?: string | null
          duration_min?: number | null
          effective_status?: never
          group_id?: string | null
          id?: string | null
          is_extra?: boolean | null
          is_locked?: boolean | null
          lesson_date?: string | null
          makes_up_for_lesson_id?: string | null
          planned_start?: string | null
          status?: Database['public']['Enums']['lesson_status'] | null
          substitute_teacher_id?: string | null
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'lessons_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lessons_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lessons_makes_up_for_lesson_id_fkey'
            columns: ['makes_up_for_lesson_id']
            isOneToOne: false
            referencedRelation: 'lessons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lessons_makes_up_for_lesson_id_fkey'
            columns: ['makes_up_for_lesson_id']
            isOneToOne: false
            referencedRelation: 'v_lesson_status'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lessons_substitute_teacher_id_fkey'
            columns: ['substitute_teacher_id']
            isOneToOne: false
            referencedRelation: 'teachers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'lessons_teacher_id_fkey'
            columns: ['teacher_id']
            isOneToOne: false
            referencedRelation: 'teachers'
            referencedColumns: ['id']
          },
        ]
      }
      v_payroll_preview: {
        Row: {
          advances: number | null
          base_amount: number | null
          hours: number | null
          lessons_held: number | null
          month: string | null
          no_subscription: number | null
          student_lessons: number | null
          teacher_id: string | null
          to_pay: number | null
        }
        ComputedFields: never
        Relationships: []
      }
      v_student_balance: {
        Row: {
          carried_in: number | null
          debt_lessons: number | null
          debt_som: number | null
          enrollment_id: string | null
          freeze_limit: number | null
          freezes_used: number | null
          group_id: string | null
          is_current: boolean | null
          lessons_left: number | null
          lessons_total: number | null
          lessons_used: number | null
          paid_lessons: number | null
          paid_som: number | null
          price_final: number | null
          price_full: number | null
          refund_suggested: number | null
          started_at: string | null
          status: Database['public']['Enums']['subscription_status'] | null
          student_id: string | null
          subscription_id: string | null
          used_own: number | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: 'enrollments_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'enrollments_student_id_fkey'
            columns: ['student_id']
            isOneToOne: false
            referencedRelation: 'students'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'subscriptions_enrollment_id_fkey'
            columns: ['enrollment_id']
            isOneToOne: false
            referencedRelation: 'enrollments'
            referencedColumns: ['id']
          },
        ]
      }
      v_subscription_balances: {
        Row: {
          enrollment_id: string | null
          freeze_limit: number | null
          freezes_used: number | null
          group_id: string | null
          lessons_left: number | null
          lessons_total: number | null
          lessons_used: number | null
          status: Database['public']['Enums']['subscription_status'] | null
          student_id: string | null
          subscription_id: string | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: 'enrollments_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'enrollments_student_id_fkey'
            columns: ['student_id']
            isOneToOne: false
            referencedRelation: 'students'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'subscriptions_enrollment_id_fkey'
            columns: ['enrollment_id']
            isOneToOne: false
            referencedRelation: 'enrollments'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Functions: {
      apply_correction_request: { Args: { p_request_id: string }; Returns: number }
      archive_group: { Args: { p_group_id: string }; Returns: number }
      assert_admin: { Args: Record<PropertyKey, never>; Returns: undefined }
      assert_correction_marks: { Args: { p_lesson_id: string; p_marks: Json }; Returns: undefined }
      assert_enrollment_undoable: { Args: { p_enrollment_id: string }; Returns: undefined }
      assert_payment_admin: { Args: Record<PropertyKey, never>; Returns: undefined }
      assert_payroll_staff: { Args: Record<PropertyKey, never>; Returns: undefined }
      attendance_subscription: {
        Args: { p_lesson_id: string; p_student_id: string }
        Returns: string
      }
      audit_feed_counts: {
        Args: {
          p_actor?: string
          p_entity?: string
          p_q?: string
          p_since?: string
          p_system?: boolean
        }
        Returns: {
          kind: string
          n: number
        }[]
      }
      audit_kind: {
        Args: { p_action: string; p_after: Json; p_at: string; p_before: Json; p_entity: string }
        Returns: string
      }
      audit_search_text: {
        Args: { p_entity: string; p_entity_id: string; p_row: Json }
        Returns: string
      }
      bishkek_today: { Args: Record<PropertyKey, never>; Returns: string }
      buy_subscription: {
        Args: {
          p_amount: number
          p_comment?: string
          p_discount_pct?: number
          p_discount_reason?: Database['public']['Enums']['discount_reason']
          p_enrollment_id: string
          p_method: Database['public']['Enums']['payment_method']
          p_paid_on?: string
        }
        Returns: {
          payment_id: string
          subscription_id: string
        }[]
      }
      cancel_lesson: {
        Args: {
          p_comment?: string
          p_lesson_id: string
          p_reason: Database['public']['Enums']['cancel_reason']
        }
        Returns: undefined
      }
      change_group_teacher: {
        Args: { p_from?: string; p_group_id: string; p_teacher_id: string }
        Returns: {
          lessons_held: number
          lessons_moved: number
        }[]
      }
      change_group_teacher_preview: {
        Args: { p_from?: string; p_group_id: string; p_teacher_id: string }
        Returns: {
          lessons_held: number
          lessons_locked: number
          lessons_total: number
        }[]
      }
      clear_attendance_preset: {
        Args: { p_lesson_id: string; p_student_id: string }
        Returns: boolean
      }
      confirm_lesson: { Args: { p_lesson_id: string; p_marks: Json }; Returns: string }
      correct_attendance: {
        Args: { p_lesson_id: string; p_marks: Json; p_reason: string }
        Returns: number
      }
      create_extra_lesson: {
        Args: { p_date: string; p_group_id: string; p_makes_up_for?: string; p_start: string }
        Returns: string
      }
      create_group: {
        Args: {
          p_grade: number
          p_group_type: Database['public']['Enums']['group_type']
          p_name: string
          p_room: string
          p_start_date: string
          p_start_time: string
          p_subject_id: string
          p_teacher_id: string
          p_until: string
          p_weekdays: number[]
        }
        Returns: {
          group_id: string
          lessons_created: number
        }[]
      }
      current_roles: {
        Args: Record<PropertyKey, never>
        Returns: Database['public']['Enums']['role'][]
      }
      current_teacher_id: { Args: Record<PropertyKey, never>; Returns: string }
      delete_enrollment: {
        Args: {
          p_enrollment_id: string
          p_group_id?: string
          p_method?: Database['public']['Enums']['payment_method']
          p_money?: string
          p_paid_on?: string
          p_start_date?: string
        }
        Returns: {
          kept: boolean
          marks_deleted: number
          money: number
        }[]
      }
      delete_group: { Args: { p_group_id: string }; Returns: number }
      delete_payroll_adjustment: { Args: { p_id: string; p_reason: string }; Returns: undefined }
      enroll_student: {
        Args: {
          p_discount_pct?: number
          p_discount_reason?: Database['public']['Enums']['discount_reason']
          p_group_id: string
          p_start_date: string
          p_student_id: string
        }
        Returns: {
          enrollment_id: string
          subscription_id: string
        }[]
      }
      enroll_trial: {
        Args: {
          p_discount_pct?: number
          p_discount_reason?: Database['public']['Enums']['discount_reason']
          p_start_date: string
          p_trial_id: string
        }
        Returns: {
          enrollment_id: string
          student_id: string
          subscription_id: string
        }[]
      }
      enrollment_attendance: {
        Args: { p_enrollment_id: string }
        Returns: {
          consumes_credit: boolean | null
          id: string
          lesson_id: string
          marked_at: string
          marked_by: string | null
          status: Database['public']['Enums']['attendance_status']
          student_id: string
          subscription_id: string | null
        }[]
        SetofOptions: {
          from: '*'
          to: 'attendance'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enrollment_payroll_impact: {
        Args: { p_enrollment_id: string }
        Returns: {
          amount: number
          lessons: number
          teacher_id: string
          teacher_name: string
        }[]
      }
      enrollment_settlement: {
        Args: { p_enrollment_id: string }
        Returns: {
          burned_marks: number
          frozen_marks: number
          has_trial: boolean
          last_mark_date: string
          lesson_price: number
          lessons_used: number
          locked_marks: number
          money_som: number
          paid_som: number
          payments: number
          present_marks: number
          remainder: number
          used_som: number
        }[]
      }
      enrollment_undo_info: {
        Args: { p_enrollment_id: string }
        Returns: {
          burned_marks: number
          frozen_marks: number
          locked_marks: number
          paid_total: number
          payments: number
          present_marks: number
          subscriptions: number
          trial_id: string
        }[]
      }
      ensure_lessons: { Args: { p_until: string }; Returns: number }
      generate_lessons: { Args: { p_group_id: string; p_until: string }; Returns: number }
      group_delete_blockers: { Args: { p_group_id: string }; Returns: string[] }
      group_title: { Args: { p_group_id: string }; Returns: string }
      is_accountant: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_staff: { Args: Record<PropertyKey, never>; Returns: boolean }
      issue_advance: {
        Args: {
          p_amount: number
          p_comment?: string
          p_issued_on?: string
          p_month?: string
          p_teacher_id: string
        }
        Returns: string
      }
      leads_group: { Args: { p_group_id: string }; Returns: boolean }
      lesson_starts_at: { Args: { p_date: string; p_start: string }; Returns: string }
      payment_time: { Args: { p_paid_on: string }; Returns: string }
      payroll_month_locked: { Args: { p_month: string; p_teacher_id: string }; Returns: boolean }
      person_name_key: { Args: { p_name: string }; Returns: string }
      record_payment: {
        Args: {
          p_amount: number
          p_comment?: string
          p_method: Database['public']['Enums']['payment_method']
          p_paid_on?: string
          p_subscription_id: string
        }
        Returns: string
      }
      refund_subscription: {
        Args: {
          p_amount: number
          p_method: Database['public']['Enums']['payment_method']
          p_paid_on?: string
          p_reason: string
          p_subscription_id: string
        }
        Returns: string
      }
      reject_correction_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      remove_enrollment: {
        Args: { p_enrollment_id: string }
        Returns: {
          marks_deleted: number
          subscriptions_deleted: number
        }[]
      }
      reschedule_group: {
        Args: {
          p_group_id: string
          p_start_time: string
          p_until: string
          p_valid_from: string
          p_weekdays: number[]
        }
        Returns: {
          lessons_created: number
          lessons_deleted: number
        }[]
      }
      server_now: { Args: Record<PropertyKey, never>; Returns: string }
      set_attendance_preset: {
        Args: { p_comment?: string; p_lesson_id: string; p_student_id: string }
        Returns: string
      }
      set_enrollment_start: {
        Args: { p_enrollment_id: string; p_start_date: string }
        Returns: undefined
      }
      set_group_start: {
        Args: { p_group_id: string; p_start_date: string }
        Returns: {
          lessons_created: number
          lessons_deleted: number
        }[]
      }
      subscription_settlement: {
        Args: { p_enrollment_id: string }
        Returns: {
          created_at: string
          lessons_used: number
          paid_som: number
          remainder: number
          started_at: string
          subscription_id: string
          used_som: number
        }[]
      }
      tariff_duration: {
        Args: { p_date: string; p_group_type: Database['public']['Enums']['group_type'] }
        Returns: number
      }
      tariff_min_valid_from: {
        Args: { p_group_type: Database['public']['Enums']['group_type'] }
        Returns: string
      }
      teaches_enrollment: { Args: { p_enrollment_id: string }; Returns: boolean }
      teaches_group: { Args: { p_group_id: string }; Returns: boolean }
      teaches_lesson: { Args: { p_lesson_id: string }; Returns: boolean }
      teaches_student: { Args: { p_student_id: string }; Returns: boolean }
      teaches_subscription: { Args: { p_subscription_id: string }; Returns: boolean }
      transfer_default_start: {
        Args: { p_enrollment_id: string; p_group_id: string }
        Returns: string
      }
      transfer_enrollment: {
        Args: { p_enrollment_id: string; p_group_id: string; p_start_date?: string }
        Returns: string
      }
      transfer_preview: {
        Args: { p_enrollment_id: string; p_group_id: string; p_start_date?: string }
        Returns: {
          lessons_total: number
          price: number
          remainder: number
          start_date: string
          surplus: number
          to_pay: number
          whole_move: boolean
        }[]
      }
      transfer_student: {
        Args: {
          p_enrollment_id: string
          p_group_id: string
          p_method?: Database['public']['Enums']['payment_method']
          p_paid_on?: string
          p_refund_surplus?: boolean
          p_start_date?: string
        }
        Returns: {
          enrollment_id: string
          refunded: number
          start_date: string
          subscription_id: string
          transferred: number
          whole_move: boolean
        }[]
      }
      user_last_sign_in: {
        Args: Record<PropertyKey, never>
        Returns: {
          last_sign_in_at: string
          user_id: string
        }[]
      }
      withdraw_enrollment: {
        Args: {
          p_end_date: string
          p_enrollment_id: string
          p_method?: Database['public']['Enums']['payment_method']
          p_paid_on?: string
          p_reason?: string
          p_refund?: number
        }
        Returns: {
          refunded: number
          remainder: number
        }[]
      }
    }
    Enums: {
      attendance_status: 'present' | 'absent_frozen' | 'absent_burned'
      cancel_reason: 'center' | 'teacher' | 'holiday' | 'all_frozen'
      discount_reason: 'none' | 'returning' | 'referral'
      enrollment_status: 'active' | 'finished'
      group_status: 'forming' | 'active' | 'archived'
      group_type: 'group' | 'mini' | 'pair' | 'individual' | 'afterschool'
      lesson_status: 'planned' | 'held' | 'cancelled'
      payment_kind: 'payment' | 'refund' | 'transfer'
      payment_method: 'cash' | 'mbank'
      payroll_adjustment_kind: 'advance' | 'bonus' | 'correction'
      role: 'teacher' | 'admin' | 'accountant'
      subscription_status: 'active' | 'exhausted' | 'refunded'
      trial_source: 'instagram' | 'referral' | '2gis' | 'other'
      trial_status: 'scheduled' | 'attended' | 'no_show' | 'enrolled' | 'closed'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      attendance_status: ['present', 'absent_frozen', 'absent_burned'],
      cancel_reason: ['center', 'teacher', 'holiday', 'all_frozen'],
      discount_reason: ['none', 'returning', 'referral'],
      enrollment_status: ['active', 'finished'],
      group_status: ['forming', 'active', 'archived'],
      group_type: ['group', 'mini', 'pair', 'individual', 'afterschool'],
      lesson_status: ['planned', 'held', 'cancelled'],
      payment_kind: ['payment', 'refund', 'transfer'],
      payment_method: ['cash', 'mbank'],
      payroll_adjustment_kind: ['advance', 'bonus', 'correction'],
      role: ['teacher', 'admin', 'accountant'],
      subscription_status: ['active', 'exhausted', 'refunded'],
      trial_source: ['instagram', 'referral', '2gis', 'other'],
      trial_status: ['scheduled', 'attended', 'no_show', 'enrolled', 'closed'],
    },
  },
} as const
