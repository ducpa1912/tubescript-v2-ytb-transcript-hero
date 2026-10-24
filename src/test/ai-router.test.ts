import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_SETTINGS } from "@/lib/analysis";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
const catalogFetch = () => vi.fn(async () => Response.json({ data: [] }));

describe("routing order", () => {
  it("routes Read/Channel Brain to OpenCode Go Muse Spark 1.3, then OpenRouter DeepSeek", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test"); vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.stubGlobal("fetch", catalogFetch());
    const { availableRoutes } = await import("@/lib/ai-router.server");
    const routes = await availableRoutes(DEFAULT_ANALYSIS_SETTINGS, "read");
    expect(routes.map((r) => `${r.provider}:${r.model}`)).toEqual(["opencode-go:muse-spark-1.3", "openrouter:deepseek/deepseek-v4.1-flash-1017"]);
    expect(routes[0]?.endpoint).toBe("https://opencode.ai/inference/go/v1/chat/completions");
  });
  it("routes Watch to OpenRouter Gemini 3.1 Flash Lite, then OpenCode Zen Gemini 3.5 Flash Lite", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test"); vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.stubGlobal("fetch", catalogFetch());
    const { availableRoutes } = await import("@/lib/ai-router.server");
    const routes = await availableRoutes(DEFAULT_ANALYSIS_SETTINGS, "watch");
    expect(routes.map((r) => `${r.provider}:${r.model}`)).toEqual(["openrouter:google/gemini-3.1-flash-lite", "opencode-zen:gemini-3.5-flash-lite"]);
    expect(routes[1]?.nativeGoogle).toBe(true);
  });
  it("skips a provider whose key is missing", async () => {
    vi.stubEnv("OPENCODE_API_KEY", ""); vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.stubGlobal("fetch", catalogFetch());
    const { availableRoutes } = await import("@/lib/ai-router.server");
    expect((await availableRoutes(DEFAULT_ANALYSIS_SETTINGS, "read")).map((r) => r.model)).toEqual(["deepseek/deepseek-v4.1-flash-1017"]);
  });
});

describe("fallback reliability", () => {
  const input = { tier: "read" as const, videoId: "A9ARTdBbgJQ", title: "Title", segments: [{ id: "s01", start: 0, end: 20, text: "Words" }], settings: DEFAULT_ANALYSIS_SETTINGS };
  it("advances after timeout and skips that model on subsequent calls", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test"); vi.stubEnv("OPENROUTER_API_KEY", "test");
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/models")) return Response.json({ data: [] });
      const body = JSON.parse(String(init?.body)); models.push(body.model);
      if (body.model === "muse-spark-1.3") throw new DOMException("timed out", "TimeoutError");
      return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "Summary", thesis: "Thesis" }) } }] });
    }));
    const { routeAnalysis } = await import("@/lib/ai-router.server");
    await routeAnalysis(input, vi.fn()); await routeAnalysis(input, vi.fn());
    expect(models).toEqual(["muse-spark-1.3", "deepseek/deepseek-v4.1-flash-1017", "deepseek/deepseek-v4.1-flash-1017"]);
  });
  it("Channel Brain text falls back from Go to DeepSeek with the right key", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "go-key"); vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    const auths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/models")) return Response.json({ data: [] });
      auths.push(String((init?.headers as Record<string, string>)["Authorization"]));
      if (url.includes("/go/")) return new Response("busy", { status: 429 });
      return Response.json({ choices: [{ message: { content: "ok" } }] });
    }));
    const { routeText } = await import("@/lib/ai-router.server");
    expect((await routeText("hi")).model).toBe("deepseek/deepseek-v4.1-flash-1017");
    expect(auths).toEqual(["Bearer go-key", "Bearer or-key"]);
  });
  it("enumerates Watch anchors and never receives a Read result", async () => {
    const { buildAnalysisPrompt, ANALYSIS_ROUTE_TIMEOUT, ANALYSIS_RUN_BUDGET } = await import("@/lib/ai-router.server");
    const prompt = buildAnalysisPrompt({ ...input, tier: "watch", segments: [{ id: "s01", start: 0, end: 1, text: "Raw" }, { id: "s02", start: 1, end: 2, text: "Dialogue" }] });
    expect(prompt).toContain("s01, s02"); expect(prompt).toContain("No Read analysis is supplied");
    expect(ANALYSIS_ROUTE_TIMEOUT).toEqual({ read: 600000, watch: 600000 }); expect(ANALYSIS_RUN_BUDGET).toBe(610000);
  });
});
