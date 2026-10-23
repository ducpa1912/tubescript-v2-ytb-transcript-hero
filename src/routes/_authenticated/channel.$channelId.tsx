import { createFileRoute } from "@tanstack/react-router";
import { ChannelBrain } from "@/components/channel-brain";

export const Route = createFileRoute("/_authenticated/channel/$channelId")({
  component: ChannelBrainRoute,
  head: () => ({ meta: [
    { title: "Channel Brain — Tubescript" },
    { name: "description", content: "Explain channel performance with timing, scripts and viewer needs." },
    { property: "og:type", content: "website" },
    { property: "og:title", content: "Channel Brain — Tubescript" },
    { property: "og:description", content: "Explain channel performance with timing, scripts and viewer needs." },
    { name: "twitter:card", content: "summary" },
  ] }),
});
function ChannelBrainRoute() {
  const { channelId } = Route.useParams();
  return <main className="mx-auto min-h-screen max-w-5xl px-4 py-10"><a href={`/?channel=${encodeURIComponent(channelId)}`} className="text-sm text-muted-foreground hover:text-foreground">← Open project</a><ChannelBrain channelId={channelId} /></main>;
}