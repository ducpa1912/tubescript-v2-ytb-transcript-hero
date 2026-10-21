import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_SETTINGS } from "@/lib/analysis";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
describe("provider eligibility", () => {
  it("routes Read only to the zero-priced OpenRouter MiniMax model by default", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test"); vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({ data: url.includes("openrouter") ? [
      { id: "minimax/minimax-m3.1-flash:free", pricing: { prompt: "0", completion: "0" } },
      { id: "deepseek/deepseek-v4.1-flash", pricing: { prompt: "0.0001", completion: "0.0004" } },
    ] : [{ id: "minimax-m3.1-flash-free" }] })));
    const { availableRoutes } = await import("@/lib/ai-router.server");
    const routes = await availableRoutes(DEFAULT_ANALYSIS_SETTINGS, "read");
    expect(routes.map((r) => r.model)).toEqual(["minimax/minimax-m3.1-flash:free"]);
  });
  it("never allows paid DeepSeek even with a legacy opt-in setting", async () => {
    vi.stubEnv("OPENCODE_API_KEY", ""); vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [
      { id: "minimax/minimax-m3.1-flash:free", pricing: { prompt: "0", completion: "0" } },
      { id: "deepseek/deepseek-v4.1-flash", pricing: { prompt: "0.0001", completion: "0.0004" } },
    ] })));
    const { availableRoutes } = await import("@/lib/ai-router.server");
    const routes = await availableRoutes({ ...DEFAULT_ANALYSIS_SETTINGS, readPaidFallback: true }, "read");
    expect(routes.map((r) => r.model)).toEqual(["minimax/minimax-m3.1-flash:free"]);
  });
  it("prefers OpenCode Gemini 3.5 Flash Lite for Watch", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test"); vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "gemini-3.5-flash-lite" }] })));
    const { availableRoutes } = await import("@/lib/ai-router.server");
    const routes = await availableRoutes(DEFAULT_ANALYSIS_SETTINGS, "watch");
    expect(routes.map((r) => `${r.provider}:${r.model}`)).toEqual(["opencode-zen:gemini-3.5-flash-lite"]);
  });
  it("upgrades Watch only when auto-rollup is enabled", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test"); vi.stubEnv("OPENCODE_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"].map((id) => ({ id, architecture: { input_modalities: ["text", "video"] } })) })));
    const { availableRoutes } = await import("@/lib/ai-router.server");
    expect((await availableRoutes(DEFAULT_ANALYSIS_SETTINGS, "watch")).map((r) => r.model)).toEqual(["google/gemini-3.1-flash-lite"]);
    expect((await availableRoutes({ ...DEFAULT_ANALYSIS_SETTINGS, autoRollup: true }, "watch")).map((r) => r.model)).toEqual(["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"]);
  });
});

describe("free fallback reliability", () => {
  const ids = ["minimax/minimax-m3.1-flash:free", "google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-super-vl:free", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"];
  const input = { tier: "read" as const, videoId: "A9ARTdBbgJQ", title: "Title", segments: [{ id: "s01", start: 0, end: 20, text: "Words" }], settings: DEFAULT_ANALYSIS_SETTINGS };
  it("retains every verified zero-cost model on the same provider", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: ids.map((id) => ({ id, pricing: { prompt: "0", completion: "0" } })) })));
    const { availableRoutes } = await import("@/lib/ai-router.server");
    expect((await availableRoutes(DEFAULT_ANALYSIS_SETTINGS, "read")).map((r) => r.model)).toEqual(ids);
  });
  it("advances after timeout and skips that model on subsequent calls", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test");
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/models")) return Response.json({ data: ids.map((id) => ({ id, pricing: { prompt: "0", completion: "0" } })) });
      const body = JSON.parse(String(init?.body)); models.push(body.model);
      if (body.model === ids[0]) throw new DOMException("timed out", "TimeoutError");
      return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "Summary", thesis: "Thesis" }) } }] });
    }));
    const { routeAnalysis } = await import("@/lib/ai-router.server");
    await routeAnalysis(input, vi.fn()); await routeAnalysis(input, vi.fn());
    expect(models).toEqual([ids[0], ids[1], ids[1]]);
  });
  it("stops on provider denial without switching models", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test"); const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/models")) return Response.json({ data: ids.map((id) => ({ id, pricing: { prompt: "0", completion: "0" } })) });
      calls.push(url); return new Response("Denied", { status: 403 });
    }));
    const { routeAnalysis } = await import("@/lib/ai-router.server");
    await expect(routeAnalysis(input, vi.fn())).rejects.toMatchObject({ terminal: true }); expect(calls).toHaveLength(1);
  });
  it("enumerates Watch anchors and never receives a Read result", async () => {
    const { buildAnalysisPrompt, ANALYSIS_ROUTE_TIMEOUT, ANALYSIS_RUN_BUDGET } = await import("@/lib/ai-router.server");
    const prompt = buildAnalysisPrompt({ ...input, tier: "watch", segments: [{ id: "s01", start: 0, end: 1, text: "Raw" }, { id: "s02", start: 1, end: 2, text: "Dialogue" }] });
    expect(prompt).toContain("s01, s02"); expect(prompt).toContain("No Read analysis is supplied");
    expect(ANALYSIS_ROUTE_TIMEOUT).toEqual({ read: 600000, watch: 600000 }); expect(ANALYSIS_RUN_BUDGET).toBe(610000);
  });
});