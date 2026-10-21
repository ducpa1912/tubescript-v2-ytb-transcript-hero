import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYSIS_SETTINGS } from "@/lib/analysis";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
describe("provider eligibility", () => {
  it("never uses the paid DeepSeek Go route and verifies OpenRouter pricing", async () => {
    vi.stubEnv("OPENCODE_API_KEY", "test"); vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({ data: url.includes("openrouter") ? [
      { id: "minimax/minimax-m3.1-flash:free", pricing: { prompt: "0", completion: "1" } },
    ] : [{ id: "deepseek-v4.1-flash" }, { id: "minimax-m3.1-flash-free" }] })));
    const { availableRoutes } = await import("@/lib/ai-router.server");
    const routes = await availableRoutes(DEFAULT_ANALYSIS_SETTINGS, "read");
    expect(routes.map((r) => r.model)).toEqual(["minimax-m3.1-flash-free", "minimax-m3.1-flash-free"]);
    expect(routes.some((r) => r.provider === "openrouter")).toBe(false);
  });
  it("upgrades Watch only when auto-rollup is enabled", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test"); vi.stubEnv("OPENCODE_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"].map((id) => ({ id, architecture: { input_modalities: ["text", "video"] } })) })));
    const { availableRoutes } = await import("@/lib/ai-router.server");
    expect((await availableRoutes(DEFAULT_ANALYSIS_SETTINGS, "watch")).map((r) => r.model)).toEqual(["google/gemini-3.1-flash-lite"]);
    expect((await availableRoutes({ ...DEFAULT_ANALYSIS_SETTINGS, autoRollup: true }, "watch")).map((r) => r.model)).toEqual(["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"]);
  });
});