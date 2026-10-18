/** Discovery writes metadata separately from extraction state. */
export async function saveDiscoveredVideos<T extends { id: string }, P extends object>(
  videos: T[],
  existingIds: ReadonlySet<string>,
  makeMetadataPatch: (video: T) => P,
  insertNew: (rows: Array<T & { status: "pending" }>) => Promise<void>,
  updateMetadata: (id: string, patch: P) => Promise<void>,
) {
  const newRows = videos.filter((video) => !existingIds.has(video.id))
    .map((video) => ({ ...video, status: "pending" as const }));
  if (newRows.length) await insertNew(newRows);
  const updates = videos.filter((video) => existingIds.has(video.id));
  // Bound database writes as well as extraction requests.
  for (let i = 0; i < updates.length; i += 3) {
    await Promise.all(updates.slice(i, i + 3).map(async (video) => {
      const patch = makeMetadataPatch(video);
      if (Object.keys(patch).length) await updateMetadata(video.id, patch);
    }));
  }
}