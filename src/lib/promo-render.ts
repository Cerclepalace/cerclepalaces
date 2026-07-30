import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg } from "./video-processor";

export type LogoPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type PromoOptions = {
  /** source video */
  file: File;
  /** trim of the source, in seconds */
  trimStart: number;
  trimEnd: number;
  /** horizontal position of the 9:16 crop window, 0 = left, 1 = right */
  cropX: number;
  /** zoom applied to the crop window (1 = full height) */
  cropZoom: number;
  /** promo pause */
  pauseEnabled: boolean;
  /** pause moment, in seconds, relative to the trimmed clip */
  pauseAt: number;
  /** pause duration in seconds */
  pauseDuration: number;
  /** text drawn on the frozen frame */
  promoText: string;
  /** voice over played during the pause */
  voiceover?: Blob | null;
  /** duck the original audio during the pause instead of muting it */
  duckDb: number;
  /** logo / watermark */
  logo?: Blob | null;
  logoPosition: LogoPosition;
  logoScale: number; // fraction of the video width
  logoOpacity: number; // 0..1
  logoAlwaysVisible: boolean;
  /** export quality */
  quality: "fast" | "premium";
  onProgress?: (p: { phase: string; progress?: number }) => void;
  signal?: AbortSignal;
};

const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;

const FONT_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf";

function esc(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "\\%");
}

function logoOverlayXY(pos: LogoPosition) {
  const m = 60;
  const x: Record<LogoPosition, string> = {
    "top-left": `${m}`,
    "top-center": "(W-w)/2",
    "top-right": `W-w-${m}`,
    center: "(W-w)/2",
    "bottom-left": `${m}`,
    "bottom-center": "(W-w)/2",
    "bottom-right": `W-w-${m}`,
  };
  const y: Record<LogoPosition, string> = {
    "top-left": `${m}`,
    "top-center": `${m}`,
    "top-right": `${m}`,
    center: "(H-h)/2",
    "bottom-left": `H-h-${m}`,
    "bottom-center": `H-h-${m}`,
    "bottom-right": `H-h-${m}`,
  };
  return { x: x[pos], y: y[pos] };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("aborted");
}

/**
 * Renders a 9:16 short with an optional frozen "promo pause"
 * (freeze frame + text + logo + voice over) in a single ffmpeg pass.
 */
export async function renderPromoShort(opts: PromoOptions): Promise<Blob> {
  const {
    file,
    trimStart,
    trimEnd,
    cropX,
    cropZoom,
    pauseEnabled,
    pauseAt,
    pauseDuration,
    promoText,
    voiceover,
    duckDb,
    logo,
    logoPosition,
    logoScale,
    logoOpacity,
    logoAlwaysVisible,
    quality,
    onProgress,
    signal,
  } = opts;

  const ffmpeg = await getFFmpeg();
  throwIfAborted(signal);

  const clipDur = Math.max(0.5, trimEnd - trimStart);
  const P = pauseEnabled
    ? Math.min(Math.max(0.2, pauseAt), clipDur - 0.2)
    : 0;
  const D = pauseEnabled ? Math.max(0.5, pauseDuration) : 0;

  const inName = "promo_in.mp4";
  const outName = "promo_out.mp4";

  onProgress?.({ phase: "Préparation des fichiers" });
  await ffmpeg.writeFile(inName, await fetchFile(file));

  const inputs: string[] = ["-i", inName];
  let voIdx = -1;
  let logoIdx = -1;
  let next = 1;

  if (pauseEnabled && voiceover) {
    await ffmpeg.writeFile("promo_vo.mp3", await fetchFile(voiceover));
    inputs.push("-i", "promo_vo.mp3");
    voIdx = next++;
  }
  if (logo) {
    await ffmpeg.writeFile("promo_logo.png", await fetchFile(logo));
    inputs.push("-i", "promo_logo.png");
    logoIdx = next++;
  }

  let hasFont = false;
  if (pauseEnabled && promoText.trim()) {
    try {
      const font = await fetch(FONT_URL);
      if (font.ok) {
        await ffmpeg.writeFile(
          "promo.ttf",
          new Uint8Array(await font.arrayBuffer()),
        );
        hasFont = true;
      }
    } catch {
      hasFont = false;
    }
  }

  throwIfAborted(signal);

  // ---- video graph -------------------------------------------------------
  const zoom = Math.max(1, cropZoom);
  // crop a 9:16 window out of the source, then scale to 1080x1920
  const cropW = `min(iw,ih*9/16/${zoom.toFixed(3)})`;
  const cropH = `min(ih,ih/${zoom.toFixed(3)})`;
  const cx = `(iw-${cropW})*${cropX.toFixed(3)}`;
  const cy = `(ih-${cropH})/2`;

  const filters: string[] = [];
  filters.push(
    `[0:v]trim=${trimStart.toFixed(3)}:${trimEnd.toFixed(3)},setpts=PTS-STARTPTS,` +
      `crop=${cropW}:${cropH}:${cx}:${cy},scale=${OUT_W}:${OUT_H}:flags=lanczos,` +
      `setsar=1,fps=${FPS},format=yuv420p[base]`,
  );

  let videoOut = "[base]";

  if (pauseEnabled) {
    filters.push(`[base]split=3[p1][p2][p3]`);
    filters.push(`[p1]trim=0:${P.toFixed(3)},setpts=PTS-STARTPTS[seg1]`);
    filters.push(
      `[p2]trim=${P.toFixed(3)}:${(P + 1 / FPS).toFixed(3)},setpts=PTS-STARTPTS,` +
        `tpad=stop_mode=clone:stop_duration=${D.toFixed(3)},trim=0:${D.toFixed(3)},` +
        `setpts=PTS-STARTPTS[freeze]`,
    );
    filters.push(`[p3]trim=start=${P.toFixed(3)},setpts=PTS-STARTPTS[seg3]`);

    // darken the freeze slightly so the promo message pops
    let freeze = "[freeze]";
    filters.push(`${freeze}eq=brightness=-0.08:saturation=0.9[fzdim]`);
    freeze = "[fzdim]";

    if (hasFont) {
      const lines = promoText.trim().split("\n").slice(0, 3);
      lines.forEach((line, i) => {
        const yBase = OUT_H / 2 - (lines.length - 1) * 60 + i * 130;
        const out = i === lines.length - 1 ? "[fztxt]" : `[fzt${i}]`;
        filters.push(
          `${freeze}drawtext=fontfile=promo.ttf:text='${esc(line)}':` +
            `fontsize=86:fontcolor=white:borderw=6:bordercolor=black@0.85:` +
            `shadowx=0:shadowy=4:shadowcolor=black@0.5:` +
            `x=(w-text_w)/2:y=${Math.round(yBase)}${out}`,
        );
        freeze = out;
      });
    }

    filters.push(`${freeze}null[fzfinal]`);
    filters.push(`[seg1][fzfinal][seg3]concat=n=3:v=1:a=0[vcat]`);
    videoOut = "[vcat]";
  }

  if (logoIdx >= 0) {
    const { x, y } = logoOverlayXY(logoPosition);
    filters.push(
      `[${logoIdx}:v]scale=${Math.round(OUT_W * logoScale)}:-1,format=rgba,` +
        `colorchannelmixer=aa=${logoOpacity.toFixed(2)}[lg]`,
    );
    const enable =
      logoAlwaysVisible || !pauseEnabled
        ? ""
        : `:enable='between(t,${P.toFixed(3)},${(P + D).toFixed(3)})'`;
    filters.push(`${videoOut}[lg]overlay=${x}:${y}${enable}[vout]`);
    videoOut = "[vout]";
  }

  // ---- audio graph -------------------------------------------------------
  filters.push(
    `[0:a]atrim=${trimStart.toFixed(3)}:${trimEnd.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `aresample=48000,aformat=channel_layouts=stereo[atrim]`,
  );
  let audioOut = "[atrim]";

  if (pauseEnabled) {
    const duckGain = Math.pow(10, -Math.abs(duckDb) / 20);
    filters.push(`[atrim]asplit=2[aa][ab]`);
    filters.push(`[aa]atrim=0:${P.toFixed(3)},asetpts=PTS-STARTPTS[a1]`);
    filters.push(`[ab]atrim=start=${P.toFixed(3)},asetpts=PTS-STARTPTS[a3]`);
    filters.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${D.toFixed(3)},` +
        `asetpts=PTS-STARTPTS,volume=${duckGain.toFixed(3)}[agap]`,
    );
    filters.push(`[a1][agap][a3]concat=n=3:v=0:a=1[acat]`);
    audioOut = "[acat]";

    if (voIdx >= 0) {
      const ms = Math.round(P * 1000);
      filters.push(
        `[${voIdx}:a]aresample=48000,aformat=channel_layouts=stereo,` +
          `adelay=${ms}|${ms}[vo]`,
      );
      filters.push(
        `[acat][vo]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
      );
      audioOut = "[aout]";
    }
  }

  const preset = quality === "premium" ? "medium" : "veryfast";
  const crf = quality === "premium" ? "19" : "23";
  const abr = quality === "premium" ? "192k" : "128k";

  const args = [
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    videoOut,
    "-map",
    audioOut,
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    crf,
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-c:a",
    "aac",
    "-b:a",
    abr,
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-y",
    outName,
  ];

  const total = clipDur + D;
  const handler = ({ progress }: { progress: number }) => {
    onProgress?.({
      phase: "Rendu du short",
      progress: Math.min(1, Math.max(0, progress)),
    });
  };
  ffmpeg.on("progress", handler);

  onProgress?.({ phase: "Rendu du short", progress: 0 });
  try {
    await ffmpeg.exec(args);
  } finally {
    ffmpeg.off("progress", handler);
  }
  throwIfAborted(signal);

  const data = (await ffmpeg.readFile(outName)) as Uint8Array;
  const blob = new Blob([data.slice().buffer], { type: "video/mp4" });

  await ffmpeg.deleteFile(inName).catch(() => {});
  await ffmpeg.deleteFile(outName).catch(() => {});

  onProgress?.({ phase: "Terminé", progress: 1 });
  void total;
  return blob;
}
