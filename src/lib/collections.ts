export const collectionIdPattern = /^(?:UC[\w-]{22}|PL:[\w-]{10,150})$/;
export const collectionUrl = (id: string) => id.startsWith("PL:")
  ? `https://www.youtube.com/playlist?list=${encodeURIComponent(id.slice(3))}`
  : `https://www.youtube.com/channel/${id}`;
export const isKnownPage = (ids: string[], known: ReadonlySet<string>) => ids.length > 0 && ids.every((id) => known.has(id));