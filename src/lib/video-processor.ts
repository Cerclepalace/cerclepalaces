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
import { FFmpegPool } from "./ffmpeg-pool";
import { RemoteRenderPool, isMobileDevice } from "./remote-render";
import pauseLogoAsset from "@/assets/promo-pause-logo.png.asset.json";

/** Interface commune au pool local (Web Workers) et au pool distant (serveur ffmpeg). */
type RenderBackend = {
  size(): number;
  run<T>(fn: (w: { send<R = unknown>(msg: Record<string, unknown>): Promise<R> }) => Promise<T>): Promise<T>;
  terminate(): void;
};

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

// Un seul profil : la meilleure qualité que chaque moteur supporte sans tomber.
// - En local (ffmpeg.wasm) : 1080x1920, CRF 20, preset veryfast (compromis
//   qualité/mémoire tenable dans un onglet).
// - En distant (petite instance Railway) : 1080p fait exploser la RAM et
//   renvoie un 502. On reste en 1280 de haut mais avec un CRF bien plus bas
//   et un audio 160k, ce qui donne une image nette sans crash.
const LOCAL_PROFILE: RenderProfile = {
  width: 1080, height: 1920, bgWidth: 540, bgHeight: 960,
  blur: "16:2", fontSize: 100, outline: 6, shadow: 4, marginV: 270,
  crf: "20", audioBitrate: "192k", fps: 30, preset: "veryfast",
};

const REMOTE_PROFILE: RenderProfile = {
  width: 720, height: 1280, bgWidth: 360, bgHeight: 640,
  blur: "12:1", fontSize: 66, outline: 4, shadow: 3, marginV: 180,
  crf: "20", audioBitrate: "160k", fps: 30, preset: "veryfast",
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

// ASS inline color code (BGR): {\c&H00BBGGRR&}
function assInlineColor(hex: string): string {
  const c = hex.replace("#", "").padStart(6, "0").slice(0, 6);
  const r = c.slice(0, 2), g = c.slice(2, 4), b = c.slice(4, 6);
  return `&H00${b}${g}${r}&`.toUpperCase();
}

function fmtAssTime(t: number, durationSec: number): string {
  const clamped = Math.max(0, Math.min(durationSec, t));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

function escapeAss(t: string) {
  return t.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, " ");
}

function buildAssFile(
  cues: Cue[],
  durationSec: number,
  profile: RenderProfile,
  style: SubtitleStyle,
  wordByWord: boolean,
): string {
  const font = FONT_OPTIONS[style.fontKey];
  const primary = hexToAss(style.textColor);
  const outline = hexToAss(style.outlineColor);
  const alignment = alignmentFor(style.position);
  const marginV = marginVFor(style.position, profile);
  const accent = assInlineColor(POWER_WORD_ACCENT);
  const primaryInline = assInlineColor(style.textColor);
  // In karaoke/word mode, boost size ~18% for punch.
  const size = wordByWord ? Math.round(profile.fontSize * 1.18) : profile.fontSize;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${profile.width}
PlayResY: ${profile.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Neon,${font.assName},${size},${primary},${primary},${outline},${outline},1,0,0,0,100,100,2,0,1,${profile.outline},${profile.shadow},${alignment},60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines: string[] = [];
  for (const c of cues) {
    if (!wordByWord) {
      lines.push(
        `Dialogue: 0,${fmtAssTime(c.start, durationSec)},${fmtAssTime(c.end, durationSec)},Neon,,0,0,0,,{\\blur1.2}${escapeAss(c.text)}`,
      );
      continue;
    }
    // ── Karaoké mot par mot ────────────────────────────────────────────────
    // La ligne complète reste affichée, seul le mot en cours est mis en
    // surbrillance (couleur accent + agrandi), façon TikTok.
    const words = c.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const totalDur = Math.max(0.2, c.end - c.start);
    const LINE_MAX = 4;
    const lines2: string[][] = [];
    for (let i = 0; i < words.length; i += LINE_MAX) lines2.push(words.slice(i, i + LINE_MAX));
    // Répartition du temps proportionnelle au nombre de caractères.
    const totalChars = words.reduce((n, w) => n + Math.max(2, w.length), 0);
    let cursor = c.start;
    for (const group of lines2) {
      for (let wi = 0; wi < group.length; wi++) {
        const w = group[wi];
        const share = (Math.max(2, w.length) / totalChars) * totalDur;
        const start = cursor;
        const end = Math.min(c.end, start + Math.max(0.12, share));
        cursor = end;
        const rendered = group
          .map((word, k) => {
            const safe = escapeAss(word);
            if (k === wi) {
              // mot actif : accent + léger scale-up
              return `{\\c${accent}\\fscx112\\fscy112}${safe}{\\c${primaryInline}\\fscx100\\fscy100}`;
            }
            if (isPowerWord(word)) return `{\\alpha&H40&}${safe}{\\alpha&H00&}`;
            return `{\\alpha&H50&}${safe}{\\alpha&H00&}`;
          })
          .join(" ");
        lines.push(
          `Dialogue: 0,${fmtAssTime(start, durationSec)},${fmtAssTime(end, durationSec)},Neon,,0,0,0,,{\\blur1.2}${rendered}`,
        );
      }
    }

  }
  return header + lines.join("\n") + "\n";
}

export type Short = {
  index: number;
  startSec: number;
  endSec: number;
  blob: Blob;
  url: string;
  qualityScore?: number;
  cueCount?: number;
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
  // Un short ne doit jamais dépasser la durée cible : toute plage trop longue
  // (moment détecté mal borné, saisie manuelle type "0-300") est redécoupée.
  const maxLen = Math.max(10, Math.min(90, segmentSec || 70));
  if (custom && custom.length > 0) {
    const out: SegmentRange[] = [];
    for (const s of custom) {
      const start = Math.max(0, Math.min(durationSec, Math.min(s.start, s.end)));
      const end = Math.max(0, Math.min(durationSec, Math.max(s.start, s.end)));
      let cur = start;
      while (end - cur >= 5) {
        const stop = Math.min(end, cur + maxLen);
        if (stop - cur >= 5) out.push({ start: cur, end: stop });
        cur = stop;
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  const from = Math.max(0, Math.min(durationSec, trim.start));
  const to = Math.max(from, Math.min(durationSec, trim.end || durationSec));
  const out: SegmentRange[] = [];
  for (let start = from; to - start >= 10; start += maxLen) {
    out.push({ start, end: Math.min(to, start + maxLen) });
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


export type PromoPause = {
  /** moment de la pause, en secondes depuis le début du short */
  atSec: number;
  /** durée de la pause figée, en secondes */
  durationSec: number;
  /** une voix off est chargée dans le worker (promo_vo.mp3) */
  hasVoice: boolean;
  /** un logo pause est chargé dans le worker (pause_logo.png) */
  hasLogo?: boolean;
};

function buildVideoFilter(
  profile: RenderProfile,
  hasCues: boolean,
  assName: string,
  brandedFrame: boolean,
  zoomPunch: boolean,
  promo?: PromoPause | null,
): string {
  // Cadrage : la source garde son ratio (scale "decrease"), jamais d'étirement.
  const fgScale = `[fg]scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease[fgs]`;
  const base = [
    "[0:v]split=2[bg][fg]",
    `[bg]scale=${profile.bgWidth}:${profile.bgHeight}:force_original_aspect_ratio=increase,crop=${profile.bgWidth}:${profile.bgHeight},boxblur=${profile.blur},scale=${profile.width}:${profile.height},eq=brightness=-0.1[bgblur]`,
    fgScale,
    `[bgblur][fgs]overlay=(W-w)/2:(H-h)/2,fps=${profile.fps}[vraw]`,
  ];
  // Zoom kinétique appliqué sur le canvas final (donc sans déformation).
  base.push(
    zoomPunch
      ? `[vraw]zoompan=z='min(zoom+0.0006,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${profile.width}x${profile.height}:fps=${profile.fps}[v]`
      : `[vraw]null[v]`,
  );

  const subLabel = hasCues ? "[vs]" : "[vs]";
  base.push(hasCues ? `[v]subtitles=${assName}:fontsdir=/fonts${subLabel}` : `[v]null${subLabel}`);
  const vEnd = promo ? "[vpre]" : "[vout]";
  if (brandedFrame) {
    // Yellow TikTokBoost signature frame (thick border, glow via double drawbox).
    base.push(
      `[vs]drawbox=x=0:y=0:w=iw:h=ih:color=0xFFE500@0.25:t=16,drawbox=x=6:y=6:w=iw-12:h=ih-12:color=0xFFE500@0.95:t=8${vEnd}`,
    );
  } else {
    base.push(`[vs]null${vEnd}`);
  }

  if (promo) {
    const P = Math.max(0.2, promo.atSec);
    const D = Math.max(0.5, promo.durationSec);
    const step = (1 / profile.fps).toFixed(4);
    // ── vidéo : segment 1 → image figée (durée D) → segment 2 ────────────────
    base.push(`[vpre]split=3[p1][p2][p3]`);
    base.push(`[p1]trim=0:${P.toFixed(3)},setpts=PTS-STARTPTS[s1]`);
    base.push(
      `[p2]trim=${P.toFixed(3)}:${(P + Number(step)).toFixed(3)},setpts=PTS-STARTPTS,` +
        `tpad=stop_mode=clone:stop_duration=${D.toFixed(3)},trim=0:${D.toFixed(3)},` +
        `setpts=PTS-STARTPTS,eq=brightness=-0.06:saturation=0.95[fz]`,
    );
    base.push(`[p3]trim=start=${P.toFixed(3)},setpts=PTS-STARTPTS[s3]`);
    let fzLabel = "[fz]";
    if (promo.hasLogo) {
      const logoIdx = promo.hasVoice ? 2 : 1;
      const lw = Math.round(profile.width * 0.22);
      base.push(`[${logoIdx}:v]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=0.92[plogo]`);
      base.push(`[fz][plogo]overlay=(W-w)/2:(H-h)/2[fzl]`);
      fzLabel = "[fzl]";
    }
    base.push(`[s1]${fzLabel}[s3]concat=n=3:v=1:a=0,fps=${profile.fps}[vout]`);

    // ── audio : silence pendant la pause, voix off par-dessus ────────────────
    base.push(
      `[0:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,asplit=2[aa][ab]`,
    );
    base.push(`[aa]atrim=0:${P.toFixed(3)},asetpts=PTS-STARTPTS[a1]`);
    base.push(`[ab]atrim=start=${P.toFixed(3)},asetpts=PTS-STARTPTS[a3]`);
    base.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${D.toFixed(3)},asetpts=PTS-STARTPTS[agap]`,
    );
    base.push(`[a1][agap][a3]concat=n=3:v=0:a=1[acat]`);
    if (promo.hasVoice) {
      const ms = Math.round(P * 1000);
      base.push(
        `[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[vo]`,
      );
      base.push(
        `[acat][vo]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
      );
    } else {
      base.push(`[acat]anull[aout]`);
    }
  }
  // Normalise systématiquement la géométrie avant libx264. Certains filtres
  // (notamment zoompan) propagent un SAR fractionnaire que x264 refuse parfois.
  base.push(
    `[vout]scale=${profile.width}:${profile.height}:flags=lanczos,setsar=1,format=yuv420p[vencoded]`,
  );
  return base.join(";");
}


function computeQualityScore(cues: Cue[], durationSec: number): number {
  if (durationSec <= 0) return 0;
  const cueCount = cues.length;
  const density = cueCount / durationSec; // ~0.4-1.5 is ideal
  let densityScore = 0;
  if (density >= 0.35 && density <= 1.6) densityScore = 40;
  else if (density > 0) densityScore = Math.max(10, 40 - Math.abs(density - 0.8) * 30);
  const words = cues.flatMap((c) => c.text.split(/\s+/).filter(Boolean));
  const power = words.filter(isPowerWord).length;
  const powerScore = Math.min(25, power * 3);
  const durScore = durationSec >= 45 && durationSec <= 85 ? 20 : 10;
  const base = cueCount > 0 ? 15 : 0;
  return Math.round(Math.max(0, Math.min(100, densityScore + powerScore + durScore + base)));
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
  onMetric?: MetricsCallback;
  throttle?: ThrottleOptions;
  poolSize?: number;
  /** true = encodage sur le service ffmpeg serveur (par défaut sur mobile) */
  remote?: boolean;
  signal?: AbortSignal;

  wordByWord?: boolean;
  brandedFrame?: boolean;
  zoomPunch?: boolean;
  promoPause?: {
    enabled: boolean;
    atSec: number;
    durationSec: number;
    voice?: Blob | null;
  } | null;
}): Promise<Short[]> {
  const { file, segmentSec, onProgress, onLog, onShort, onMetric, style, signal } = opts;

  // Garde-fou mémoire : au-delà de 500 Mo, ffmpeg.wasm fait tomber l'onglet.
  const MAX_INPUT_BYTES = 500 * 1024 * 1024;
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(
      `Vidéo trop lourde (${(file.size / 1024 / 1024).toFixed(0)} Mo). Maximum autorisé : 500 Mo. Compresse ou raccourcis la vidéo avant de relancer.`,
    );
  }

  const useRemote = opts.remote ?? isMobileDevice();
  const profile: RenderProfile = useRemote ? REMOTE_PROFILE : LOCAL_PROFILE;

  const wordByWord = opts.wordByWord ?? true;
  const brandedFrame = opts.brandedFrame ?? false;
  const zoomPunch = opts.zoomPunch ?? false;
  const promoCfg = opts.promoPause?.enabled ? opts.promoPause : null;
  const voiceBytes = promoCfg?.voice ? await promoCfg.voice.arrayBuffer() : null;
  const logoBytes = promoCfg
    ? await fetch(pauseLogoAsset.url)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null)
    : null;
  if (opts.throttle) geminiThrottle.configure(opts.throttle);

  // Les segments sont traités un par un pour ne jamais saturer la mémoire du
  // navigateur : un seul moteur ffmpeg.wasm suffit.
  const desiredPoolSize = 1;


  throwIfAborted(signal);
  onProgress({ phase: "Analyse de la durée" });
  const durationSec = await probeDuration(file);
  const trim = opts.trim ?? { start: 0, end: durationSec };
  const effectiveCustom = opts.customSegments;
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
  const pool: RenderBackend = useRemote
    ? await (async () => {
        onProgress({ phase: "Envoi de la vidéo au serveur de rendu", progress: 0 });
        return RemoteRenderPool.create({
          size: desiredPoolSize,
          inputBytes,
          voiceBytes,
          logoBytes,
          fonts: fontsToLoad,
          onUploadProgress: (f) =>
            onProgress({
              phase: `Envoi au serveur ${Math.round(f * 100)}%`,
              progress: f,
            }),
        });
      })()
    : await (async () => {
        onProgress({ phase: "Chargement du moteur ffmpeg.wasm" });
        try {
          const created = await FFmpegPool.create({
            size: desiredPoolSize,
            inputBytes,
            voiceBytes,
            logoBytes,
            fonts: fontsToLoad,
            onLog: (idx, msg) => onLog?.(`[w${idx}] ${msg}`),
          });
          onProgress({ phase: "Moteur ffmpeg.wasm prêt" });
          return created;
        } catch (e) {
          const msg = (e as Error).message || "raison inconnue";
          onLog?.(`Échec du chargement de ffmpeg.wasm : ${msg}`);
          throw new Error(
            `Impossible de charger le moteur vidéo ffmpeg.wasm (${msg}). Vérifie ta connexion, recharge la page, ou active le rendu serveur.`,
          );
        }
      })();



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
    onProgress({
      phase: `Transcription du segment ${i + 1}/${totalSegments}…`,
      segmentIndex: i,
      totalSegments,
    });
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
              onMetric?.({ index: i, status: "transcribing", attempts: attempt });
              const r = await pool.run<{ audioBase64: string }>((w) =>
                w.send({ type: "extract", index: i, start: seg.start, duration: dur }),
              );
              return r.audioBase64;
            },
            {
              onLog,
              signal,
              onRetry: (attempt, err) =>
                onMetric?.({ index: i, status: "retrying", attempts: attempt, lastError: err.message }),
            },

          );
          void setCachedAudio(fingerprint, seg.start, seg.end, audioB64).catch(() => {});
        }
        const r = await retry(
          `Transcription segment ${i + 1}`,
          async (attempt) => {
            onMetric?.({ index: i, status: "transcribing", attempts: attempt });
            return geminiThrottle.run(() =>
              transcribeSegment({
                data: { audioBase64: audioB64!, mimeType: "audio/webm", durationSec: dur },
              }),
            );
          },
          {
            onLog,
            signal,
            onRetry: (attempt, err) =>
              onMetric?.({ index: i, status: "retrying", attempts: attempt, lastError: err.message }),
          },

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

    onProgress({
      phase: `Encodage du segment ${i + 1}/${totalSegments}…`,
      segmentIndex: i,
      totalSegments,
    });
    // ── render (dispatched to any free worker) ────────────────────────────────

    try {
      // Pause promo : image figée à l'instant choisi, voix off par-dessus.
      const promo: PromoPause | null =
        promoCfg && dur > promoCfg.atSec + 1
          ? {
              atSec: promoCfg.atSec,
              durationSec: promoCfg.durationSec,
              hasVoice: !!voiceBytes,
              hasLogo: !!logoBytes,
            }
          : null;
      const ass = buildAssFile(cues, dur, profile, style, wordByWord);

      const renderT0 = performance.now();
      const res = await retry(
        `Rendu segment ${i + 1}`,
        async (attempt) => {
          onMetric?.({ index: i, status: "rendering", attempts: attempt, lastError: undefined });
          // A bad optional overlay must never prevent the base short from
          // being exported. Retry once without the promo graph, then with the
          // simplest video graph if the installed FFmpeg lacks a subtitle
          // filter/font capability.
          const attemptPromo = attempt === 1 ? promo : null;
          const attemptHasCues = attempt < 3 && cues.length > 0;
          if (attempt === 2 && promo) onLog?.(`Segment ${i + 1}: reprise sans pause promo`);
          if (attempt === 3) onLog?.(`Segment ${i + 1}: reprise vidéo seule sans sous-titres`);
          const filter = buildVideoFilter(
            profile,
            attemptHasCues,
            `subs_${i}.ass`,
            brandedFrame,
            zoomPunch,
            attemptPromo,
          );
          if (!filter.includes("[vencoded]")) {
            throw new Error("Graphe vidéo invalide : sortie vencoded absente");
          }
          return pool.run<{ mp4: ArrayBuffer }>((w) =>
            w.send({
              type: "render",
              index: i,
              start: seg.start,
              duration: dur,
              ass,
              hasCues: attemptHasCues,
              filter,
              crf: profile.crf,
              audioBitrate: profile.audioBitrate,
              preset: profile.preset,
              hasPromo: !!attemptPromo,
              hasVoice: !!attemptPromo?.hasVoice,
              hasLogo: !!attemptPromo?.hasLogo,
              outputWidth: profile.width,
              outputHeight: profile.height,
              outputFps: profile.fps,
            }),

          );
        },
        {
          onLog,
          signal,
          onRetry: (attempt, err) =>
            onMetric?.({ index: i, status: "retrying", attempts: attempt, lastError: err.message }),
        },
      );

      const blob = new Blob([res.mp4], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const qualityScore = computeQualityScore(cues, dur);
      const short = { index: i, startSec: seg.start, endSec: seg.end, blob, url, qualityScore, cueCount: cues.length };
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
      phase: `Découpage séquentiel de ${totalSegments} segment${totalSegments > 1 ? "s" : ""}`,
      totalSegments,
    });
    // Un segment à la fois : ffmpeg.wasm garde tout en mémoire, le parallélisme
    // faisait crasher l'onglet sur les grosses vidéos.
    for (let i = 0; i < totalSegments; i++) {
      if (signal?.aborted) break;
      onProgress({
        phase: `Découpage du segment ${i + 1}/${totalSegments}…`,
        segmentIndex: i,
        totalSegments,
        progress: i / totalSegments,
      });
      try {
        await runOne(i);
      } catch (e) {
        // Un segment en échec ne doit jamais interrompre les suivants.
        if (e instanceof AbortedError || signal?.aborted) break;
        const msg = (e as Error).message || "erreur inconnue";
        onLog?.(`Segment ${i + 1} en échec : ${msg}`);
        onMetric?.({ index: i, status: "error", lastError: msg });
      }
    }
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
  wordByWord?: boolean;
  brandedFrame?: boolean;
  zoomPunch?: boolean;
}): Promise<Short | null> {
  const { file, segment, index: i, style, onProgress, onLog, onShort, onMetric } = opts;
  const profile = RENDER_PROFILES[opts.renderMode ?? "fast"];
  const wordByWord = opts.wordByWord ?? true;
  const brandedFrame = opts.brandedFrame ?? false;
  const zoomPunch = opts.zoomPunch ?? false;
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
    await ff.writeFile(assName, new TextEncoder().encode(buildAssFile(cues, dur, profile, style, wordByWord)));

    const filter = buildVideoFilter(profile, cues.length > 0, assName, brandedFrame, zoomPunch);

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
          "-map", "[vencoded]",
          "-map", "0:a?",
          "-c:v", "libx264",
          "-threads", "2",
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
    const qualityScore = computeQualityScore(cues, dur);
    const short = { index: i, startSec: segment.start, endSec: segment.end, blob, url, qualityScore, cueCount: cues.length };
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

