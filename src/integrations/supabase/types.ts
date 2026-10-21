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
      analysis_generation_leases: {
        Row: {
          expires_at: string
          tier: string
          token: string
          version: number
          video_id: string
        }
        Insert: {
          expires_at: string
          tier: string
          token: string
          version: number
          video_id: string
        }
        Update: {
          expires_at?: string
          tier?: string
          token?: string
          version?: number
          video_id?: string
        }
        Relationships: []
      }
      analysis_jobs: {
        Row: {
          attempts: number
          available_at: string
          created_at: string
          error: string | null
          id: string
          lease_until: string | null
          refresh_requested_at: string | null
          settings: Json
          status: string
          tier: string
          updated_at: string
          user_id: string
          version: number
          video_id: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          created_at?: string
          error?: string | null
          id?: string
          lease_until?: string | null
          refresh_requested_at?: string | null
          settings: Json
          status?: string
          tier: string
          updated_at?: string
          user_id: string
          version?: number
          video_id: string
        }
        Update: {
          attempts?: number
          available_at?: string
          created_at?: string
          error?: string | null
          id?: string
          lease_until?: string | null
          refresh_requested_at?: string | null
          settings?: Json
          status?: string
          tier?: string
          updated_at?: string
          user_id?: string
          version?: number
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_jobs_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_settings: {
        Row: {
          settings: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          settings?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          settings?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
      collection_videos: {
        Row: {
          collection_id: string
          position: number
          video_id: string
        }
        Insert: {
          collection_id: string
          position?: number
          video_id: string
        }
        Update: {
          collection_id?: string
          position?: number
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_videos_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_videos_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          created_at: string
          delta: number
          description: string | null
          free_used: number
          id: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          description?: string | null
          free_used?: number
          id?: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          description?: string | null
          free_used?: number
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
      user_analysis_unlocks: {
        Row: {
          tier: string
          unlocked_at: string
          user_id: string
          version: number
          video_id: string
        }
        Insert: {
          tier: string
          unlocked_at?: string
          user_id: string
          version?: number
          video_id: string
        }
        Update: {
          tier?: string
          unlocked_at?: string
          user_id?: string
          version?: number
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_analysis_unlocks_video_id_tier_version_fkey"
            columns: ["video_id", "tier", "version"]
            isOneToOne: false
            referencedRelation: "video_analyses"
            referencedColumns: ["video_id", "tier", "version"]
          },
        ]
      }
      user_caption_unlocks: {
        Row: {
          unlocked_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          unlocked_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          unlocked_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_caption_unlocks_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
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
      video_analyses: {
        Row: {
          created_at: string
          model: string
          provider: string
          result: Json
          segments: Json
          tier: string
          usage: Json | null
          version: number
          video_id: string
          watch_format: number
        }
        Insert: {
          created_at?: string
          model: string
          provider: string
          result: Json
          segments: Json
          tier: string
          usage?: Json | null
          version?: number
          video_id: string
          watch_format?: number
        }
        Update: {
          created_at?: string
          model?: string
          provider?: string
          result?: Json
          segments?: Json
          tier?: string
          usage?: Json | null
          version?: number
          video_id?: string
          watch_format?: number
        }
        Relationships: [
          {
            foreignKeyName: "video_analyses_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_caption_cues: {
        Row: {
          cues: Json
          extracted_at: string
          video_id: string
        }
        Insert: {
          cues: Json
          extracted_at?: string
          video_id: string
        }
        Update: {
          cues?: Json
          extracted_at?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_caption_cues_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: true
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
      watch_categories: {
        Row: {
          created_at: string
          description: string
          label: string
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string
          label: string
          slug: string
        }
        Update: {
          created_at?: string
          description?: string
          label?: string
          slug?: string
        }
        Relationships: []
      }
      watch_moments: {
        Row: {
          category_slug: string | null
          end_seconds: number
          ordinal: number
          payload: Json
          segment_id: string
          start_seconds: number
          tier: string
          version: number
          video_id: string
        }
        Insert: {
          category_slug?: string | null
          end_seconds: number
          ordinal: number
          payload: Json
          segment_id: string
          start_seconds: number
          tier?: string
          version?: number
          video_id: string
        }
        Update: {
          category_slug?: string | null
          end_seconds?: number
          ordinal?: number
          payload?: Json
          segment_id?: string
          start_seconds?: number
          tier?: string
          version?: number
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watch_moments_category_slug_fkey"
            columns: ["category_slug"]
            isOneToOne: false
            referencedRelation: "watch_categories"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "watch_moments_video_id_tier_version_fkey"
            columns: ["video_id", "tier", "version"]
            isOneToOne: false
            referencedRelation: "video_analyses"
            referencedColumns: ["video_id", "tier", "version"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_analysis_generation: {
        Args: {
          _tier: string
          _token: string
          _version: number
          _video: string
        }
        Returns: boolean
      }
      claim_analysis_job: {
        Args: { _job: string; _user: string }
        Returns: {
          attempts: number
          available_at: string
          created_at: string
          error: string | null
          id: string
          lease_until: string | null
          refresh_requested_at: string | null
          settings: Json
          status: string
          tier: string
          updated_at: string
          user_id: string
          version: number
          video_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "analysis_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      deliver_analysis_unlock: {
        Args: {
          _tier: string
          _user: string
          _version?: number
          _video: string
        }
        Returns: Json
      }
      deliver_caption_unlock: {
        Args: { _user: string; _video: string }
        Returns: Json
      }
      deliver_transcript_unlocks: {
        Args: { _ids: string[]; _user: string }
        Returns: Json
      }
      fulfill_stripe_credits: {
        Args: { _reference: string; _type: string; _user: string }
        Returns: boolean
      }
      replace_watch_analysis: {
        Args: {
          _model: string
          _provider: string
          _result: Json
          _segments: Json
          _token: string
          _usage: Json
          _video: string
        }
        Returns: undefined
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
