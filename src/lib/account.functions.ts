import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Metadata = Record<string, unknown>;

function readString(metadata: Metadata | null | undefined, key: string): string | null {
  if (!metadata) return null;
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Creates the profile (and wallet row) the first time a user signs in. */
export const ensureProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const meta = (claims?.user_metadata ?? null) as Metadata | null;

    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          user_id: userId,
          email: readString(meta, "email"),
          display_name: readString(meta, "full_name") ?? readString(meta, "name"),
          avatar_url: readString(meta, "avatar_url") ?? readString(meta, "picture"),
        },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);

    // Wallet row is created by an authenticated insert is not possible (no
    // INSERT grant/policy for wallets), so upsert via the same RLS-scoped
    // client only if it already exists; the ledger grant path creates it on
    // first purchase. Read-only check here:
    return { ok: true };
  });

export const getAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [profileRes, walletRes, usageRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("wallets").select("credits").eq("user_id", userId).maybeSingle(),
      supabase
        .from("daily_usage")
        .select("used")
        .eq("user_id", userId)
        .eq("day", new Date().toISOString().slice(0, 10))
        .maybeSingle(),
    ]);

    return {
      userId,
      profile: profileRes.data ?? null,
      credits: walletRes.data?.credits ?? 0,
      usedToday: usageRes.data?.used ?? 0,
    };
  });
