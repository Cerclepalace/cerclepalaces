import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  processVideo,
  retrySegment,
  computeSegments,
  probeDuration,
  clearSegmentCache,
  FONT_OPTIONS,
  type RenderMode,
  type Short,
  type FontKey,
  type SubtitlePosition,
  type SegmentRange,
  type SegmentMetric,
} from "@/lib/video-processor";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NeonCut — Vidéos YouTube en Shorts TikTok avec sous-titres néon" },
      {
        name: "description",
        content:
          "Découpe une vidéo horizontale en shorts 9:16 personnalisables (police, couleur, position, trim) avec sous-titres néon générés par IA. 100% dans ton navigateur.",
      },
      { property: "og:title", content: "NeonCut — Vidéos YouTube en Shorts TikTok avec sous-titres néon" },
      {
        property: "og:description",
        content:
          "Découpe une vidéo horizontale en shorts 9:16 personnalisables (police, couleur, position, trim) avec sous-titres néon générés par IA. 100% dans ton navigateur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

type ColorPresetKey = "neon" | "white" | "yellow" | "custom";
const COLOR_PRESETS: Record<
  ColorPresetKey,
  { label: string; text: string; outline: string }
> = {
  neon: { label: "Néon blanc + vert", text: "#FFFFFF", outline: "#39FF14" },
  white: { label: "Blanc + contour noir", text: "#FFFFFF", outline: "#000000" },
  yellow: { label: "Jaune + contour noir", text: "#FFE500", outline: "#000000" },
  custom: { label: "Personnalisé", text: "#FFFFFF", outline: "#39FF14" },
};

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [segmentSec, setSegmentSec] = useState(70);
  const [renderMode, setRenderMode] = useState<RenderMode>("fast");
  const [fontKey, setFontKey] = useState<FontKey>("bebas");
  const [colorPreset, setColorPreset] = useState<ColorPresetKey>("neon");
  const [textColor, setTextColor] = useState("#FFFFFF");
  const [outlineColor, setOutlineColor] = useState("#39FF14");
  const [position, setPosition] = useState<SubtitlePosition>("bottom");
  const [manualMode, setManualMode] = useState(false);
  const [manualText, setManualText] = useState("");
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(null);
  const [shorts, setShorts] = useState<Short[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [metrics, setMetrics] = useState<Record<number, SegmentMetric>>({});
  const [runStartMs, setRunStartMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [maxConcurrent, setMaxConcurrent] = useState(4);
  const [rpm, setRpm] = useState(30);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live clock while busy so throughput/ETA update in real time
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [busy]);

  const ytValid = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(youtubeUrl.trim());
  const cobaltUrl = ytValid
    ? `https://cobalt.tools/#${encodeURIComponent(youtubeUrl.trim())}`
    : "https://cobalt.tools";
  const ssyoutubeUrl = ytValid
    ? youtubeUrl.trim().replace(/youtube\.com|youtu\.be/i, "ssyoutube.com")
    : "https://ssyoutube.com";

  // Sync preset colors
  useEffect(() => {
    if (colorPreset !== "custom") {
      setTextColor(COLOR_PRESETS[colorPreset].text);
      setOutlineColor(COLOR_PRESETS[colorPreset].outline);
    }
  }, [colorPreset]);

  const handleFile = async (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setError("Fichier vidéo requis (mp4, mov, webm…)");
      return;
    }
    if (f.size > 500 * 1024 * 1024) {
      setError("Vidéo trop lourde (> 500 Mo). Compresse-la d'abord.");
      return;
    }
    setError(null);
    setFile(f);
    setShorts([]);
    try {
      const d = await probeDuration(f);
      setDuration(d);
      setTrimStart(0);
      setTrimEnd(d);
    } catch {
      setDuration(0);
    }
  };

  const parseManual = (): SegmentRange[] => {
    return manualText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        // accepts "12-45", "12:00-01:30", "12,45"
        const parts = line.split(/[-,;]/).map((p) => p.trim());
        if (parts.length !== 2) return null;
        const toSec = (t: string): number => {
          if (t.includes(":")) {
            const [m, s] = t.split(":").map(Number);
            return (m || 0) * 60 + (s || 0);
          }
          return Number(t) || 0;
        };
        const start = toSec(parts[0]);
        const end = toSec(parts[1]);
        if (!(end > start)) return null;
        return { start, end };
      })
      .filter((v): v is SegmentRange => v !== null);
  };

  const usableDur = Math.max(0, trimEnd - trimStart);
  const estimatedShorts = manualMode
    ? parseManual().length
    : Math.max(1, Math.floor(usableDur / segmentSec));

  const run = useCallback(
    async (previewOnly = false) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      setShorts([]);
      setMetrics({});
      setRunStartMs(Date.now());
      setNowMs(Date.now());
      setStatus(previewOnly ? "Aperçu…" : "Démarrage…");
      try {
        let custom = manualMode ? parseManual() : undefined;
        if (previewOnly) {
          const base = custom && custom.length > 0 ? custom[0].start : trimStart;
          const end = Math.min(duration || base + 8, base + 8);
          custom = [{ start: base, end }];
        }
        const out = await processVideo({
          file,
          segmentSec,
          renderMode: previewOnly ? "fast" : renderMode,
          style: { fontKey, textColor, outlineColor, position },
          trim: { start: trimStart, end: trimEnd || duration },
          customSegments: custom,
          throttle: { maxConcurrent, rpm },
          onProgress: (info) => {
            setStatus(info.phase);
            if (info.segmentIndex !== undefined && info.totalSegments) {
              setProgress({ i: info.segmentIndex + 1, total: info.totalSegments });
            }
          },
          onShort: (short) => {
            setShorts((current) => [...current, short]);
          },
          onMetric: (m) => {
            setMetrics((prev) => {
              const existing = prev[m.index];
              return { ...prev, [m.index]: { ...(existing ?? {}), ...m } };
            });
          },
          onLog: (msg) => {
            if (msg && !msg.startsWith("frame=")) console.debug("[ffmpeg]", msg);
          },
        });
        setStatus(
          previewOnly
            ? "Aperçu prêt — valide le style avant le rendu complet"
            : `${out.length} short${out.length > 1 ? "s" : ""} prêt${out.length > 1 ? "s" : ""}`,
        );
      } catch (e) {
        setError((e as Error).message);
        setStatus("");
      } finally {
        setBusy(false);
        setProgress(null);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [
      file,
      renderMode,
      segmentSec,
      fontKey,
      textColor,
      outlineColor,
      position,
      trimStart,
      trimEnd,
      duration,
      manualMode,
      manualText,
      maxConcurrent,
      rpm,
    ],
  );

  const download = (s: Short) => {
    const a = document.createElement("a");
    a.href = s.url;
    a.download = `short_${String(s.index + 1).padStart(2, "0")}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const MAX_MANUAL_RETRIES = 3;

  const handleRetry = useCallback(
    async (index: number) => {
      if (!file) return;
      const current = metrics[index];
      const manualCount = current?.manualAttempts ?? 0;
      if (manualCount >= MAX_MANUAL_RETRIES) return;

      const custom = manualMode ? parseManual() : undefined;
      const segments = computeSegments(
        duration,
        segmentSec,
        { start: trimStart, end: trimEnd || duration },
        custom,
      );
      const seg = segments[index];
      if (!seg) return;

      // Immediately reflect the manual retry attempt count.
      setMetrics((prev) => ({
        ...prev,
        [index]: {
          ...(prev[index] ?? { index, status: "pending" }),
          status: "retrying",
          manualAttempts: manualCount + 1,
          lastError: undefined,
        },
      }));

      try {
        const short = await retrySegment({
          file,
          index,
          segment: seg,
          renderMode,
          style: { fontKey, textColor, outlineColor, position },
          throttle: { maxConcurrent, rpm },
          onMetric: (m) => {
            setMetrics((prev) => {
              const existing = prev[m.index];
              return {
                ...prev,
                [m.index]: { ...(existing ?? {}), ...m, manualAttempts: manualCount + 1 },
              };
            });
          },
          onLog: (msg) => {
            if (msg && !msg.startsWith("frame=")) console.debug("[ffmpeg-retry]", msg);
          },
        });
        if (short) {
          setShorts((cur) => {
            const filtered = cur.filter((s) => s.index !== short.index);
            return [...filtered, short].sort((a, b) => a.index - b.index);
          });
        }
      } catch (e) {
        setMetrics((prev) => ({
          ...prev,
          [index]: {
            ...(prev[index] ?? { index, status: "error" }),
            status: "error",
            lastError: (e as Error).message,
            manualAttempts: manualCount + 1,
          },
        }));
      }
    },
    [
      file,
      metrics,
      duration,
      segmentSec,
      trimStart,
      trimEnd,
      manualMode,
      manualText,
      renderMode,
      fontKey,
      textColor,
      outlineColor,
      position,
      maxConcurrent,
      rpm,
    ],
  );


  const fontPreviewFamily: Record<FontKey, string> = {
    bebas: "Bebas Neue, Impact, sans-serif",
    anton: "Anton, Impact, sans-serif",
    montserrat: "Montserrat, Arial, sans-serif",
    impact: "Oswald, Impact, sans-serif",
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Anton&family=Montserrat:wght@900&family=Oswald:wght@700&display=swap"
      />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-40">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-[#39FF14] blur-[180px]" />
        <div className="absolute -bottom-40 -right-40 h-[600px] w-[600px] rounded-full bg-[#39FF14] blur-[220px] opacity-60" />
      </div>

      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-8">
        <h1
          className="text-3xl font-black tracking-tight"
          style={{ fontFamily: "Bebas Neue, Impact, sans-serif", letterSpacing: "0.06em" }}
        >
          NEON<span style={{ color: "#39FF14", textShadow: "0 0 12px #39FF14" }}>CUT</span>
        </h1>
        <span className="text-xs uppercase tracking-widest text-white/50">Local · No upload</span>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24">
        <section className="mb-10">
          <h2
            className="text-5xl leading-[0.95] md:text-6xl"
            style={{ fontFamily: "Bebas Neue, Impact, sans-serif", letterSpacing: "0.02em" }}
          >
            Ta vidéo, en shorts <br />
            <span style={{ color: "#39FF14", textShadow: "0 0 24px rgba(57,255,20,0.5)" }}>
              prêts pour TikTok.
            </span>
          </h2>
          <p className="mt-4 max-w-xl text-sm text-white/60">
            Uploade une vidéo horizontale. Personnalise la police, la couleur, la position des
            sous-titres et découpe précisément la vidéo. Tout est calculé dans ton navigateur.
          </p>
        </section>

        <section className="mb-6 rounded-2xl border border-[#39FF14]/25 bg-[#39FF14]/[0.04] p-6">
          <div className="mb-3 flex items-center gap-2">
            <span
              className="text-xl"
              style={{ fontFamily: "Bebas Neue, Impact, sans-serif", color: "#39FF14", letterSpacing: "0.06em" }}
            >
              1 · RÉCUPÈRE TA VIDÉO YOUTUBE
            </span>
          </div>
          <p className="mb-3 text-sm text-white/70">
            NeonCut ne peut pas télécharger YouTube directement. Colle le lien ci-dessous, on t'ouvre
            un téléchargeur externe en un clic.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              inputMode="url"
              maxLength={300}
              placeholder="https://youtu.be/…"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value.slice(0, 300))}
              className="flex-1 rounded-lg border border-white/15 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-[#39FF14] focus:outline-none"
            />
            <a
              href={cobaltUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center justify-center rounded-lg px-4 py-3 text-sm font-bold uppercase tracking-wider transition ${
                ytValid ? "hover:brightness-110" : "cursor-not-allowed opacity-40"
              }`}
              style={{ backgroundColor: "#39FF14", color: "#050505" }}
              onClick={(e) => {
                if (!ytValid) e.preventDefault();
              }}
            >
              Télécharger ↗
            </a>
          </div>
          {youtubeUrl && !ytValid && (
            <p className="mt-2 text-xs text-red-400">Lien YouTube invalide (youtube.com / youtu.be)</p>
          )}

          <details className="mt-4 group">
            <summary className="cursor-pointer text-xs uppercase tracking-widest text-white/60 hover:text-[#39FF14]">
              Guide pas à pas ▾
            </summary>
            <ol className="mt-3 space-y-2 text-sm text-white/70">
              <li>
                <span className="mr-2 font-bold text-[#39FF14]">1.</span>
                Copie l'URL de la vidéo YouTube.
              </li>
              <li>
                <span className="mr-2 font-bold text-[#39FF14]">2.</span>
                Colle-la ci-dessus puis clique <b>Télécharger ↗</b> ({" "}
                <a href="https://cobalt.tools" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#39FF14]">
                  cobalt.tools
                </a>
                ).
              </li>
              <li>
                <span className="mr-2 font-bold text-[#39FF14]">3.</span>
                Choisis <b>MP4 720p ou 1080p</b> puis <b>Download</b>.
              </li>
              <li>
                <span className="mr-2 font-bold text-[#39FF14]">4.</span>
                Alternative :{" "}
                <a href={ssyoutubeUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[#39FF14]">
                  ssyoutube.com
                </a>{" "}
                ou{" "}
                <a href="https://y2mate.nu" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#39FF14]">
                  y2mate.nu
                </a>
                .
              </li>
              <li>
                <span className="mr-2 font-bold text-[#39FF14]">5.</span>
                Dépose le MP4 dans la zone ci-dessous ⬇
              </li>
            </ol>
          </details>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur">
          <div
            className="mb-4 text-xl"
            style={{ fontFamily: "Bebas Neue, Impact, sans-serif", color: "#39FF14", letterSpacing: "0.06em" }}
          >
            2 · DÉPOSE LE FICHIER
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/20 bg-black/30 px-6 py-12 text-center transition hover:border-[#39FF14]/60 hover:bg-[#39FF14]/5"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <div className="text-4xl">🎬</div>
            <div className="text-lg font-semibold">
              {file ? file.name : "Dépose ta vidéo ici"}
            </div>
            <div className="text-xs text-white/50">
              {file
                ? `${(file.size / 1024 / 1024).toFixed(1)} Mo${duration ? ` · ${fmtTime(duration)}` : ""} — touche pour changer`
                : "MP4 / MOV / WEBM · max 500 Mo"}
            </div>
            <span
              className="mt-2 inline-block rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wider"
              style={{ backgroundColor: "#39FF14", color: "#050505" }}
            >
              Choisir un fichier
            </span>
          </div>
          <input
            id="video-input"
            ref={inputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/*"
            className="sr-only"
            onChange={(e) => {
              void handleFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </section>

        {file && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur">
            <div
              className="mb-4 text-xl"
              style={{ fontFamily: "Bebas Neue, Impact, sans-serif", color: "#39FF14", letterSpacing: "0.06em" }}
            >
              3 · PERSONNALISATION
            </div>

            {/* FONT */}
            <div className="mb-6">
              <div className="mb-2 text-sm uppercase tracking-widest text-white/60">Police</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(FONT_OPTIONS) as FontKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={busy}
                    onClick={() => setFontKey(k)}
                    className={`rounded-lg border px-3 py-3 text-center transition ${
                      fontKey === k
                        ? "border-[#39FF14] bg-[#39FF14]/10"
                        : "border-white/10 bg-black/30 hover:border-white/30"
                    }`}
                  >
                    <div
                      className="text-2xl leading-none"
                      style={{ fontFamily: fontPreviewFamily[k], letterSpacing: "0.04em" }}
                    >
                      Aa
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-white/60">
                      {FONT_OPTIONS[k].label}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* COLORS */}
            <div className="mb-6">
              <div className="mb-2 text-sm uppercase tracking-widest text-white/60">Couleurs</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(COLOR_PRESETS) as ColorPresetKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={busy}
                    onClick={() => setColorPreset(k)}
                    className={`rounded-lg border p-2 text-left transition ${
                      colorPreset === k
                        ? "border-[#39FF14] bg-[#39FF14]/10"
                        : "border-white/10 bg-black/30 hover:border-white/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-6 w-6 rounded"
                        style={{
                          backgroundColor: COLOR_PRESETS[k].text,
                          boxShadow: `0 0 0 2px ${COLOR_PRESETS[k].outline}`,
                        }}
                      />
                      <span className="text-[10px] uppercase tracking-wider text-white/70">
                        {COLOR_PRESETS[k].label}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {colorPreset === "custom" && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="h-8 w-10 cursor-pointer bg-transparent"
                      disabled={busy}
                    />
                    <span className="text-xs uppercase tracking-wider text-white/70">Texte</span>
                    <span className="ml-auto text-xs text-white/50">{textColor}</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                    <input
                      type="color"
                      value={outlineColor}
                      onChange={(e) => setOutlineColor(e.target.value)}
                      className="h-8 w-10 cursor-pointer bg-transparent"
                      disabled={busy}
                    />
                    <span className="text-xs uppercase tracking-wider text-white/70">Contour</span>
                    <span className="ml-auto text-xs text-white/50">{outlineColor}</span>
                  </label>
                </div>
              )}
            </div>

            {/* POSITION */}
            <div className="mb-6">
              <div className="mb-2 text-sm uppercase tracking-widest text-white/60">
                Position des sous-titres
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["top", "middle", "bottom"] as SubtitlePosition[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={busy}
                    onClick={() => setPosition(p)}
                    className={`rounded-lg border p-3 transition ${
                      position === p
                        ? "border-[#39FF14] bg-[#39FF14]/10"
                        : "border-white/10 bg-black/30 hover:border-white/30"
                    }`}
                  >
                    <div className="relative mx-auto flex h-16 w-9 flex-col justify-between rounded border border-white/20 bg-black/50 p-1">
                      <div
                        className={`h-1.5 rounded ${p === "top" ? "bg-[#39FF14]" : "bg-white/10"}`}
                      />
                      <div
                        className={`mx-auto h-1.5 w-full rounded ${p === "middle" ? "bg-[#39FF14]" : "bg-white/10"}`}
                      />
                      <div
                        className={`h-1.5 rounded ${p === "bottom" ? "bg-[#39FF14]" : "bg-white/10"}`}
                      />
                    </div>
                    <div className="mt-2 text-center text-xs uppercase tracking-wider text-white/70">
                      {p === "top" ? "Haut" : p === "middle" ? "Milieu" : "Bas"}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* PREVIEW */}
            <div className="mb-6">
              <div className="mb-2 text-sm uppercase tracking-widest text-white/60">Aperçu</div>
              <div className="relative mx-auto flex aspect-[9/16] w-40 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-neutral-800 to-neutral-900">
                <span
                  className={`absolute left-2 right-2 text-center text-lg font-bold leading-tight ${
                    position === "top"
                      ? "top-4"
                      : position === "middle"
                        ? "top-1/2 -translate-y-1/2"
                        : "bottom-4"
                  }`}
                  style={{
                    fontFamily: fontPreviewFamily[fontKey],
                    color: textColor,
                    WebkitTextStroke: `2px ${outlineColor}`,
                    textShadow: `0 0 8px ${outlineColor}`,
                    letterSpacing: "0.04em",
                  }}
                >
                  TON TEXTE ICI
                </span>
              </div>
            </div>
          </section>
        )}

        {file && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur">
            <div
              className="mb-4 text-xl"
              style={{ fontFamily: "Bebas Neue, Impact, sans-serif", color: "#39FF14", letterSpacing: "0.06em" }}
            >
              4 · DÉCOUPE
            </div>

            {/* MODE */}
            <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/30 p-1">
              <Button
                type="button"
                variant={!manualMode ? "default" : "ghost"}
                onClick={() => setManualMode(false)}
                disabled={busy}
                className="h-auto py-2"
                style={!manualMode ? { backgroundColor: "#39FF14", color: "#050505" } : undefined}
              >
                Auto
              </Button>
              <Button
                type="button"
                variant={manualMode ? "default" : "ghost"}
                onClick={() => setManualMode(true)}
                disabled={busy}
                className="h-auto py-2"
                style={manualMode ? { backgroundColor: "#39FF14", color: "#050505" } : undefined}
              >
                Segments manuels
              </Button>
            </div>

            {!manualMode ? (
              <>
                {/* TRIM */}
                <div className="mb-6">
                  <div className="mb-2 flex items-baseline justify-between">
                    <label className="text-sm uppercase tracking-widest text-white/60">
                      Découpe globale
                    </label>
                    <span className="text-xs text-white/50">
                      {fmtTime(trimStart)} → {fmtTime(trimEnd)}{" "}
                      <span className="text-white/30">({fmtTime(usableDur)} utiles)</span>
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 text-xs text-white/50">Début : {fmtTime(trimStart)}</div>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(0, duration - 5)}
                        step={1}
                        value={trimStart}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setTrimStart(Math.min(v, trimEnd - 5));
                        }}
                        className="w-full accent-[#39FF14]"
                        disabled={busy}
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-white/50">Fin : {fmtTime(trimEnd)}</div>
                      <input
                        type="range"
                        min={5}
                        max={duration || 5}
                        step={1}
                        value={trimEnd}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setTrimEnd(Math.max(v, trimStart + 5));
                        }}
                        className="w-full accent-[#39FF14]"
                        disabled={busy}
                      />
                    </div>
                  </div>
                </div>

                {/* SEGMENT LENGTH */}
                <div className="mb-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <label className="text-sm uppercase tracking-widest text-white/60">
                      Durée par short
                    </label>
                    <span
                      className="text-2xl font-bold"
                      style={{ fontFamily: "Bebas Neue, Impact, sans-serif", color: "#39FF14" }}
                    >
                      {segmentSec}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={90}
                    step={5}
                    value={segmentSec}
                    onChange={(e) => setSegmentSec(Number(e.target.value))}
                    className="w-full accent-[#39FF14]"
                    disabled={busy}
                  />
                  <div className="mt-1 flex justify-between text-xs text-white/40">
                    <span>30s</span>
                    <span>60s</span>
                    <span>90s</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="mb-4">
                <div className="mb-2 text-sm uppercase tracking-widest text-white/60">
                  Segments (un par ligne, format <b>début-fin</b> en secondes ou <b>mm:ss</b>)
                </div>
                <textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder={"0:30-1:45\n2:00-3:15\n5:00-6:20"}
                  rows={6}
                  disabled={busy}
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:border-[#39FF14] focus:outline-none"
                />
              </div>
            )}

            <div className="rounded-lg border border-[#39FF14]/20 bg-[#39FF14]/5 px-3 py-2 text-xs text-white/70">
              {estimatedShorts} short{estimatedShorts > 1 ? "s" : ""} seront générés
            </div>
          </section>
        )}

        {file && (
          <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur">
            <div
              className="mb-4 text-xl"
              style={{ fontFamily: "Bebas Neue, Impact, sans-serif", color: "#39FF14", letterSpacing: "0.06em" }}
            >
              5 · RENDU
            </div>

            <div className="mb-4">
              <div className="mb-2 text-sm uppercase tracking-widest text-white/60">Vitesse de rendu</div>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/30 p-1">
                <Button
                  type="button"
                  variant={renderMode === "fast" ? "default" : "ghost"}
                  onClick={() => setRenderMode("fast")}
                  disabled={busy}
                  className="h-auto flex-col gap-1 px-3 py-3 text-left"
                  style={
                    renderMode === "fast"
                      ? { backgroundColor: "#39FF14", color: "#050505" }
                      : undefined
                  }
                >
                  <span className="text-sm font-bold uppercase tracking-wider">Rapide mobile</span>
                  <span className="text-xs font-normal opacity-70">720×1280 · plus léger</span>
                </Button>
                <Button
                  type="button"
                  variant={renderMode === "quality" ? "default" : "ghost"}
                  onClick={() => setRenderMode("quality")}
                  disabled={busy}
                  className="h-auto flex-col gap-1 px-3 py-3 text-left"
                  style={
                    renderMode === "quality"
                      ? { backgroundColor: "#39FF14", color: "#050505" }
                      : undefined
                  }
                >
                  <span className="text-sm font-bold uppercase tracking-wider">Qualité</span>
                  <span className="text-xs font-normal opacity-70">1080×1920 · plus lent</span>
                </Button>
              </div>
            </div>

            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-sm uppercase tracking-widest text-white/60">
                <span>Débit Gemini (quotas)</span>
                <span className="text-[10px] normal-case tracking-normal text-white/40">
                  évite les erreurs 429 sur grosses vidéos
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-black/30 p-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-widest text-white/50">
                    Appels simultanés max
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={maxConcurrent}
                    onChange={(e) => setMaxConcurrent(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                    disabled={busy}
                    className="h-10 rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-[#39FF14]"
                  />
                  <span className="text-[10px] text-white/40">1 – 16 (recommandé : 4)</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-widest text-white/50">
                    Quota par minute (RPM)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={300}
                    value={rpm}
                    onChange={(e) => setRpm(Math.max(1, Math.min(300, Number(e.target.value) || 1)))}
                    disabled={busy}
                    className="h-10 rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-[#39FF14]"
                  />
                  <span className="text-[10px] text-white/40">requêtes / 60 s (recommandé : 30)</span>
                </label>
              </div>
            </div>



            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <Button
                onClick={() => run(false)}
                disabled={!file || busy || estimatedShorts === 0}
                className="h-14 w-full text-base font-bold uppercase tracking-widest disabled:opacity-40"
                style={{
                  backgroundColor: "#39FF14",
                  color: "#050505",
                  boxShadow: busy ? "none" : "0 0 24px rgba(57,255,20,0.5)",
                }}
              >
                {busy ? "Traitement en cours…" : `Générer ${estimatedShorts} short${estimatedShorts > 1 ? "s" : ""}`}
              </Button>
              <Button
                type="button"
                onClick={() => run(true)}
                disabled={!file || busy}
                variant="outline"
                className="h-14 border-[#39FF14]/60 bg-transparent text-base font-bold uppercase tracking-widest text-[#39FF14] hover:bg-[#39FF14]/10 hover:text-[#39FF14] disabled:opacity-40"
              >
                ⚡ Aperçu 8s
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs text-white/40">
                L'aperçu génère un extrait rapide de 8 s (720p) au début de la découpe pour valider le style des sous-titres avant le rendu complet. Les extractions audio et transcriptions sont mises en cache : relancer un rendu sur le même fichier saute directement au rendu.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  await clearSegmentCache();
                  setStatus("Cache vidé (audio + transcriptions)");
                }}
                className="shrink-0 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
              >
                Vider le cache
              </button>
            </div>


            {(status || error) && (
              <div className="mt-4 rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-sm">
                {error ? (
                  <span className="text-red-400">⚠ {error}</span>
                ) : (
                  <span className="text-white/80">
                    {status}
                    {progress && (
                      <span className="ml-2 text-white/50">
                        ({progress.i}/{progress.total})
                      </span>
                    )}
                  </span>
                )}
              </div>
            )}

            <Dashboard metrics={metrics} runStartMs={runStartMs} nowMs={nowMs} busy={busy} doneCount={shorts.length} onRetry={handleRetry} maxManualRetries={MAX_MANUAL_RETRIES} />
          </section>
        )}

        {shorts.length > 0 && (
          <section className="mt-12">
            <h3
              className="mb-6 text-3xl"
              style={{ fontFamily: "Bebas Neue, Impact, sans-serif", letterSpacing: "0.04em" }}
            >
              Tes shorts
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {shorts.map((s) => (
                <div
                  key={s.index}
                  className="overflow-hidden rounded-xl border border-white/10 bg-black/60"
                >
                  <div className="relative aspect-[9/16] bg-black">
                    <video
                      src={s.url}
                      controls
                      playsInline
                      className="h-full w-full object-contain"
                    />
                    <div className="absolute top-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-xs">
                      #{s.index + 1}
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 text-xs">
                    <span className="text-white/50">
                      {Math.round(s.startSec)}s → {Math.round(s.endSec)}s
                    </span>
                    <button
                      onClick={() => download(s)}
                      className="rounded-md px-3 py-1 font-semibold uppercase tracking-wider"
                      style={{ backgroundColor: "#39FF14", color: "#050505" }}
                    >
                      MP4
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-16 text-center text-xs text-white/30">
          Traitement local via ffmpeg.wasm · Transcription via Lovable AI Gateway
        </footer>
      </main>
    </div>
  );
}

function Dashboard({
  metrics,
  runStartMs,
  nowMs,
  busy,
  doneCount,
  onRetry,
  maxManualRetries,
}: {
  metrics: Record<number, SegmentMetric>;
  runStartMs: number | null;
  nowMs: number;
  busy: boolean;
  doneCount: number;
  onRetry: (index: number) => void | Promise<void>;
  maxManualRetries: number;
}) {
  const rows = Object.values(metrics).sort((a, b) => a.index - b.index);
  if (rows.length === 0) return null;

  const total = rows.length;
  const done = rows.filter((r) => r.status === "done").length;
  const rendering = rows.filter((r) => r.status === "rendering").length;
  const transcribing = rows.filter((r) => r.status === "transcribing").length;
  const errors = rows.filter((r) => r.status === "error").length;

  const transcribeTimes = rows.map((r) => r.transcribeMs).filter((x): x is number => typeof x === "number");
  const renderTimes = rows.map((r) => r.renderMs).filter((x): x is number => typeof x === "number");
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const avgTranscribe = avg(transcribeTimes);
  const avgRender = avg(renderTimes);

  const elapsedSec = runStartMs ? Math.max(0.001, (nowMs - runStartMs) / 1000) : 0;
  const shortsPerMin = elapsedSec > 0 ? (doneCount / elapsedSec) * 60 : 0;
  const remaining = Math.max(0, total - done);
  const etaSec = shortsPerMin > 0 ? (remaining / shortsPerMin) * 60 : 0;

  const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
  const fmtEta = (s: number) => {
    if (!isFinite(s) || s <= 0) return "—";
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const statusColor: Record<SegmentMetric["status"], string> = {
    pending: "bg-white/10 text-white/40",
    transcribing: "bg-blue-500/20 text-blue-300",
    rendering: "bg-yellow-500/20 text-yellow-300",
    retrying: "bg-orange-500/20 text-orange-300",
    done: "bg-[#39FF14]/20 text-[#39FF14]",
    error: "bg-red-500/20 text-red-300",
  };
  const statusLabel: Record<SegmentMetric["status"], string> = {
    pending: "En attente",
    transcribing: "Transcription",
    rendering: "Rendu",
    retrying: "Reprise…",
    done: "Prêt",
    error: "Erreur",
  };

  const pctDone = total > 0 ? (done / total) * 100 : 0;

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/50 p-4">
      <div
        className="mb-3 text-sm uppercase tracking-widest text-white/60"
        style={{ fontFamily: "Bebas Neue, Impact, sans-serif", letterSpacing: "0.12em" }}
      >
        Tableau de bord
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Débit" value={`${shortsPerMin.toFixed(1)}`} unit="shorts/min" />
        <Kpi label="Progression" value={`${done}/${total}`} unit={`${pctDone.toFixed(0)}%`} />
        <Kpi label="Latence trans." value={fmtMs(avgTranscribe)} unit={`n=${transcribeTimes.length}`} />
        <Kpi label="Latence rendu" value={fmtMs(avgRender)} unit={`n=${renderTimes.length}`} />
      </div>

      {/* Bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full transition-all"
          style={{
            width: `${pctDone}%`,
            backgroundColor: "#39FF14",
            boxShadow: "0 0 12px rgba(57,255,20,0.6)",
          }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
        <span>⏱ Écoulé : {fmtEta(elapsedSec)}</span>
        <span>⌛ ETA : {busy ? fmtEta(etaSec) : "—"}</span>
        <span>🎬 Rendu en cours : {rendering}</span>
        <span>🗣 Transcriptions : {transcribing}</span>
        {errors > 0 && <span className="text-red-300">⚠ Erreurs : {errors}</span>}
      </div>

      {/* Per-segment table */}
      <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-white/5">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-black/80 text-white/40">
            <tr>
              <th className="px-2 py-1.5 font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">Statut</th>
              <th className="px-2 py-1.5 text-right font-medium">Transcription</th>
              <th className="px-2 py-1.5 text-right font-medium">Rendu</th>
              <th className="px-2 py-1.5 text-right font-medium">Cues</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.index} className="border-t border-white/5">
                <td className="px-2 py-1.5 font-mono text-white/60">{r.index + 1}</td>
                <td className="px-2 py-1.5">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${statusColor[r.status]}`}
                  >
                    {statusLabel[r.status]}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-white/70">
                  {r.transcribeMs ? fmtMs(r.transcribeMs) : "—"}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-white/70">
                  {r.renderMs ? fmtMs(r.renderMs) : "—"}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-white/50">
                  {r.cueCount ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
      <div
        className="mt-0.5 text-xl leading-none"
        style={{ fontFamily: "Bebas Neue, Impact, sans-serif", color: "#39FF14" }}
      >
        {value}
      </div>
      {unit && <div className="mt-1 text-[10px] text-white/40">{unit}</div>}
    </div>
  );
}
