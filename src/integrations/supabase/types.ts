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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      billing_accounts: {
        Row: {
          customer_id: string
          subscription_id: string | null
          subscription_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          customer_id: string
          subscription_id?: string | null
          subscription_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          customer_id?: string
          subscription_id?: string | null
          subscription_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      channels: {
        Row: {
          discovered_at: string
          handle: string | null
          id: string
          thumbnail: string | null
          title: string
          updated_at: string
          video_count: number
        }
        Insert: {
          discovered_at?: string
          handle?: string | null
          id: string
          thumbnail?: string | null
          title?: string
          updated_at?: string
          video_count?: number
        }
        Update: {
          discovered_at?: string
          handle?: string | null
          id?: string
          thumbnail?: string | null
          title?: string
          updated_at?: string
          video_count?: number
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          created_at: string
          delta: number
          description: string | null
          id: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          description?: string | null
          id?: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          description?: string | null
          id?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_usage: {
        Row: {
          day: string
          used: number
          user_id: string
        }
        Insert: {
          day?: string
          used?: number
          user_id: string
        }
        Update: {
          day?: string
          used?: number
          user_id?: string
        }
        Relationships: []
      }
      payment_fulfillments: {
        Row: {
          created_at: string
          credits: number
          reference_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits: number
          reference_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits?: number
          reference_id?: string
          user_id?: string
        }
        Relationships: []
      }
      pipeline_logs: {
        Row: {
          channel_id: string | null
          created_at: string
          detail: string | null
          duration_ms: number | null
          id: number
          outcome: string
          route: string
          stage: string
          user_id: string | null
          video_id: string | null
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          detail?: string | null
          duration_ms?: number | null
          id?: never
          outcome: string
          route: string
          stage: string
          user_id?: string | null
          video_id?: string | null
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          detail?: string | null
          duration_ms?: number | null
          id?: never
          outcome?: string
          route?: string
          stage?: string
          user_id?: string | null
          video_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          plan: Database["public"]["Enums"]["plan_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          plan?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          plan?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          channel_id: string
          channel_title: string
          created_at: string
          id: string
          thumbnail: string | null
          updated_at: string
          user_id: string
          video_count: number
        }
        Insert: {
          channel_id: string
          channel_title?: string
          created_at?: string
          id?: string
          thumbnail?: string | null
          updated_at?: string
          user_id: string
          video_count?: number
        }
        Update: {
          channel_id?: string
          channel_title?: string
          created_at?: string
          id?: string
          thumbnail?: string | null
          updated_at?: string
          user_id?: string
          video_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_video_unlocks: {
        Row: {
          id: string
          source: string
          unlocked_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          id?: string
          source?: string
          unlocked_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          id?: string
          source?: string
          unlocked_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_video_unlocks_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_metadata_history: {
        Row: {
          duration_seconds: number | null
          id: string
          publish_date: string | null
          recorded_at: string
          title: string | null
          video_id: string
          views: number | null
        }
        Insert: {
          duration_seconds?: number | null
          id?: string
          publish_date?: string | null
          recorded_at?: string
          title?: string | null
          video_id: string
          views?: number | null
        }
        Update: {
          duration_seconds?: number | null
          id?: string
          publish_date?: string | null
          recorded_at?: string
          title?: string | null
          video_id?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_metadata_history_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_transcripts: {
        Row: {
          caption_lang: string | null
          extracted_at: string
          transcript: string
          video_id: string
          word_count: number
        }
        Insert: {
          caption_lang?: string | null
          extracted_at?: string
          transcript: string
          video_id: string
          word_count?: number
        }
        Update: {
          caption_lang?: string | null
          extracted_at?: string
          transcript?: string
          video_id?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "video_transcripts_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: true
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          attempts: number
          caption_lang: string | null
          channel_id: string | null
          duration_seconds: number | null
          id: string
          position: number
          publish_date: string | null
          status: string
          status_detail: string | null
          title: string
          updated_at: string
          views: number | null
          views_updated_at: string | null
          word_count: number
        }
        Insert: {
          attempts?: number
          caption_lang?: string | null
          channel_id?: string | null
          duration_seconds?: number | null
          id: string
          position?: number
          publish_date?: string | null
          status?: string
          status_detail?: string | null
          title?: string
          updated_at?: string
          views?: number | null
          views_updated_at?: string | null
          word_count?: number
        }
        Update: {
          attempts?: number
          caption_lang?: string | null
          channel_id?: string | null
          duration_seconds?: number | null
          id?: string
          position?: number
          publish_date?: string | null
          status?: string
          status_detail?: string | null
          title?: string
          updated_at?: string
          views?: number | null
          views_updated_at?: string | null
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "videos_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          credits: number
          updated_at: string
          user_id: string
        }
        Insert: {
          credits?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          credits?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      deliver_transcript_unlocks: {
        Args: { _ids: string[]; _user: string }
        Returns: Json
      }
      fulfill_stripe_credits: {
        Args: { _reference: string; _type: string; _user: string }
        Returns: boolean
      }
      user_channel_remaining: {
        Args: { _channel: string; _user: string }
        Returns: number
      }
      user_channel_todo: {
        Args: { _channel: string; _limit: number; _user: string }
        Returns: {
          attempts: number
          cached: boolean
          duration_seconds: number
          id: string
          publish_date: string
          status: string
          title: string
          views: number
        }[]
      }
    }
    Enums: {
      plan_tier: "free" | "paid"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      plan_tier: ["free", "paid"],
    },
  },
} as const
