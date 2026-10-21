import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getAnalysisModels, getAnalysisSettings, saveAnalysisSettings } from "@/lib/analysis.functions";
import type { AnalysisSettings } from "@/lib/analysis";

const settingsQuery = queryOptions({ queryKey: ["analysis-settings"], queryFn: () => getAnalysisSettings() });
const modelsQuery = queryOptions({ queryKey: ["analysis-models"], queryFn: () => getAnalysisModels() });
export const Route = createFileRoute("/_authenticated/settings")({
  loader: async ({ context }) => { await Promise.all([context.queryClient.ensureQueryData(settingsQuery), context.queryClient.ensureQueryData(modelsQuery)]); },
  head: () => ({ meta: [{ title: "Analysis settings — Tubescript" }, { name: "description", content: "Choose free Read models, Watch models, provider routing and batch sizes for Tubescript video analysis." }, { property: "og:title", content: "Analysis settings — Tubescript" }, { property: "og:description", content: "Manage your Tubescript video analysis models and queue preferences." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: SettingsPage,
});
function SettingsPage() {
  const { data } = useSuspenseQuery(settingsQuery), { data: models } = useSuspenseQuery(modelsQuery);
  const [settings, setSettings] = useState<AnalysisSettings>(data), [pending, setPending] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const save = useServerFn(saveAnalysisSettings), query = useQueryClient();
  const update = <K extends keyof AnalysisSettings>(key: K, value: AnalysisSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  return <main className="mx-auto min-h-screen max-w-3xl px-4 py-10 sm:px-6">
    <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Tubescript</Link>
    <div className="mt-3 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold">Analysis settings</h1><p className="mt-2 text-sm text-muted-foreground">Read · Free &nbsp; / &nbsp; Watch · 10 credits per video</p></div><Link to="/analysis" className="text-sm text-primary underline">Analysis queue</Link></div>
    <form className="mt-8 space-y-6" onSubmit={async (e) => { e.preventDefault(); setPending(true); setNotice(null); try { await save({ data: settings }); await query.invalidateQueries({ queryKey: ["analysis-settings"] }); setNotice("Settings saved."); } catch (e) { setNotice(e instanceof Error ? e.message : "Could not save settings."); } finally { setPending(false); } }}>
      <section className="space-y-4 border-t pt-5"><h2 className="font-medium">Tier 1 · Read</h2><label className="block space-y-2"><span className="text-sm">Preferred free model</span><Select value={settings.readFamily} onValueChange={(v) => update("readFamily", v as AnalysisSettings["readFamily"])}><SelectTrigger aria-label="Read model"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="minimax">MiniMax M3.1 Flash · Free</SelectItem><SelectItem value="deepseek">DeepSeek V4.1 Flash · Free</SelectItem></SelectContent></Select></label></section>
      <section className="space-y-4 border-t pt-5"><h2 className="font-medium">Tier 2 · Watch</h2><label className="block space-y-2"><span className="text-sm">Video model</span><Select value={settings.watchModel} onValueChange={(v) => update("watchModel", v as AnalysisSettings["watchModel"])}><SelectTrigger aria-label="Watch model"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="google/gemini-3.1-flash-lite">Gemini 3.1 Flash Lite · Default</SelectItem><SelectItem value="google/gemini-3.5-flash-lite">Gemini 3.5 Flash Lite</SelectItem></SelectContent></Select></label><div className="flex items-center justify-between gap-4"><label htmlFor="auto-rollup" className="text-sm">Auto-rollup to Gemini 3.5 Flash Lite</label><Switch id="auto-rollup" checked={settings.autoRollup} onCheckedChange={(v) => update("autoRollup", v)} /></div></section>
      <section className="grid gap-4 border-t pt-5 sm:grid-cols-2"><label className="space-y-2"><span className="text-sm">Provider routing</span><Select value={settings.provider} onValueChange={(v) => update("provider", v as AnalysisSettings["provider"])}><SelectTrigger aria-label="Provider routing"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">Automatic fallback</SelectItem><SelectItem value="opencode-go">OpenCode Go</SelectItem><SelectItem value="opencode-zen">OpenCode Zen</SelectItem><SelectItem value="openrouter">OpenRouter</SelectItem></SelectContent></Select></label><label className="space-y-2"><span className="text-sm">Videos per batch</span><Select value={String(settings.batchSize)} onValueChange={(v) => update("batchSize", Number(v))}><SelectTrigger aria-label="Videos per batch"><SelectValue /></SelectTrigger><SelectContent>{[5, 6, 7, 8, 9, 10].map((n) => <SelectItem key={n} value={String(n)}>{n} videos</SelectItem>)}</SelectContent></Select></label></section>
      <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />}Save settings</Button>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </form>
    <section className="mt-8 border-t pt-5"><h2 className="font-medium">Available routes</h2><ul className="mt-3 space-y-2 text-xs text-muted-foreground">{[...models.read.map((m) => ({ ...m, tier: "Read · Free" })), ...models.watch.map((m) => ({ ...m, tier: "Watch" }))].map((m) => <li key={`${m.tier}-${m.provider}-${m.model}`} className="break-words">{m.tier} · {m.provider} · {m.model}</li>)}</ul></section>
  </main>;
}