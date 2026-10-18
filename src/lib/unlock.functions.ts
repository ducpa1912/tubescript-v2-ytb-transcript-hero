import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const unlockTranscripts = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ videoIds: z.array(z.string().regex(/^[\w-]{11}$/)).min(1).max(1000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("deliver_transcript_unlocks", { _user: context.userId, _ids: [...new Set(data.videoIds)] });
    if (error) throw new Error("Unable to unlock transcripts. Please retry.");
    return result as { ids: string[]; freeUsed: number; creditUsed: number; freeLeft: number; credits: number };
  });