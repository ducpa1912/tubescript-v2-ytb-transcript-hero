import { describe, expect, it, vi } from "vitest";
import { saveDiscoveredVideos } from "@/lib/video-discovery";

describe("saved video discovery", () => {
  it("updates old video metadata without inserting or resetting extraction state", async () => {
    const saved = { id: "old-video", title: "Old title", status: "ok", attempts: 2, word_count: 1234 };
    const insert = vi.fn(async () => {});
    const update = vi.fn(async (_id: string, patch: object) => { Object.assign(saved, patch); });
    await saveDiscoveredVideos([{ id: saved.id, title: "Latest title" }], new Set([saved.id]),
      (video) => ({ title: video.title }), insert, update);
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("old-video", { title: "Latest title" });
    expect(saved).toEqual({ id: "old-video", title: "Latest title", status: "ok", attempts: 2, word_count: 1234 });
  });

  it("queues new videos separately from old metadata-only updates", async () => {
    const insert = vi.fn(async () => {});
    const update = vi.fn(async () => {});
    await saveDiscoveredVideos([{ id: "new", title: "New" }, { id: "old", title: "Updated" }],
      new Set(["old"]), (video) => ({ title: video.title }), insert, update);
    expect(insert).toHaveBeenCalledWith([{ id: "new", title: "New", status: "pending" }]);
    expect(update).toHaveBeenCalledWith("old", { title: "Updated" });
  });
});