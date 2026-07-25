import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { transcribeSegment, type Cue } from "./transcribe.functions";

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

export type RenderMode = "fast" | "quality";

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
};

const RENDER_PROFILES: Record<RenderMode, RenderProfile> = {
  fast: {
    width: 720,
    height: 1280,
    bgWidth: 360,
    bgHeight: 640,
    blur: "10:1",
    fontSize: 64,
    outline: 4,
    shadow: 3,
    marginV: 175,
    crf: "32",
    audioBitrate: "96k",
    fps: 30,
  },
  quality: {
    width: 1080,
    height: 1920,
    bgWidth: 540,
    bgHeight: 960,
    blur: "14:1",
    fontSize: 96,
    outline: 6,
    shadow: 4,
    marginV: 260,
    crf: "28",
    audioBitrate: "128k",
    fps: 30,
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

export async function processVideo(opts: {
  file: File;
  segmentSec: number;
  renderMode?: RenderMode;
  style: SubtitleStyle;
  trim?: { start: number; end: number };
  customSegments?: SegmentRange[];
  onProgress: ProgressCallback;
  onLog?: (msg: string) => void;
  onShort?: (short: Short) => void;
}): Promise<Short[]> {
  const { file, segmentSec, onProgress, onLog, onShort, style } = opts;
  const profile = RENDER_PROFILES[opts.renderMode ?? "fast"];

  onProgress({ phase: "Chargement du moteur vidéo" });
  const ff = await getFFmpeg(onLog);

  onProgress({ phase: "Lecture de la vidéo source" });
  await ff.writeFile("input.mp4", await fetchFile(file));

  onProgress({ phase: "Analyse de la durée" });
  const durationSec = await probeDuration(file);
  const trim = opts.trim ?? { start: 0, end: durationSec };
  const segments = computeSegments(durationSec, segmentSec, trim, opts.customSegments);
  const totalSegments = segments.length;

  // Load requested font (and always keep Bebas around as fallback)
  await ff.createDir("/fonts").catch(() => {});
  const font = FONT_OPTIONS[style.fontKey];
  onProgress({ phase: `Chargement de la police ${font.label}` });
  const fontBytes = await loadFontBytes(font.url);
  await ff.writeFile(`/fonts/${font.file}`, fontBytes.slice());
  if (style.fontKey !== "bebas") {
    try {
      const bebasBytes = await loadFontBytes(FONT_OPTIONS.bebas.url);
      await ff.writeFile(`/fonts/${FONT_OPTIONS.bebas.file}`, bebasBytes.slice());
    } catch {
      /* optional */
    }
  }

  const shorts: Short[] = [];

  // Pipeline: extract audio for segment i, immediately fire transcription
  // (network I/O runs in parallel with subsequent ffmpeg work), then render.
  // Pre-fetch transcription of segment i+1 while segment i is rendering,
  // so the Gemini round-trip is hidden behind the render CPU time.
  const prepareTranscription = async (i: number): Promise<Cue[]> => {
    const seg = segments[i];
    const dur = seg.end - seg.start;
    const audioName = `audio_${i}.webm`;
    try {
      await ff.exec([
        "-ss",
        seg.start.toFixed(3),
        "-i",
        "input.mp4",
        "-t",
        dur.toFixed(3),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libopus",
        "-b:a",
        "16k",
        "-y",
        audioName,
      ]);
      const audioData = (await ff.readFile(audioName)) as Uint8Array;
      const audioB64 = uint8ToBase64(audioData);
      await ff.deleteFile(audioName).catch(() => {});
      // Fire network call; return the promise so caller can await later.
      return transcribeSegment({
        data: { audioBase64: audioB64, mimeType: "audio/webm", durationSec: dur },
      })
        .then((r) => r.cues)
        .catch((e: unknown) => {
          onLog?.(`Transcription failed for segment ${i}: ${(e as Error).message}`);
          return [] as Cue[];
        });
    } catch (e) {
      onLog?.(`Audio extract failed for segment ${i}: ${(e as Error).message}`);
      await ff.deleteFile(audioName).catch(() => {});
      return [];
    }
  };

  try {
    if (totalSegments === 0) return shorts;

    // Parallelism: keep up to N transcriptions in flight ahead of the renderer.
    // Each Gemini call is independent; running several in parallel hides the
    // network round-trip even when rendering is faster than one call.
    const LOOKAHEAD = 16;
    const cuesPromises: Array<Promise<Cue[]> | undefined> = new Array(totalSegments);

    // Audio extraction uses the shared ffmpeg instance, so serialize the
    // extract step but let the network calls overlap freely afterwards.
    let extractChain: Promise<void> = Promise.resolve();
    const primeUpTo = (upto: number) => {
      const limit = Math.min(totalSegments - 1, upto);
      for (let k = 0; k <= limit; k++) {
        if (cuesPromises[k]) continue;
        const idx = k;
        onProgress({
          phase: `Transcription segment ${idx + 1}/${totalSegments}`,
          segmentIndex: idx,
          totalSegments,
        });
        cuesPromises[idx] = extractChain.then(() => prepareTranscription(idx));
        extractChain = cuesPromises[idx]!.then(() => undefined).catch(() => undefined);
      }
    };

    primeUpTo(LOOKAHEAD - 1);

    for (let i = 0; i < totalSegments; i++) {
      const seg = segments[i];
      const start = seg.start;
      const dur = seg.end - seg.start;
      if (dur < 5) continue;

      const assName = `subs_${i}.ass`;
      const outName = `out_${i}.mp4`;

      primeUpTo(i + LOOKAHEAD);
      const cuesPromise = cuesPromises[i]!;

      try {
        const cues = await cuesPromise;

        await ff.writeFile(
          assName,
          new TextEncoder().encode(buildAssFile(cues, dur, profile, style)),
        );

        onProgress({
          phase: `Rendu ${profile.width}p segment ${i + 1}/${totalSegments}`,
          segmentIndex: i,
          totalSegments,
        });

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

        await ff.exec([
          "-ss",
          start.toFixed(3),
          "-i",
          "input.mp4",
          "-t",
          dur.toFixed(3),
          "-filter_complex",
          filter,
          "-map",
          "[vout]",
          "-map",
          "0:a?",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          profile.crf,
          "-c:a",
          "aac",
          "-b:a",
          profile.audioBitrate,
          "-movflags",
          "+faststart",
          "-y",
          outName,
        ]);

        const outData = (await ff.readFile(outName)) as Uint8Array;
        const blob = new Blob([outData.slice().buffer], { type: "video/mp4" });
        const url = URL.createObjectURL(blob);
        const short = { index: i, startSec: start, endSec: start + dur, blob, url };
        shorts.push(short);
        onShort?.(short);
      } finally {
        await ff.deleteFile(assName).catch(() => {});
        await ff.deleteFile(outName).catch(() => {});
      }
    }

    return shorts;
  } finally {
    await ff.deleteFile("input.mp4").catch(() => {});
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
