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
            referencedRelation: 'v_subscription_balances'
            referencedColumns: ['subscription_id']
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
          subject: string
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
          subject: string
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
          subject?: string
          teacher_id?: string
        }
        Relationships: [
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
    }
    Views: {
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
        ]
      }
      v_payroll_preview: {
        Row: {
          base_amount: number | null
          hours: number | null
          lessons_held: number | null
          month: string | null
          student_lessons: number | null
          teacher_id: string | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: 'groups_teacher_id_fkey'
            columns: ['teacher_id']
            isOneToOne: false
            referencedRelation: 'teachers'
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
      archive_group: { Args: { p_group_id: string }; Returns: number }
      assert_admin: { Args: Record<PropertyKey, never>; Returns: undefined }
      attendance_subscription: {
        Args: { p_lesson_id: string; p_student_id: string }
        Returns: string
      }
      bishkek_today: { Args: Record<PropertyKey, never>; Returns: string }
      cancel_lesson: {
        Args: {
          p_comment?: string
          p_lesson_id: string
          p_reason: Database['public']['Enums']['cancel_reason']
        }
        Returns: undefined
      }
      confirm_lesson: { Args: { p_lesson_id: string; p_marks: Json }; Returns: string }
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
          p_subject: string
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
      ensure_lessons: { Args: { p_until: string }; Returns: number }
      generate_lessons: { Args: { p_group_id: string; p_until: string }; Returns: number }
      is_accountant: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_staff: { Args: Record<PropertyKey, never>; Returns: boolean }
      lesson_starts_at: { Args: { p_date: string; p_start: string }; Returns: string }
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
      tariff_duration: {
        Args: { p_date: string; p_group_type: Database['public']['Enums']['group_type'] }
        Returns: number
      }
      teaches_enrollment: { Args: { p_enrollment_id: string }; Returns: boolean }
      teaches_group: { Args: { p_group_id: string }; Returns: boolean }
      teaches_lesson: { Args: { p_lesson_id: string }; Returns: boolean }
      teaches_student: { Args: { p_student_id: string }; Returns: boolean }
      user_last_sign_in: {
        Args: Record<PropertyKey, never>
        Returns: {
          last_sign_in_at: string
          user_id: string
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
      role: 'teacher' | 'admin' | 'accountant'
      subscription_status: 'active' | 'exhausted' | 'refunded'
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
      role: ['teacher', 'admin', 'accountant'],
      subscription_status: ['active', 'exhausted', 'refunded'],
    },
  },
} as const
