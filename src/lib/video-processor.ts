import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { transcribeSegment, type Cue } from "./transcribe.functions";
import { geminiThrottle, type ThrottleOptions } from "./gemini-throttle";
import {
  getCachedAudio,
  setCachedAudio,
  getCachedCues,
  setCachedCues,
  sourceFingerprint,
} from "./segment-cache";
import { FFmpegPool, suggestedPoolSize } from "./ffmpeg-pool";
export { clearSegmentCache } from "./segment-cache";
export { suggestedPoolSize } from "./ffmpeg-pool";


const CORE_VERSION = "0.12.10";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export type ProgressCallback = (info: {
  phase: string;
  segmentIndex?: number;
  totalSegments?: number;
  progress?: number;
}) => void;

export type RenderMode = "fast" | "quality" | "premium";

export type FontKey = "bebas" | "anton" | "montserrat" | "impact";

export const FONT_OPTIONS: Record<
  FontKey,
  { label: string; assName: string; file: string; url: string }
> = {
  bebas: {
    label: "Bebas Neue",
    assName: "Bebas Neue",
    file: "BebasNeue-Regular.ttf",
    url: "/fonts/BebasNeue-Regular.ttf",
  },
  anton: {
    label: "Anton",
    assName: "Anton",
    file: "Anton-Regular.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf",
  },
  montserrat: {
    label: "Montserrat Black",
    assName: "Montserrat",
    file: "Montserrat.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf",
  },
  impact: {
    label: "Impact (Oswald)",
    assName: "Oswald",
    file: "Oswald.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/Oswald%5Bwght%5D.ttf",
  },
};

export type SubtitlePosition = "top" | "middle" | "bottom";

export type SubtitleStyle = {
  fontKey: FontKey;
  textColor: string; // #RRGGBB
  outlineColor: string; // #RRGGBB
  position: SubtitlePosition;
};

export type SegmentRange = { start: number; end: number };

// Mots à mettre en jaune pour créer des "power words" façon TikTok.
// Détection : mots >=6 lettres, chiffres, ou finissant par !/?
const POWER_WORD_ACCENT = "#FFE500";
function isPowerWord(w: string): boolean {
  const clean = w.replace(/[^\p{L}\p{N}!?]/gu, "");
  if (!clean) return false;
  if (/\d/.test(clean)) return true;
  if (/[!?]$/.test(clean)) return true;
  const letters = clean.replace(/[^\p{L}]/gu, "");
  return letters.length >= 6;
}

type RenderProfile = {
  width: number;
  height: number;
  bgWidth: number;
  bgHeight: number;
  blur: string;
  fontSize: number;
  outline: number;
  shadow: number;
  marginV: number;
  crf: string;
  audioBitrate: string;
  fps: number;
  preset: string;
};

const RENDER_PROFILES: Record<RenderMode, RenderProfile> = {
  fast: {
    width: 720, height: 1280, bgWidth: 360, bgHeight: 640,
    blur: "10:1", fontSize: 64, outline: 4, shadow: 3, marginV: 175,
    crf: "32", audioBitrate: "96k", fps: 30, preset: "ultrafast",
  },
  quality: {
    width: 1080, height: 1920, bgWidth: 540, bgHeight: 960,
    blur: "14:1", fontSize: 96, outline: 6, shadow: 4, marginV: 260,
    crf: "26", audioBitrate: "128k", fps: 30, preset: "veryfast",
  },
  premium: {
    width: 1080, height: 1920, bgWidth: 540, bgHeight: 960,
    blur: "18:2", fontSize: 104, outline: 7, shadow: 5, marginV: 280,
    crf: "19", audioBitrate: "192k", fps: 30, preset: "medium",
  },
};


export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const ff = new FFmpeg();
      if (onLog) ff.on("log", ({ message }) => onLog(message));
      await ff.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegInstance = ff;
      return ff;
    } catch (error) {
      loadPromise = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Impossible de charger le moteur vidéo sur cet appareil. Sur mobile, essaie Chrome/Safari à jour, désactive le mode économie d'énergie, ou utilise un ordinateur. Détail : ${message}`,
      );
    }
  })();

  return loadPromise;
}

// Convert #RRGGBB -> ASS &H00BBGGRR
function hexToAss(hex: string): string {
  const clean = hex.replace("#", "").padStart(6, "0").slice(0, 6);
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function alignmentFor(pos: SubtitlePosition): number {
  // ASS \an numpad: 2=bottom-center, 5=middle-center, 8=top-center
  if (pos === "top") return 8;
  if (pos === "middle") return 5;
  return 2;
}

function marginVFor(pos: SubtitlePosition, profile: RenderProfile): number {
  if (pos === "middle") return 0;
  // top or bottom: same visual offset from edge
  return profile.marginV;
}

function buildAssFile(
  cues: Cue[],
  durationSec: number,
  profile: RenderProfile,
  style: SubtitleStyle,
): string {
  const font = FONT_OPTIONS[style.fontKey];
  const primary = hexToAss(style.textColor);
  const outline = hexToAss(style.outlineColor);
  const alignment = alignmentFor(style.position);
  const marginV = marginVFor(style.position, profile);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${profile.width}
PlayResY: ${profile.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Neon,${font.assName},${profile.fontSize},${primary},${primary},${outline},${outline},1,0,0,0,100,100,2,0,1,${profile.outline},${profile.shadow},${alignment},60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const fmtTime = (t: number): string => {
    const clamped = Math.max(0, Math.min(durationSec, t));
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    const s = Math.floor(clamped % 60);
    const cs = Math.floor((clamped - Math.floor(clamped)) * 100);
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
  };

  const escape = (t: string) =>
    t.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, " ");

  const events = cues
    .map(
      (c) =>
        `Dialogue: 0,${fmtTime(c.start)},${fmtTime(c.end)},Neon,,0,0,0,,{\\blur1.2}${escape(c.text)}`,
    )
    .join("\n");

  return header + events + "\n";
}

export type Short = {
  index: number;
  startSec: number;
  endSec: number;
  blob: Blob;
  url: string;
};

async function loadFontBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function computeSegments(
  durationSec: number,
  segmentSec: number,
  trim: { start: number; end: number },
  custom?: SegmentRange[],
): SegmentRange[] {
  if (custom && custom.length > 0) {
    return custom
      .map((s) => ({
        start: Math.max(0, Math.min(durationSec, s.start)),
        end: Math.max(0, Math.min(durationSec, s.end)),
      }))
      .filter((s) => s.end - s.start >= 5);
  }
  const from = Math.max(0, Math.min(durationSec, trim.start));
  const to = Math.max(from, Math.min(durationSec, trim.end || durationSec));
  const usable = to - from;
  const total = Math.max(1, Math.floor(usable / segmentSec));
  const out: SegmentRange[] = [];
  for (let i = 0; i < total; i++) {
    const start = from + i * segmentSec;
    const end = Math.min(to, start + segmentSec);
    if (end - start >= 10) out.push({ start, end });
  }
  return out;
}

export type SegmentMetric = {
  index: number;
  status: "pending" | "transcribing" | "rendering" | "done" | "error" | "retrying";
  transcribeMs?: number;
  renderMs?: number;
  cueCount?: number;
  attempts?: number;
  manualAttempts?: number;
  lastError?: string;
};

export type MetricsCallback = (m: SegmentMetric) => void;

const MAX_ATTEMPTS = 3;

export class AbortedError extends Error {
  constructor(message = "Traitement annulé") {
    super(message);
    this.name = "AbortedError";
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new AbortedError();
}

async function retry<T>(
  label: string,
  fn: (attempt: number) => Promise<T>,
  opts: {
    maxAttempts?: number;
    onRetry?: (attempt: number, err: Error) => void;
    onLog?: (msg: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const max = opts.maxAttempts ?? MAX_ATTEMPTS;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= max; attempt++) {
    throwIfAborted(opts.signal);
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e as Error;
      if (lastErr instanceof AbortedError || opts.signal?.aborted) throw lastErr;
      opts.onLog?.(`${label} — tentative ${attempt}/${max} échouée: ${lastErr.message}`);
      if (attempt < max) {
        opts.onRetry?.(attempt, lastErr);
        const wait = Math.min(6000, 400 * 3 ** (attempt - 1)) + Math.random() * 200;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr ?? new Error(`${label} failed`);
}


export async function processVideo(opts: {
  file: File;
  segmentSec: number;
  renderMode?: RenderMode;
  style: SubtitleStyle;
  trim?: { start: number; end: number };
  customSegments?: SegmentRange[];
  smart?: boolean;
  smartCount?: number;
  onProgress: ProgressCallback;
  onLog?: (msg: string) => void;
  onShort?: (short: Short) => void;
  onMetric?: MetricsCallback;
  throttle?: ThrottleOptions;
  poolSize?: number;
  signal?: AbortSignal;
}): Promise<Short[]> {
  const { file, segmentSec, onProgress, onLog, onShort, onMetric, style, signal } = opts;
  const profile = RENDER_PROFILES[opts.renderMode ?? "fast"];
  if (opts.throttle) geminiThrottle.configure(opts.throttle);

  const desiredPoolSize = Math.max(1, opts.poolSize ?? suggestedPoolSize());

  throwIfAborted(signal);
  onProgress({ phase: "Analyse de la durée" });
  const durationSec = await probeDuration(file);
  const trim = opts.trim ?? { start: 0, end: durationSec };
  let effectiveCustom = opts.customSegments;
  if (opts.smart && (!effectiveCustom || effectiveCustom.length === 0)) {
    onProgress({ phase: "Détection des moments forts (buzz)" });
    try {
      effectiveCustom = await detectBuzzHighlights(file, trim, segmentSec, opts.smartCount ?? 8, onLog);
      onLog?.(`Buzz: ${effectiveCustom?.length ?? 0} moments détectés`);

    } catch (e) {
      onLog?.(`Détection buzz échouée, fallback découpe séquentielle: ${(e as Error).message}`);
      effectiveCustom = undefined;
    }
  }
  const segments = computeSegments(durationSec, segmentSec, trim, effectiveCustom);
  const totalSegments = segments.length;
  if (totalSegments === 0) return [];


  throwIfAborted(signal);
  onProgress({ phase: "Chargement de la vidéo en mémoire" });
  const inputBytes = await file.arrayBuffer();


  onProgress({ phase: `Chargement des polices` });
  const fontsToLoad: Array<{ file: string; bytes: ArrayBuffer }> = [];
  const font = FONT_OPTIONS[style.fontKey];
  const primaryBytes = await loadFontBytes(font.url);
  fontsToLoad.push({ file: font.file, bytes: primaryBytes.slice().buffer as ArrayBuffer });
  if (style.fontKey !== "bebas") {
    try {
      const bebasBytes = await loadFontBytes(FONT_OPTIONS.bebas.url);
      fontsToLoad.push({ file: FONT_OPTIONS.bebas.file, bytes: bebasBytes.slice().buffer as ArrayBuffer });
    } catch { /* optional */ }
  }

  throwIfAborted(signal);
  onProgress({ phase: `Démarrage du pool (${desiredPoolSize} worker${desiredPoolSize > 1 ? "s" : ""})` });
  const pool = await FFmpegPool.create({
    size: desiredPoolSize,
    inputBytes,
    fonts: fontsToLoad,
    onLog: (idx, msg) => onLog?.(`[w${idx}] ${msg}`),
  });

  // Kill the pool as soon as the caller aborts — this rejects every in-flight
  // worker send with "pool terminated" and unblocks Promise.all below.
  const onAbort = () => {
    onLog?.("Annulation demandée — arrêt des workers");
    pool.terminate();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  for (let k = 0; k < totalSegments; k++) onMetric?.({ index: k, status: "pending" });

  const shorts: Short[] = [];
  const fingerprint = sourceFingerprint(file);
  let doneCount = 0;

  const runOne = async (i: number) => {
    if (signal?.aborted) return;
    const seg = segments[i];
    const dur = seg.end - seg.start;
    if (dur < 5) return;
    const t0 = performance.now();


    // ── transcription (with cache) ────────────────────────────────────────────
    onMetric?.({ index: i, status: "transcribing" });
    let cues: Cue[] = [];
    try {
      const cachedCues = await getCachedCues(fingerprint, seg.start, seg.end);
      if (cachedCues) {
        onLog?.(`Cache hit (cues) segment ${i + 1}`);
        cues = cachedCues;
      } else {
        let audioB64 = await getCachedAudio(fingerprint, seg.start, seg.end);
        if (audioB64) {
          onLog?.(`Cache hit (audio) segment ${i + 1}`);
        } else {
          audioB64 = await retry(
            `Extraction audio segment ${i + 1}`,
            async (attempt) => {
              if (attempt > 1) onMetric?.({ index: i, status: "retrying", attempts: attempt });
              const r = await pool.run<{ audioBase64: string }>((w) =>
                w.send({ type: "extract", index: i, start: seg.start, duration: dur }),
              );
              return r.audioBase64;
            },
            { onLog, signal },

          );
          void setCachedAudio(fingerprint, seg.start, seg.end, audioB64).catch(() => {});
        }
        const r = await retry(
          `Transcription segment ${i + 1}`,
          async (attempt) => {
            if (attempt > 1) onMetric?.({ index: i, status: "retrying", attempts: attempt });
            return geminiThrottle.run(() =>
              transcribeSegment({
                data: { audioBase64: audioB64!, mimeType: "audio/webm", durationSec: dur },
              }),
            );
          },
          { onLog, signal },

        );
        cues = r.cues;
        void setCachedCues(fingerprint, seg.start, seg.end, r.cues).catch(() => {});
      }
    } catch (e) {
      onLog?.(`Transcription abandonnée segment ${i + 1}: ${(e as Error).message}`);
      cues = [];
    }
    onMetric?.({
      index: i,
      status: "rendering",
      transcribeMs: performance.now() - t0,
      cueCount: cues.length,
    });

    // ── render (dispatched to any free worker) ────────────────────────────────
    try {
      const baseFilter = [
        "[0:v]split=2[bg][fg]",
        `[bg]scale=${profile.bgWidth}:${profile.bgHeight}:force_original_aspect_ratio=increase,crop=${profile.bgWidth}:${profile.bgHeight},boxblur=${profile.blur},scale=${profile.width}:${profile.height},eq=brightness=-0.1[bgblur]`,
        `[fg]scale=${profile.width}:-2[fgs]`,
        `[bgblur][fgs]overlay=(W-w)/2:(H-h)/2,fps=${profile.fps}[v]`,
      ];
      const filter = [
        ...baseFilter,
        cues.length > 0 ? `[v]subtitles=subs_${i}.ass:fontsdir=/fonts[vout]` : "[v]null[vout]",
      ].join(";");
      const ass = buildAssFile(cues, dur, profile, style);

      const renderT0 = performance.now();
      const res = await retry(
        `Rendu segment ${i + 1}`,
        async (attempt) => {
          if (attempt > 1) onMetric?.({ index: i, status: "retrying", attempts: attempt });
          return pool.run<{ mp4: ArrayBuffer }>((w) =>
            w.send({
              type: "render",
              index: i,
              start: seg.start,
              duration: dur,
              ass,
              hasCues: cues.length > 0,
              filter,
              crf: profile.crf,
              audioBitrate: profile.audioBitrate,
              preset: profile.preset,
            }),

          );
        },
        { onLog, signal },
      );

      const blob = new Blob([res.mp4], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const short = { index: i, startSec: seg.start, endSec: seg.end, blob, url };
      shorts.push(short);
      onShort?.(short);
      doneCount++;
      onProgress({
        phase: `Prêt ${doneCount}/${totalSegments}`,
        segmentIndex: i,
        totalSegments,
      });
      onMetric?.({ index: i, status: "done", renderMs: performance.now() - renderT0 });
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof AbortedError || signal?.aborted) {
        onMetric?.({ index: i, status: "error", lastError: "Annulé" });
        return;
      }
      onLog?.(`Segment ${i + 1} abandonné après reprises: ${msg}`);
      onMetric?.({ index: i, status: "error", lastError: msg });
    }
  };


  try {
    onProgress({
      phase: `Rendu parallèle sur ${desiredPoolSize} worker${desiredPoolSize > 1 ? "s" : ""}`,
      totalSegments,
    });
    await Promise.all(segments.map((_, i) => runOne(i)));
    throwIfAborted(signal);
    return shorts.sort((a, b) => a.index - b.index);
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    pool.terminate();
  }
}







/**
 * Re-runs the full pipeline (audio extraction → transcription → render) for a
 * single segment. Used by the dashboard "Relancer" action when a segment ended
 * up in error state. Reuses the cache and shared FFmpeg instance.
 */
export async function retrySegment(opts: {
  file: File;
  segment: SegmentRange;
  index: number;
  renderMode?: RenderMode;
  style: SubtitleStyle;
  throttle?: ThrottleOptions;
  onProgress?: ProgressCallback;
  onLog?: (msg: string) => void;
  onShort?: (short: Short) => void;
  onMetric?: MetricsCallback;
}): Promise<Short | null> {
  const { file, segment, index: i, style, onProgress, onLog, onShort, onMetric } = opts;
  const profile = RENDER_PROFILES[opts.renderMode ?? "fast"];
  if (opts.throttle) geminiThrottle.configure(opts.throttle);

  onProgress?.({ phase: `Reprise segment ${i + 1}` });
  const ff = await getFFmpeg(onLog);

  // Ensure input.mp4 & fonts are present (previous run may have cleaned them).
  try {
    await ff.readFile("input.mp4");
  } catch {
    await ff.writeFile("input.mp4", await fetchFile(file));
  }
  await ff.createDir("/fonts").catch(() => {});
  const font = FONT_OPTIONS[style.fontKey];
  try {
    await ff.readFile(`/fonts/${font.file}`);
  } catch {
    const fontBytes = await loadFontBytes(font.url);
    await ff.writeFile(`/fonts/${font.file}`, fontBytes.slice());
  }

  const fingerprint = sourceFingerprint(file);
  const dur = segment.end - segment.start;
  const audioName = `audio_${i}.webm`;
  const assName = `subs_${i}.ass`;
  const outName = `out_${i}.mp4`;

  onMetric?.({ index: i, status: "transcribing" });
  const t0 = performance.now();

  let cues: Cue[] = [];
  try {
    const cached = await getCachedCues(fingerprint, segment.start, segment.end);
    if (cached) {
      cues = cached;
      onLog?.(`Cache hit (cues) segment ${i + 1}`);
    } else {
      let audioB64 = await getCachedAudio(fingerprint, segment.start, segment.end);
      if (!audioB64) {
        audioB64 = await retry(
          `Extraction audio segment ${i + 1}`,
          async () => {
            await ff.exec([
              "-ss", segment.start.toFixed(3),
              "-i", "input.mp4",
              "-t", dur.toFixed(3),
              "-vn", "-ac", "1", "-ar", "16000",
              "-c:a", "libopus", "-b:a", "16k",
              "-y", audioName,
            ]);
            const audioData = (await ff.readFile(audioName)) as Uint8Array;
            const b64 = uint8ToBase64(audioData);
            await ff.deleteFile(audioName).catch(() => {});
            return b64;
          },
          { onLog },
        );
        void setCachedAudio(fingerprint, segment.start, segment.end, audioB64).catch(() => {});
      }

      const r = await retry(
        `Transcription segment ${i + 1}`,
        () =>
          geminiThrottle.run(() =>
            transcribeSegment({
              data: { audioBase64: audioB64!, mimeType: "audio/webm", durationSec: dur },
            }),
          ),
        { onLog },
      );
      cues = r.cues;
      void setCachedCues(fingerprint, segment.start, segment.end, r.cues).catch(() => {});
    }
  } catch (e) {
    onLog?.(`Transcription abandonnée pour le segment ${i + 1}: ${(e as Error).message}`);
    cues = [];
  }

  onMetric?.({
    index: i,
    status: "rendering",
    transcribeMs: performance.now() - t0,
    cueCount: cues.length,
  });

  try {
    await ff.writeFile(assName, new TextEncoder().encode(buildAssFile(cues, dur, profile, style)));

    const baseFilter = [
      "[0:v]split=2[bg][fg]",
      `[bg]scale=${profile.bgWidth}:${profile.bgHeight}:force_original_aspect_ratio=increase,crop=${profile.bgWidth}:${profile.bgHeight},boxblur=${profile.blur},scale=${profile.width}:${profile.height},eq=brightness=-0.1[bgblur]`,
      `[fg]scale=${profile.width}:-2[fgs]`,
      `[bgblur][fgs]overlay=(W-w)/2:(H-h)/2,fps=${profile.fps}[v]`,
    ];
    const filter = [
      ...baseFilter,
      cues.length > 0 ? `[v]subtitles=${assName}:fontsdir=/fonts[vout]` : "[v]null[vout]",
    ].join(";");

    const renderT0 = performance.now();
    await retry(
      `Rendu segment ${i + 1}`,
      async (attempt) => {
        if (attempt > 1) {
          onMetric?.({ index: i, status: "retrying", attempts: attempt });
          await ff.deleteFile(outName).catch(() => {});
        }
        await ff.exec([
          "-ss", segment.start.toFixed(3),
          "-i", "input.mp4",
          "-t", dur.toFixed(3),
          "-filter_complex", filter,
          "-map", "[vout]",
          "-map", "0:a?",
          "-c:v", "libx264",
          "-preset", profile.preset,
          "-crf", profile.crf,
          "-c:a", "aac",
          "-b:a", profile.audioBitrate,
          "-movflags", "+faststart",
          "-y", outName,
        ]);
      },
      { onLog },
    );

    const outData = (await ff.readFile(outName)) as Uint8Array;
    const blob = new Blob([outData.slice().buffer], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    const short = { index: i, startSec: segment.start, endSec: segment.end, blob, url };
    onShort?.(short);
    onMetric?.({ index: i, status: "done", renderMs: performance.now() - renderT0 });
    return short;
  } catch (e) {
    const msg = (e as Error).message;
    onLog?.(`Reprise segment ${i + 1} échouée: ${msg}`);
    onMetric?.({ index: i, status: "error", lastError: msg });
    return null;
  } finally {
    await ff.deleteFile(assName).catch(() => {});
    await ff.deleteFile(outName).catch(() => {});
  }
}





export async function probeDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";

    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration || 0);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossible de lire la vidéo"));
    };
    v.src = url;
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Detect "buzz" highlights by extracting a low-bitrate mono track, decoding it
 * via WebAudio, scoring rolling windows on loudness + variance, and returning
 * the top-K non-overlapping windows of length `segmentSec` inside `trim`.
 */
async function detectBuzzHighlights(
  file: File,
  trim: { start: number; end: number },
  segmentSec: number,
  topK: number,
  onLog?: (msg: string) => void,
): Promise<SegmentRange[]> {
  const total = Math.max(0, trim.end - trim.start);
  if (total < segmentSec * 1.5) {
    return [{ start: trim.start, end: Math.min(trim.end, trim.start + segmentSec) }];
  }

  const ff = await getFFmpeg(onLog);
  try {
    await ff.readFile("input.mp4");
  } catch {
    await ff.writeFile("input.mp4", await fetchFile(file));
  }
  const outName = "buzz_scan.wav";
  await ff.exec([
    "-ss", trim.start.toFixed(3),
    "-i", "input.mp4",
    "-t", total.toFixed(3),
    "-vn", "-ac", "1", "-ar", "8000",
    "-c:a", "pcm_s16le",
    "-y", outName,
  ]);
  const wav = (await ff.readFile(outName)) as Uint8Array;
  await ff.deleteFile(outName).catch(() => {});

  const AudioCtx: typeof OfflineAudioContext =
    (window as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new AudioCtx(1, 8000, 8000);
  const audio = await ctx.decodeAudioData(wav.slice().buffer as ArrayBuffer);
  const samples = audio.getChannelData(0);
  const sr = audio.sampleRate;

  // 1-second RMS bins
  const binSize = sr;
  const bins = Math.floor(samples.length / binSize);
  const rms = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    let sum = 0;
    for (let j = 0; j < binSize; j++) {
      const v = samples[i * binSize + j];
      sum += v * v;
    }
    rms[i] = Math.sqrt(sum / binSize);
  }

  // Score each candidate window (step = 2s) by mean + std dev of RMS.
  const winSec = Math.round(segmentSec);
  const step = 2;
  type Cand = { start: number; score: number };
  const cands: Cand[] = [];
  for (let s = 0; s + winSec <= bins; s += step) {
    let sum = 0;
    for (let i = s; i < s + winSec; i++) sum += rms[i];
    const mean = sum / winSec;
    let varSum = 0;
    for (let i = s; i < s + winSec; i++) {
      const d = rms[i] - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / winSec);
    cands.push({ start: s, score: mean * 0.7 + std * 0.6 });
  }
  cands.sort((a, b) => b.score - a.score);

  // Greedy non-overlap selection.
  const picks: number[] = [];
  const minGap = Math.max(5, Math.floor(winSec * 0.5));
  for (const c of cands) {
    if (picks.length >= topK) break;
    if (picks.every((p) => Math.abs(p - c.start) >= winSec - minGap)) picks.push(c.start);
  }
  picks.sort((a, b) => a - b);

  return picks.map((s) => ({
    start: trim.start + s,
    end: Math.min(trim.end, trim.start + s + winSec),
  }));
}
