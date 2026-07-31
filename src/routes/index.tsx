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
import {
  analyzeViralMoments,
  MIN_SHORT_SEC,
  MAX_SHORT_SEC,
  type ViralMoment,
} from "@/lib/viral-detect";
import { runStallSelfTest } from "@/lib/render-selftest";
import { isMobileDevice } from "@/lib/remote-render";
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
  const [ytLoading, setYtLoading] = useState(false);
  const [ytProgress, setYtProgress] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<Record<number, SegmentMetric>>({});
  const [runStartMs, setRunStartMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [maxConcurrent, setMaxConcurrent] = useState(4);
  const [rpm, setRpm] = useState(30);
  const [wordByWord, setWordByWord] = useState(true);
  const [brandedFrame, setBrandedFrame] = useState(false);
  const [promoEnabled, setPromoEnabled] = useState(true);
  const [promoAt, setPromoAt] = useState(10);
  const [promoVoice, setPromoVoice] = useState<File | null>(null);
  const [promoVoiceDur, setPromoVoiceDur] = useState(0);
  const [zoomPunch, setZoomPunch] = useState(false);
  const [poolSize, setPoolSize] = useState(() => {
    if (typeof navigator === "undefined") return 2;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) return 1;
    return Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency ?? 4) / 2)));
  });
  // Encodage serveur : imposé sur mobile (ffmpeg.wasm y sature la mémoire).
  const [serverRender, setServerRender] = useState(false);
  const [stallTest, setStallTest] = useState<{ running: boolean; msg: string; ok: boolean | null }>({
    running: false,
    msg: "",
    ok: null,
  });
  const [mobileDevice, setMobileDevice] = useState(false);
  useEffect(() => {
    const m = isMobileDevice();
    setMobileDevice(m);
    if (m) setServerRender(true);
  }, []);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Détection multi-signal des moments forts ──────────────────────────────
  const [moments, setMoments] = useState<ViralMoment[]>([]);
  const [selectedMoments, setSelectedMoments] = useState<Set<string>>(new Set());
  const [momentCount, setMomentCount] = useState(5);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState("");



  // Live clock while busy so throughput/ETA update in real time
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [busy]);

  /** Auto-test du coupe-circuit : FFmpeg volontairement figé côté serveur. */
  async function handleStallTest() {
    setStallTest({ running: true, msg: "Simulation d'un FFmpeg figé (8 s)…", ok: null });
    try {
      const r = await runStallSelfTest(8000);
      const lines = [
        r.killed
          ? `Coupe-circuit déclenché après ${(r.elapsedMs / 1000).toFixed(1)} s (timeout ${(r.timeoutMs / 1000).toFixed(0)} s)`
          : `FFmpeg n'a pas été coupé (${r.detail || "aucune erreur remontée"})`,
        r.slotReleased
          ? `File libérée : ${r.activeRenders} rendu actif, ${r.queued} en attente`
          : `File toujours occupée : ${r.activeRenders} rendu actif`,
        r.queueFreeAfterMs >= 0
          ? `Service de nouveau disponible en ${r.queueFreeAfterMs} ms`
          : "Le service n'a pas confirmé sa disponibilité",
      ];
      setStallTest({ running: false, ok: r.ok, msg: lines.join(" · ") });
    } catch (e) {
      setStallTest({ running: false, ok: false, msg: (e as Error).message });
    }
  }

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
    const looksVideo =
      f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(f.name);
    if (!looksVideo) {
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

  const importFromYoutube = async () => {
    if (!ytValid || ytLoading) return;
    setError(null);
    setYtLoading(true);
    setYtProgress(0);
    try {
      const res = await fetch(`/api/youtube-mp4?url=${encodeURIComponent(youtubeUrl.trim())}`);
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const disp = res.headers.get("content-disposition") ?? "";
      const nameMatch = disp.match(/filename="?([^";]+)"?/i);
      const filename = nameMatch?.[1] ?? "youtube-video.mp4";
      const total = Number(res.headers.get("content-length") ?? 0);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Réponse vide");
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          if (total) setYtProgress(Math.min(1, received / total));
        }
      }
      const blob = new Blob(chunks as BlobPart[], { type: "video/mp4" });
      const f = new File([blob], filename, { type: "video/mp4" });
      await handleFile(f);
    } catch (e) {
      setError(`Import YouTube échoué: ${(e as Error).message}`);
    } finally {
      setYtLoading(false);
      setYtProgress(null);
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

  const chosenMoments = moments.filter((m) => selectedMoments.has(m.id));

  const analyze = useCallback(async () => {
    if (!file || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setAnalyzeStatus("Démarrage de l'analyse…");
    try {
      const res = await analyzeViralMoments({
        file,
        trim: { start: trimStart, end: trimEnd || duration },
        count: momentCount,
        throttle: { maxConcurrent, rpm },
        onProgress: (p) => setAnalyzeStatus(p),
        onLog: (m) => console.debug("[viral]", m),
      });
      setMoments(res);
      setSelectedMoments(new Set(res.map((m) => m.id)));
      setAnalyzeStatus(
        res.length ? `${res.length} moment${res.length > 1 ? "s" : ""} détecté${res.length > 1 ? "s" : ""}` : "Aucun moment détecté",
      );
    } catch (e) {
      setError(`Analyse échouée: ${(e as Error).message}`);
      setAnalyzeStatus("");
    } finally {
      setAnalyzing(false);
    }
  }, [file, analyzing, trimStart, trimEnd, duration, momentCount, maxConcurrent, rpm]);

  const updateMoment = (id: string, patch: { start?: number; end?: number }) => {
    setMoments((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const start = Math.max(0, patch.start ?? m.start);
        const rawEnd = patch.end ?? m.end;
        const end = Math.min(
          duration || rawEnd,
          Math.max(start + MIN_SHORT_SEC, Math.min(start + MAX_SHORT_SEC, rawEnd)),
        );
        return { ...m, start, end };
      }),
    );
  };

  const usableDur = Math.max(0, trimEnd - trimStart);
  const estimatedShorts = chosenMoments.length
    ? chosenMoments.length
    : manualMode
      ? parseManual().length
      : Math.max(1, Math.floor(usableDur / segmentSec));

  const run = useCallback(
    async (previewOnly = false) => {
      if (!file) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      setShorts([]);
      setMetrics({});
      setRunStartMs(Date.now());
      setNowMs(Date.now());
      setStatus(previewOnly ? "Aperçu…" : "Démarrage…");
      try {
        let custom: SegmentRange[] | undefined = chosenMoments.length
          ? chosenMoments.map((m) => ({ start: m.start, end: m.end }))
          : manualMode
            ? parseManual()
            : undefined;

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
          poolSize,
          remote: serverRender,

          wordByWord,
          brandedFrame,
          zoomPunch,
          promoPause: {
            enabled: promoEnabled && !!promoVoice,
            atSec: promoAt,
            durationSec: (promoVoiceDur || 4) + 1.4,
            voice: promoVoice,
          },

          signal: controller.signal,
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
        if ((e as Error).name === "AbortedError" || controller.signal.aborted) {
          setStatus("Traitement annulé");
          setError(null);
        } else {
          setError((e as Error).message);
          setStatus("");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
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
      moments,
      selectedMoments,


      maxConcurrent,
      rpm,
      poolSize,
      serverRender,

      wordByWord,
      brandedFrame,
      zoomPunch,
      promoEnabled,
      promoAt,
      promoVoice,
      promoVoiceDur,
    ],
  );

  type ExportState = {
    status: "working" | "done" | "error";
    message: string;
  };
  const [exportState, setExportState] = useState<Record<number, ExportState>>({});

  const download = async (s: Short) => {
    const name = `short_${String(s.index + 1).padStart(2, "0")}.mp4`;
    const set = (st: ExportState) => setExportState((p) => ({ ...p, [s.index]: st }));
    const sizeMb = (s.blob.size / (1024 * 1024)).toFixed(1);

    set({ status: "working", message: "Génération du MP4…" });
    try {
      if (!s.blob || s.blob.size === 0) {
        throw new Error("fichier vidéo vide, relance le rendu de ce segment");
      }

      // iOS/Safari ignore souvent l'attribut download sur un blob: URL.
      // On tente d'abord le partage natif (Enregistrer dans Photos / Fichiers).
      set({ status: "working", message: "Préparation du téléchargement…" });
      const f = new File([s.blob], name, { type: "video/mp4" });
      const nav = navigator as Navigator & {
        canShare?: (d: { files: File[] }) => boolean;
        share?: (d: { files: File[]; title?: string }) => Promise<void>;
      };
      if (nav.share && nav.canShare?.({ files: [f] })) {
        try {
          await nav.share({ files: [f], title: name });
          set({ status: "done", message: `${name} · ${sizeMb} Mo — enregistré ✓` });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            set({ status: "error", message: "Partage annulé" });
            return;
          }
          /* partage indisponible : on retombe sur le téléchargement classique */
        }
      }

      const url = URL.createObjectURL(s.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      set({ status: "done", message: `${name} · ${sizeMb} Mo — téléchargé ✓` });
    } catch (e) {
      set({
        status: "error",
        message: `Échec de l'export : ${(e as Error).message || "erreur inconnue"}`,
      });
    }
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
          wordByWord,
          brandedFrame,
          zoomPunch,
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
      wordByWord,
      brandedFrame,
      zoomPunch,
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
            <button
              type="button"
              onClick={importFromYoutube}
              disabled={!ytValid || ytLoading || busy}
              className={`inline-flex items-center justify-center rounded-lg px-4 py-3 text-sm font-bold uppercase tracking-wider transition ${
                ytValid && !ytLoading && !busy ? "hover:brightness-110" : "cursor-not-allowed opacity-40"
              }`}
              style={{ backgroundColor: "#39FF14", color: "#050505" }}
            >
              {ytLoading
                ? ytProgress != null
                  ? `Import ${Math.round(ytProgress * 100)}%`
                  : "Import…"
                : "Importer en MP4"}
            </button>
          </div>
          {youtubeUrl && !ytValid && (
            <p className="mt-2 text-xs text-red-400">Lien YouTube invalide (youtube.com / youtu.be)</p>
          )}
          {ytLoading && (
            <p className="mt-2 text-xs text-white/60">
              Conversion en cours via Piped (instance publique). Ça peut prendre 20-60 s selon la vidéo…
            </p>
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
            className="relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/20 bg-black/30 px-6 py-12 text-center transition hover:border-[#39FF14]/60 hover:bg-[#39FF14]/5"
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
            {/* input transparent au-dessus de toute la zone : fiable sur iOS/Android */}
            <input
              id="video-input"
              ref={inputRef}
              type="file"
              accept="video/*"
              aria-label="Choisir une vidéo"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              onChange={(e) => {
                void handleFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>

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
                Manuel
              </Button>
            </div>

            {/* ── DÉTECTION VIRALE MULTI-SIGNAL ─────────────────────────── */}
            <div className="mb-5 rounded-xl border border-[#FFE500]/30 bg-[#FFE500]/[0.04] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div
                    className="text-lg"
                    style={{ fontFamily: "Bebas Neue, Impact, sans-serif", color: "#FFE500", letterSpacing: "0.06em" }}
                  >
                    MOMENTS VIRAUX ✦
                  </div>
                  <p className="mt-1 text-xs text-white/60">
                    Score combiné : hooks du transcript (IA) + énergie audio locale + densité de mots
                    émotionnels. Chaque clip démarre pile sur la phrase choc, {MIN_SHORT_SEC}–{MAX_SHORT_SEC}s.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={3}
                    max={5}
                    value={momentCount}
                    onChange={(e) => setMomentCount(Math.max(3, Math.min(5, Number(e.target.value) || 3)))}
                    disabled={busy || analyzing}
                    className="w-16 rounded-md border border-white/15 bg-black/50 px-2 py-1 text-white"
                    aria-label="Nombre de moments"
                  />
                  <Button
                    type="button"
                    onClick={analyze}
                    disabled={busy || analyzing || !file}
                    className="h-auto py-2"
                    style={{ backgroundColor: "#FFE500", color: "#050505" }}
                  >
                    {analyzing ? "Analyse…" : "Analyser"}
                  </Button>
                </div>
              </div>

              {analyzeStatus && (
                <div className="mt-3 text-xs text-white/60">{analyzeStatus}</div>
              )}

              {moments.length > 0 && (
                <div className="mt-4 space-y-3">
                  {moments.map((m) => {
                    const on = selectedMoments.has(m.id);
                    return (
                      <div
                        key={m.id}
                        className={`rounded-lg border p-3 transition ${
                          on ? "border-[#FFE500]/60 bg-black/40" : "border-white/10 bg-black/20 opacity-70"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={busy}
                            onChange={() =>
                              setSelectedMoments((prev) => {
                                const next = new Set(prev);
                                if (next.has(m.id)) next.delete(m.id);
                                else next.add(m.id);
                                return next;
                              })
                            }
                            className="mt-1 h-4 w-4 accent-[#FFE500]"
                            aria-label={`Sélectionner le moment ${fmtTime(m.start)}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="rounded-md px-2 py-0.5 text-sm font-bold"
                                style={{ backgroundColor: "#FFE500", color: "#050505" }}
                              >
                                {m.score}
                              </span>
                              <span className="text-xs text-white/50">
                                hook {m.hookScore} · audio {m.audioScore} · émotion {m.emotionScore}
                              </span>
                              {m.reason && (
                                <span className="text-xs text-[#39FF14]/80">{m.reason}</span>
                              )}
                            </div>
                            {m.hookText && (
                              <p className="mt-2 text-sm text-white">« {m.hookText} »</p>
                            )}
                            {m.transcript && (
                              <p className="mt-1 line-clamp-2 text-xs text-white/45">{m.transcript}</p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/60">
                              <label>Début</label>
                              <input
                                type="number"
                                step={0.5}
                                min={0}
                                value={Number(m.start.toFixed(1))}
                                disabled={busy}
                                onChange={(e) => updateMoment(m.id, { start: Number(e.target.value) })}
                                className="w-20 rounded-md border border-white/15 bg-black/50 px-2 py-1 text-white"
                              />
                              <label>Fin</label>
                              <input
                                type="number"
                                step={0.5}
                                min={0}
                                value={Number(m.end.toFixed(1))}
                                disabled={busy}
                                onChange={(e) => updateMoment(m.id, { end: Number(e.target.value) })}
                                className="w-20 rounded-md border border-white/15 bg-black/50 px-2 py-1 text-white"
                              />
                              <span className="text-white/40">
                                {fmtTime(m.start)} → {fmtTime(m.end)} ({(m.end - m.start).toFixed(1)}s)
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between text-xs text-white/50">
                    <span>
                      {chosenMoments.length} moment{chosenMoments.length > 1 ? "s" : ""} sélectionné
                      {chosenMoments.length > 1 ? "s" : ""} — ils remplacent la découpe auto.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMoments([]);
                        setSelectedMoments(new Set());
                        setAnalyzeStatus("");
                      }}
                      disabled={busy}
                      className="underline hover:text-white"
                    >
                      Effacer
                    </button>
                  </div>
                </div>
              )}
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
                      <div className="mb-1 flex items-center gap-2 text-xs text-white/50">
                        <span>Début</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={Math.max(0, (duration || 36000) - 5)}
                          step={1}
                          value={Math.round(trimStart)}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value) || 0);
                            setTrimStart(Math.min(v, Math.max(0, (trimEnd || 5) - 5)));
                          }}
                          disabled={busy}
                          className="w-24 rounded border border-white/15 bg-black/40 px-2 py-1 text-sm text-white focus:border-[#39FF14] focus:outline-none"
                        />
                        <span>s · {fmtTime(trimStart)}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(1, duration - 5)}
                        step={1}
                        value={trimStart}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setTrimStart(Math.min(v, trimEnd - 5));
                        }}
                        className="w-full accent-[#39FF14]"
                        disabled={busy || !duration}
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-xs text-white/50">
                        <span>Fin</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={5}
                          max={duration || 36000}
                          step={1}
                          value={Math.round(trimEnd)}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            const cap = duration ? Math.min(v, duration) : v;
                            setTrimEnd(Math.max(cap, trimStart + 5));
                          }}
                          disabled={busy}
                          className="w-24 rounded border border-white/15 bg-black/40 px-2 py-1 text-sm text-white focus:border-[#39FF14] focus:outline-none"
                        />
                        <span>s · {fmtTime(trimEnd)}</span>
                      </div>
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
                        disabled={busy || !duration}
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
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-black/30 p-1">
                <Button
                  type="button"
                  variant={renderMode === "fast" ? "default" : "ghost"}
                  onClick={() => setRenderMode("fast")}
                  disabled={busy}
                  className="h-auto flex-col gap-1 px-3 py-3 text-left"
                  style={renderMode === "fast" ? { backgroundColor: "#39FF14", color: "#050505" } : undefined}
                >
                  <span className="text-sm font-bold uppercase tracking-wider">Rapide</span>
                  <span className="text-xs font-normal opacity-70">720p · léger</span>
                </Button>
                <Button
                  type="button"
                  variant={renderMode === "quality" ? "default" : "ghost"}
                  onClick={() => setRenderMode("quality")}
                  disabled={busy}
                  className="h-auto flex-col gap-1 px-3 py-3 text-left"
                  style={renderMode === "quality" ? { backgroundColor: "#39FF14", color: "#050505" } : undefined}
                >
                  <span className="text-sm font-bold uppercase tracking-wider">Qualité</span>
                  <span className="text-xs font-normal opacity-70">1080p · CRF 26</span>
                </Button>
                <Button
                  type="button"
                  variant={renderMode === "premium" ? "default" : "ghost"}
                  onClick={() => setRenderMode("premium")}
                  disabled={busy}
                  className="h-auto flex-col gap-1 px-3 py-3 text-left"
                  style={renderMode === "premium" ? { backgroundColor: "#39FF14", color: "#050505" } : undefined}
                >
                  <span className="text-sm font-bold uppercase tracking-wider">Premium ✦</span>
                  <span className="text-xs font-normal opacity-70">1080p · CRF 19 · 192k</span>
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

            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-sm uppercase tracking-widest text-white/60">
                <span>Moteur d'encodage</span>
                <span className="text-[10px] normal-case tracking-normal text-white/40">
                  {mobileDevice ? "mobile détecté" : "ordinateur détecté"}
                </span>
              </div>
              <div className="mb-3 rounded-xl border border-white/10 bg-black/30 p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={serverRender}
                    onChange={(e) => setServerRender(e.target.checked)}
                    disabled={busy || mobileDevice}
                    className="mt-1 accent-[#39FF14]"
                  />
                  <span className="text-xs text-white/70">
                    Rendu sur le serveur ✦
                    <span className="mt-1 block text-[10px] text-white/40">
                      {mobileDevice
                        ? "Activé d'office sur mobile : l'encodage part sur le serveur ffmpeg, ton téléphone ne fait plus que l'upload et le téléchargement."
                        : "Décoché, l'encodage reste dans ton navigateur (gratuit). Coché, il part sur le serveur ffmpeg (plus rapide, aucune limite mémoire)."}
                    </span>
                  </span>
                </label>
              </div>

              <div className="mb-3 rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-white/70">
                    Test conversion ✦
                    <span className="mt-1 block text-[10px] text-white/40">
                      Simule un FFmpeg bloqué sur le serveur et vérifie que le coupe-circuit tue le
                      processus et rend la file disponible.
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleStallTest}
                    disabled={busy || stallTest.running}
                    className="h-auto border border-[#39FF14]/40 py-2 text-xs"
                  >
                    {stallTest.running ? "Test en cours…" : "Test conversion"}
                  </Button>
                </div>
                {stallTest.msg && (
                  <div
                    className="mt-3 rounded-lg border p-2 text-[11px]"
                    style={{
                      borderColor: stallTest.ok === false ? "rgba(255,80,80,0.4)" : "rgba(57,255,20,0.4)",
                      color: stallTest.ok === false ? "#FF6B6B" : "#39FF14",
                    }}
                  >
                    {stallTest.ok === null ? "" : stallTest.ok ? "✅ " : "⚠️ "}
                    {stallTest.msg}
                  </div>
                )}
              </div>

              <div className="mb-2 flex items-center justify-between text-sm uppercase tracking-widest text-white/60">
                <span>Pool de rendu FFmpeg</span>
                <span className="text-[10px] normal-case tracking-normal text-white/40">
                  {serverRender ? "rendus simultanés côté serveur" : "workers parallèles dans ton navigateur"}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-widest text-white/50">
                    Nombre de workers ({poolSize})
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={1}
                    value={poolSize}
                    onChange={(e) => setPoolSize(Number(e.target.value))}
                    disabled={busy}
                    className="accent-[#39FF14]"
                  />
                  <div className="flex justify-between text-[10px] text-white/40">
                    <span>1 (mobile)</span>
                    <span>2</span>
                    <span>3</span>
                    <span>4 (desktop)</span>
                  </div>
                  <span className="mt-1 text-[10px] text-white/40">
                    Chaque worker charge ~30 Mo de WASM + la vidéo en mémoire. Baisse à 1–2 si ton navigateur plante.
                  </span>
                </label>
              </div>
            </div>

            <div className="mb-4">
              <div className="mb-2 text-sm uppercase tracking-widest text-white/60">Style Premium TikTokBoost</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <ToggleTile
                  active={wordByWord}
                  disabled={busy}
                  onClick={() => setWordByWord((v) => !v)}
                  title="Mot par mot"
                  desc="Sous-titres pop-in, mots-clés jaunes"
                />
                <ToggleTile
                  active={brandedFrame}
                  disabled={busy}
                  onClick={() => setBrandedFrame((v) => !v)}
                  title="Cadre jaune ✦"
                  desc="Bordure signature TikTokBoost"
                />
                <ToggleTile
                  active={zoomPunch}
                  disabled={busy}
                  onClick={() => setZoomPunch((v) => !v)}
                  title="Zoom kinétique"
                  desc="Léger zoom continu (+30% rendu)"
                />
              </div>
            </div>



            <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm uppercase tracking-widest text-white/60">Pause promo + voix off</div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPromoEnabled((v) => !v)}
                  className="rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest"
                  style={{
                    borderColor: promoEnabled ? "#39FF14" : "rgba(255,255,255,0.2)",
                    color: promoEnabled ? "#39FF14" : "rgba(255,255,255,0.6)",
                  }}
                >
                  {promoEnabled ? "Activée" : "Désactivée"}
                </button>
              </div>
              <p className="mb-3 text-xs text-white/50">
                La vidéo se fige à l'instant choisi, ta voix off énonce le message, puis la vidéo reprend.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col text-xs text-white/70">
                  <span className="mb-1">Pause à {promoAt}s du short</span>
                  <input
                    type="range"
                    min={3}
                    max={40}
                    step={1}
                    value={promoAt}
                    disabled={busy || !promoEnabled}
                    onChange={(e) => setPromoAt(Number(e.target.value))}
                    className="accent-[#39FF14]"
                  />
                </label>
                <label className="flex flex-col text-xs text-white/70">
                  <span className="mb-1">
                    Voix off {promoVoice ? `— ${promoVoice.name} (${promoVoiceDur.toFixed(1)}s)` : "(mp3 / wav)"}
                  </span>
                  <input
                    type="file"
                    accept="audio/mpeg,audio/mp3,audio/wav,audio/*"
                    disabled={busy || !promoEnabled}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setPromoVoice(f);
                      setPromoVoiceDur(0);
                      if (f) {
                        const a = new Audio(URL.createObjectURL(f));
                        a.addEventListener("loadedmetadata", () => {
                          if (Number.isFinite(a.duration)) setPromoVoiceDur(a.duration);
                        });
                      }
                    }}
                    className="text-xs text-white/60 file:mr-3 file:rounded-full file:border-0 file:bg-[#39FF14] file:px-3 file:py-1 file:text-xs file:font-bold file:text-black"
                  />
                </label>
              </div>
              {promoEnabled && !promoVoice && (
                <p className="mt-2 text-xs text-yellow-300/80">
                  Dépose un fichier audio pour activer la pause.
                </p>
              )}
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
              {busy ? (
                <Button
                  type="button"
                  onClick={() => {
                    abortRef.current?.abort();
                    setStatus("Annulation…");
                  }}
                  className="h-14 border border-red-500/60 bg-red-500/10 text-base font-bold uppercase tracking-widest text-red-300 hover:bg-red-500/20"
                >
                  ⏹ Annuler
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => run(true)}
                  disabled={!file}
                  variant="outline"
                  className="h-14 border-[#39FF14]/60 bg-transparent text-base font-bold uppercase tracking-widest text-[#39FF14] hover:bg-[#39FF14]/10 hover:text-[#39FF14] disabled:opacity-40"
                >
                  ⚡ Aperçu 8s
                </Button>
              )}

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

            <Dashboard metrics={metrics} runStartMs={runStartMs} nowMs={nowMs} busy={busy} doneCount={shorts.length} onRetry={handleRetry} maxManualRetries={MAX_MANUAL_RETRIES} serverRender={serverRender} />
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
                    {typeof s.qualityScore === "number" && (
                      <div
                        className="absolute top-2 right-2 rounded-full px-2 py-0.5 text-[11px] font-bold"
                        style={{
                          backgroundColor:
                            s.qualityScore >= 75 ? "#39FF14" : s.qualityScore >= 55 ? "#FFE500" : "#FF6B6B",
                          color: "#050505",
                          boxShadow:
                            s.qualityScore >= 75
                              ? "0 0 10px rgba(57,255,20,0.6)"
                              : "0 0 8px rgba(0,0,0,0.4)",
                        }}
                        title={`Quality Score — cues: ${s.cueCount ?? 0}`}
                      >
                        {s.qualityScore}/100
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between p-3 text-xs">
                    <span className="text-white/50">
                      {Math.round(s.startSec)}s → {Math.round(s.endSec)}s
                    </span>
                    <button
                      onClick={() => void download(s)}
                      disabled={exportState[s.index]?.status === "working"}
                      className="rounded-md px-3 py-1 font-semibold uppercase tracking-wider disabled:opacity-60"
                      style={{ backgroundColor: "#39FF14", color: "#050505" }}
                    >
                      {exportState[s.index]?.status === "working" ? "Export…" : "MP4"}
                    </button>
                  </div>
                  {exportState[s.index] && (
                    <div
                      className="px-3 pb-3 text-[11px] leading-snug"
                      role="status"
                      aria-live="polite"
                      style={{
                        color:
                          exportState[s.index]!.status === "error"
                            ? "#FF6B6B"
                            : exportState[s.index]!.status === "done"
                              ? "#39FF14"
                              : "rgba(255,255,255,0.6)",
                      }}
                    >
                      {exportState[s.index]!.message}
                    </div>
                  )}

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

function ToggleTile({
  active,
  disabled,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition disabled:opacity-40 ${
        active
          ? "border-[#39FF14] bg-[#39FF14]/10"
          : "border-white/10 bg-black/30 hover:border-white/30"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold uppercase tracking-wider">{title}</span>
        <span
          className={`h-4 w-4 rounded-full border ${
            active ? "border-[#39FF14] bg-[#39FF14]" : "border-white/30"
          }`}
        />
      </div>
      <div className="mt-1 text-[11px] text-white/60">{desc}</div>
    </button>
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
  serverRender,

}: {
  metrics: Record<number, SegmentMetric>;
  runStartMs: number | null;
  nowMs: number;
  busy: boolean;
  doneCount: number;
  onRetry: (index: number) => void | Promise<void>;
  maxManualRetries: number;
  serverRender: boolean;

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
              <th className="px-2 py-1.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const manualCount = r.manualAttempts ?? 0;
              // La reprise manuelle utilise ffmpeg.wasm local : on la masque en
              // rendu serveur (le pipeline retente déjà 3 fois côté serveur).
              const canRetry =
                r.status === "error" && manualCount < maxManualRetries && !busy && !serverRender;

              const retryExhausted = r.status === "error" && manualCount >= maxManualRetries;
              return (
                <tr key={r.index} className="border-t border-white/5" title={r.lastError ?? undefined}>
                  <td className="px-2 py-1.5 font-mono text-white/60">{r.index + 1}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${statusColor[r.status]}`}
                    >
                      {statusLabel[r.status]}
                    </span>
                    {manualCount > 0 && (
                      <span className="ml-1 text-[10px] text-white/40">×{manualCount}</span>
                    )}
                    {r.status === "error" && r.lastError && (
                      <div className="mt-1 max-w-48 break-words text-[9px] normal-case text-red-300/70">
                        {r.lastError}
                      </div>
                    )}
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
                  <td className="px-2 py-1.5 text-right">
                    {canRetry ? (
                      <button
                        type="button"
                        onClick={() => onRetry(r.index)}
                        className="rounded border border-[#39FF14]/40 bg-[#39FF14]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#39FF14] hover:bg-[#39FF14]/20"
                      >
                        Relancer ({maxManualRetries - manualCount})
                      </button>
                    ) : retryExhausted ? (
                      <span className="text-[10px] text-red-300/70">Épuisé</span>
                    ) : (
                      <span className="text-[10px] text-white/20">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
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
