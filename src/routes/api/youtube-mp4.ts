import { createFileRoute } from "@tanstack/react-router";

// Public Piped instances (fallback chain). Piped is an open-source YouTube
// frontend that exposes stream URLs via a JSON API. No key, no account.
const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.projectsegfau.lt",
  "https://api.piped.private.coffee",
  "https://pipedapi.reallyaweso.me",
];

function extractVideoId(input: string): string | null {
  const s = input.trim();
  // Bare 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      // /shorts/<id> or /embed/<id>
      const m = u.pathname.match(/\/(shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch {
    // not a URL
  }
  return null;
}

type PipedStream = {
  url: string;
  format?: string;
  mimeType?: string;
  quality?: string;
  videoOnly?: boolean;
  bitrate?: number;
  width?: number;
  height?: number;
};
type PipedResponse = {
  title?: string;
  videoStreams?: PipedStream[];
  error?: string;
  message?: string;
};

async function fetchStreams(videoId: string): Promise<PipedResponse> {
  let lastErr: unknown = null;
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        lastErr = new Error(`${base} → ${res.status}`);
        continue;
      }
      const json = (await res.json()) as PipedResponse;
      if (json.error) {
        lastErr = new Error(`${base} → ${json.error}`);
        continue;
      }
      if (json.videoStreams?.length) return json;
      lastErr = new Error(`${base} → no streams`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Toutes les instances Piped ont échoué: ${(lastErr as Error)?.message ?? "?"}`);
}

function pickBestProgressive(streams: PipedStream[]): PipedStream | null {
  const progressive = streams.filter(
    (s) => !s.videoOnly && (s.format === "MPEG_4" || s.mimeType?.includes("mp4")),
  );
  if (!progressive.length) return null;
  progressive.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0));
  return progressive[0];
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "video"
  );
}

export const Route = createFileRoute("/api/youtube-mp4")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const raw = url.searchParams.get("url") ?? url.searchParams.get("v") ?? "";
        const videoId = extractVideoId(raw);
        if (!videoId) {
          return Response.json({ error: "URL YouTube invalide" }, { status: 400 });
        }

        let info: PipedResponse;
        try {
          info = await fetchStreams(videoId);
        } catch (e) {
          return Response.json(
            { error: (e as Error).message || "Récupération des flux impossible" },
            { status: 502 },
          );
        }

        const best = pickBestProgressive(info.videoStreams ?? []);
        if (!best) {
          return Response.json(
            { error: "Aucun flux MP4 progressif disponible pour cette vidéo (essaie une autre)." },
            { status: 415 },
          );
        }

        // Proxy the MP4 as a stream — no buffering into memory.
        let upstream: Response;
        try {
          upstream = await fetch(best.url, {
            headers: {
              // Some googlevideo hosts require a UA
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            },
          });
        } catch (e) {
          return Response.json(
            { error: `Téléchargement échoué: ${(e as Error).message}` },
            { status: 502 },
          );
        }
        if (!upstream.ok || !upstream.body) {
          return Response.json(
            { error: `Téléchargement échoué (${upstream.status})` },
            { status: 502 },
          );
        }

        const filename = `${sanitizeFilename(info.title ?? videoId)}.mp4`;
        const headers = new Headers();
        headers.set("content-type", "video/mp4");
        headers.set(
          "content-disposition",
          `attachment; filename="${filename.replace(/"/g, "")}"`,
        );
        const len = upstream.headers.get("content-length");
        if (len) headers.set("content-length", len);
        headers.set("cache-control", "no-store");

        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
