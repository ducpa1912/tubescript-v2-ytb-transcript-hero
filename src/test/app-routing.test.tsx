import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";

// The root shell renders a full <html> document, which jsdom can't mount inside a
// test container, so assert route resolution instead of DOM content.
async function resolve(path: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return router.state;
}

describe("App routing", () => {
  it("resolves the index route", async () => {
    const state = await resolve("/");
    expect(state.matches.at(-1)?.routeId).toBe("/");
  });

  it("resolves unknown paths as not found", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = await resolve("/this-route-does-not-exist");
    const matches = state.matches as Array<{ status: string; globalNotFound?: boolean }>;
    expect(matches.some((m) => m.status === "notFound" || !!m.globalNotFound)).toBe(true);
  });
});
