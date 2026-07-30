export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_owner: {
        Row: {
          claimed_at: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          user_id?: string
        }
        Relationships: []
      }
      focus_session: {
        Row: {
          actual_secs: number
          client_id: string | null
          client_updated_at: string
          deleted_at: string | null
          ended_at: string | null
          energy: Database["public"]["Enums"]["energy_level"] | null
          id: string
          notes: string | null
          phase: Database["public"]["Enums"]["focus_phase"]
          planned_mins: number
          started_at: string
          task_id: string | null
          updated_at: string
          was_completed: boolean
        }
        Insert: {
          actual_secs?: number
          client_id?: string | null
          client_updated_at: string
          deleted_at?: string | null
          ended_at?: string | null
          energy?: Database["public"]["Enums"]["energy_level"] | null
          id: string
          notes?: string | null
          phase?: Database["public"]["Enums"]["focus_phase"]
          planned_mins: number
          started_at: string
          task_id?: string | null
          updated_at?: string
          was_completed?: boolean
        }
        Update: {
          actual_secs?: number
          client_id?: string | null
          client_updated_at?: string
          deleted_at?: string | null
          ended_at?: string | null
          energy?: Database["public"]["Enums"]["energy_level"] | null
          id?: string
          notes?: string | null
          phase?: Database["public"]["Enums"]["focus_phase"]
          planned_mins?: number
          started_at?: string
          task_id?: string | null
          updated_at?: string
          was_completed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "focus_session_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
        ]
      }
      habit: {
        Row: {
          archived_at: string | null
          client_id: string | null
          client_updated_at: string
          color: string
          deleted_at: string | null
          description: string | null
          id: string
          interval_days: number | null
          kind: Database["public"]["Enums"]["habit_kind"]
          month_day: number | null
          target_per_period: number
          title: string
          updated_at: string
          weekdays: number[] | null
        }
        Insert: {
          archived_at?: string | null
          client_id?: string | null
          client_updated_at: string
          color?: string
          deleted_at?: string | null
          description?: string | null
          id: string
          interval_days?: number | null
          kind: Database["public"]["Enums"]["habit_kind"]
          month_day?: number | null
          target_per_period?: number
          title: string
          updated_at?: string
          weekdays?: number[] | null
        }
        Update: {
          archived_at?: string | null
          client_id?: string | null
          client_updated_at?: string
          color?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          interval_days?: number | null
          kind?: Database["public"]["Enums"]["habit_kind"]
          month_day?: number | null
          target_per_period?: number
          title?: string
          updated_at?: string
          weekdays?: number[] | null
        }
        Relationships: []
      }
      habit_log: {
        Row: {
          client_id: string | null
          client_updated_at: string
          completed_at: string
          deleted_at: string | null
          habit_id: string
          id: string
          log_date: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_updated_at: string
          completed_at: string
          deleted_at?: string | null
          habit_id: string
          id: string
          log_date: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_updated_at?: string
          completed_at?: string
          deleted_at?: string | null
          habit_id?: string
          id?: string
          log_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_log_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habit"
            referencedColumns: ["id"]
          },
        ]
      }
      tag: {
        Row: {
          client_id: string | null
          client_updated_at: string
          color: string
          deleted_at: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_updated_at: string
          color?: string
          deleted_at?: string | null
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_updated_at?: string
          color?: string
          deleted_at?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      task: {
        Row: {
          client_id: string | null
          client_updated_at: string
          completed_at: string | null
          deleted_at: string | null
          description: string | null
          due_at: string | null
          due_is_all_day: boolean
          estimated_mins: number | null
          id: string
          is_important: boolean
          is_urgent: boolean
          parent_id: string | null
          sort_order: number
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_updated_at: string
          completed_at?: string | null
          deleted_at?: string | null
          description?: string | null
          due_at?: string | null
          due_is_all_day?: boolean
          estimated_mins?: number | null
          id: string
          is_important?: boolean
          is_urgent?: boolean
          parent_id?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_updated_at?: string
          completed_at?: string | null
          deleted_at?: string | null
          description?: string | null
          due_at?: string | null
          due_is_all_day?: boolean
          estimated_mins?: number | null
          id?: string
          is_important?: boolean
          is_urgent?: boolean
          parent_id?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
        ]
      }
      task_tag: {
        Row: {
          client_id: string | null
          client_updated_at: string
          deleted_at: string | null
          tag_id: string
          task_id: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_updated_at: string
          deleted_at?: string | null
          tag_id: string
          task_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_updated_at?: string
          deleted_at?: string | null
          tag_id?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_tag_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tag"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_tag_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
        ]
      }
      time_block: {
        Row: {
          client_id: string | null
          client_updated_at: string
          deleted_at: string | null
          ends_at: string
          id: string
          starts_at: string
          task_id: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          client_updated_at: string
          deleted_at?: string | null
          ends_at: string
          id: string
          starts_at: string
          task_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          client_updated_at?: string
          deleted_at?: string | null
          ends_at?: string
          id?: string
          starts_at?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_block_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_app_owner: { Args: never; Returns: boolean }
    }
    Enums: {
      energy_level: "HIGH" | "MEDIUM" | "LOW"
      focus_phase: "FOCUS" | "SHORT_BREAK" | "LONG_BREAK"
      habit_kind: "DAILY" | "WEEKDAYS" | "INTERVAL" | "MONTHLY_NTH"
      task_status:
        | "INBOX"
        | "BACKLOG"
        | "TODAY"
        | "IN_PROGRESS"
        | "COMPLETED"
        | "ARCHIVED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      energy_level: ["HIGH", "MEDIUM", "LOW"],
      focus_phase: ["FOCUS", "SHORT_BREAK", "LONG_BREAK"],
      habit_kind: ["DAILY", "WEEKDAYS", "INTERVAL", "MONTHLY_NTH"],
      task_status: [
        "INBOX",
        "BACKLOG",
        "TODAY",
        "IN_PROGRESS",
        "COMPLETED",
        "ARCHIVED",
      ],
    },
  },
} as const
