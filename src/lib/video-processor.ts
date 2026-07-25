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

// ASS colors are &HAABBGGRR — 00 alpha = opaque
// White #FFFFFF -> &H00FFFFFF ; Neon green #39FF14 -> BGR 14FF39 -> &H0014FF39
function buildAssFile(cues: Cue[], durationSec: number): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Neon,Bebas Neue,96,&H00FFFFFF,&H00FFFFFF,&H0014FF39,&H0014FF39,1,0,0,0,100,100,2,0,1,6,4,2,80,80,260,1

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

export async function processVideo(opts: {
  file: File;
  segmentSec: number;
  onProgress: ProgressCallback;
  onLog?: (msg: string) => void;
}): Promise<Short[]> {
  const { file, segmentSec, onProgress, onLog } = opts;

  onProgress({ phase: "Chargement du moteur vidéo" });
  const ff = await getFFmpeg(onLog);

  onProgress({ phase: "Lecture de la vidéo source" });
  await ff.writeFile("input.mp4", await fetchFile(file));

  onProgress({ phase: "Analyse de la durée" });
  const durationSec = await probeDuration(file);
  const totalSegments = Math.max(1, Math.floor(durationSec / segmentSec));

  // Load font once
  const fontData = await fetchFile("/fonts/BebasNeue-Regular.ttf");
  await ff.writeFile("/tmp/Bebas Neue.ttf", fontData);
  // libass looks in current dir by default; also expose via fontsdir
  await ff.createDir("/fonts").catch(() => {});
  await ff.writeFile("/fonts/BebasNeue-Regular.ttf", fontData);

  const shorts: Short[] = [];

  for (let i = 0; i < totalSegments; i++) {
    const start = i * segmentSec;
    const dur = Math.min(segmentSec, durationSec - start);
    if (dur < 10) break;

    onProgress({
      phase: `Extraction segment ${i + 1}/${totalSegments}`,
      segmentIndex: i,
      totalSegments,
    });

    // Cut raw segment first (fast, re-encoded to keyframe boundary)
    const rawName = `raw_${i}.mp4`;
    await ff.exec([
      "-ss",
      start.toFixed(3),
      "-i",
      "input.mp4",
      "-t",
      dur.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-y",
      rawName,
    ]);

    // Extract audio for transcription
    onProgress({
      phase: `Transcription segment ${i + 1}/${totalSegments}`,
      segmentIndex: i,
      totalSegments,
    });
    const audioName = `audio_${i}.webm`;
    await ff.exec([
      "-i",
      rawName,
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

    let cues: Cue[] = [];
    try {
      const res = await transcribeSegment({
        data: { audioBase64: audioB64, mimeType: "audio/webm", durationSec: dur },
      });
      cues = res.cues;
    } catch (e) {
      onLog?.(`Transcription failed for segment ${i}: ${(e as Error).message}`);
    }

    // Write ass subtitle file
    const assName = `subs_${i}.ass`;
    await ff.writeFile(assName, new TextEncoder().encode(buildAssFile(cues, dur)));

    onProgress({
      phase: `Rendu 9:16 segment ${i + 1}/${totalSegments}`,
      segmentIndex: i,
      totalSegments,
    });

    // Compose: blurred bg + centered original + burned subs -> 1080x1920
    const outName = `out_${i}.mp4`;
    const filter = [
      "[0:v]split=2[bg][fg]",
      "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:2,eq=brightness=-0.1[bgblur]",
      "[fg]scale=1080:-2[fgs]",
      `[bgblur][fgs]overlay=(W-w)/2:(H-h)/2[v]`,
      `[v]subtitles=${assName}:fontsdir=/fonts[vout]`,
    ].join(";");

    await ff.exec([
      "-i",
      rawName,
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
      "26",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-y",
      outName,
    ]);

    const outData = (await ff.readFile(outName)) as Uint8Array;
    const blob = new Blob([outData.slice().buffer], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    shorts.push({ index: i, startSec: start, endSec: start + dur, blob, url });

    // Clean up temp files for this segment
    await ff.deleteFile(rawName).catch(() => {});
    await ff.deleteFile(audioName).catch(() => {});
    await ff.deleteFile(assName).catch(() => {});
    await ff.deleteFile(outName).catch(() => {});
  }

  await ff.deleteFile("input.mp4").catch(() => {});
  return shorts;
}

async function probeDuration(file: File): Promise<number> {
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
