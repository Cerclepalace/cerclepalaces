import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg } from "./video-processor";
import { transcribeSegment, type Cue } from "./transcribe.functions";
import { scoreHooks } from "./hook-scoring.functions";
import { geminiThrottle, type ThrottleOptions } from "./gemini-throttle";
import {
  getCachedAudio,
  setCachedAudio,
  getCachedCues,
  setCachedCues,
  sourceFingerprint,
} from "./segment-cache";

export const MIN_SHORT_SEC = 60;
export const MAX_SHORT_SEC = 70;

export type ViralMoment = {
  id: string;
  start: number;
  end: number;
  /** score global 0-100 */
  score: number;
  hookScore: number;
  audioScore: number;
  emotionScore: number;
  hookText: string;
  transcript: string;
  reason: string;
};

/** Mots à forte charge émotionnelle (fr + en) — densité = signal de buzz. */
const EMOTION_WORDS = [
  "incroyable", "fou", "folle", "dingue", "choc", "jamais", "toujours", "secret",
  "personne", "erreur", "danger", "peur", "argent", "millions", "million", "milliard",
  "gratuit", "arnaque", "vrai", "faux", "mensonge", "pourquoi", "comment", "mieux",
  "pire", "meilleur", "record", "explose", "énorme", "grave", "attention", "stop",
  "révélation", "surprise", "immédiatement", "urgent", "interdit", "scandale",
  "crazy", "insane", "never", "secret", "money", "free", "shocking", "biggest",
  "nobody", "everyone", "truth", "lie", "warning", "hack", "mistake",
];

function emotionDensity(text: string): number {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return 0;
  let hits = 0;
  for (const w of words) if (EMOTION_WORDS.includes(w)) hits++;
  const questions = (text.match(/\?/g) ?? []).length;
  const numbers = words.filter((w) => /\d/.test(w)).length;
  const raw = (hits * 1.4 + questions * 1.2 + numbers * 1.0) / Math.max(6, words.length / 3);
  return Math.max(0, Math.min(1, raw));
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Profil d'énergie audio (1 valeur / seconde) + score de "tension" par seconde. */
export type AudioProfile = {
  offset: number;
  rms: Float32Array;
  /** score 0-1 par seconde : énergie + variations brusques + silence→reprise */
  tension: Float32Array;
};

async function buildAudioProfile(
  file: File,
  trim: { start: number; end: number },
  onLog?: (m: string) => void,
): Promise<AudioProfile> {
  const total = Math.max(1, trim.end - trim.start);
  const ff = await getFFmpeg(onLog);
  try {
    await ff.readFile("input.mp4");
  } catch {
    await ff.writeFile("input.mp4", await fetchFile(file));
  }
  const outName = "viral_scan.wav";
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

  const bins = Math.max(1, Math.floor(samples.length / sr));
  const rms = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    let sum = 0;
    for (let j = 0; j < sr; j++) {
      const v = samples[i * sr + j];
      sum += v * v;
    }
    rms[i] = Math.sqrt(sum / sr);
  }

  const peak = Math.max(1e-6, ...Array.from(rms));
  const mean = rms.reduce((a, b) => a + b, 0) / bins;
  const tension = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    const energy = rms[i] / peak; // 0-1
    const prev = i > 0 ? rms[i - 1] : rms[i];
    const jump = Math.max(0, (rms[i] - prev) / peak); // montée brusque
    // silence (sous 45% de la moyenne) suivi d'une reprise forte dans les 2s
    let burst = 0;
    if (rms[i] < mean * 0.45) {
      const next = Math.max(rms[Math.min(bins - 1, i + 1)], rms[Math.min(bins - 1, i + 2)]);
      if (next > mean * 1.25) burst = 0.6;
    }
    tension[i] = Math.max(0, Math.min(1, energy * 0.5 + jump * 2.2 + burst));
  }

  return { offset: trim.start, rms, tension };
}

function windowAudioScore(profile: AudioProfile, start: number, end: number): number {
  const a = Math.max(0, Math.floor(start - profile.offset));
  const b = Math.min(profile.tension.length, Math.ceil(end - profile.offset));
  if (b <= a) return 0;
  let sum = 0;
  let max = 0;
  for (let i = a; i < b; i++) {
    sum += profile.tension[i];
    if (profile.tension[i] > max) max = profile.tension[i];
  }
  const avg = sum / (b - a);
  return Math.max(0, Math.min(1, avg * 0.6 + max * 0.4));
}

const CHUNK_SEC = 90;

/** Transcrit toute la plage utile par tranches de 90s (cache + throttle inclus). */
async function transcribeRange(
  file: File,
  trim: { start: number; end: number },
  onProgress?: (done: number, total: number) => void,
  onLog?: (m: string) => void,
  signal?: AbortSignal,
): Promise<Cue[]> {
  const ff = await getFFmpeg(onLog);
  try {
    await ff.readFile("input.mp4");
  } catch {
    await ff.writeFile("input.mp4", await fetchFile(file));
  }
  const fingerprint = sourceFingerprint(file);
  const chunks: Array<{ start: number; end: number }> = [];
  for (let t = trim.start; t < trim.end; t += CHUNK_SEC) {
    const end = Math.min(trim.end, t + CHUNK_SEC);
    if (end - t >= 5) chunks.push({ start: t, end });
  }

  // Extraction audio séquentielle (ffmpeg partagé), transcription parallèle throttlée.
  const payloads: Array<{ start: number; dur: number; b64: string }> = [];
  for (const c of chunks) {
    if (signal?.aborted) break;
    const dur = c.end - c.start;
    const cached = await getCachedCues(fingerprint, c.start, c.end);
    if (cached) continue;
    let b64 = await getCachedAudio(fingerprint, c.start, c.end);
    if (!b64) {
      const name = `scan_${Math.round(c.start)}.webm`;
      await ff.exec([
        "-ss", c.start.toFixed(3),
        "-i", "input.mp4",
        "-t", dur.toFixed(3),
        "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "libopus", "-b:a", "16k",
        "-y", name,
      ]);
      const data = (await ff.readFile(name)) as Uint8Array;
      b64 = uint8ToBase64(data);
      await ff.deleteFile(name).catch(() => {});
      void setCachedAudio(fingerprint, c.start, c.end, b64).catch(() => {});
    }
    payloads.push({ start: c.start, dur, b64 });
  }

  let done = 0;
  const all: Cue[] = [];
  await Promise.all(
    chunks.map(async (c) => {
      const dur = c.end - c.start;
      let cues = await getCachedCues(fingerprint, c.start, c.end);
      if (!cues) {
        const payload = payloads.find((p) => p.start === c.start);
        if (!payload) return;
        try {
          const r = await geminiThrottle.run(() =>
            transcribeSegment({
              data: { audioBase64: payload.b64, mimeType: "audio/webm", durationSec: Math.min(120, dur) },
            }),
          );
          cues = r.cues;
          void setCachedCues(fingerprint, c.start, c.end, r.cues).catch(() => {});
        } catch (e) {
          onLog?.(`Transcription analyse ${Math.round(c.start)}s échouée: ${(e as Error).message}`);
          cues = [];
        }
      }
      for (const cue of cues) {
        all.push({ start: cue.start + c.start, end: cue.end + c.start, text: cue.text });
      }
      done++;
      onProgress?.(done, chunks.length);
    }),
  );

  return all.sort((a, b) => a.start - b.start);
}

function clampWindow(
  start: number,
  cues: Cue[],
  limit: number,
): { start: number; end: number; text: string } {
  // Cale le départ sur le début exact de la cue qui porte le hook.
  const idx = cues.findIndex((c) => c.end > start);
  const snapped = idx >= 0 ? Math.max(0, cues[idx].start) : start;
  let end = snapped + MIN_SHORT_SEC;
  const texts: string[] = [];
  for (let i = Math.max(0, idx); i < cues.length; i++) {
    const c = cues[i];
    if (c.start >= snapped + MAX_SHORT_SEC) break;
    texts.push(c.text);
    // on prolonge jusqu'à la fin d'une phrase, sans dépasser 70s
    if (c.end - snapped <= MAX_SHORT_SEC) end = Math.max(end, c.end + 0.4);
  }
  end = Math.min(limit, Math.max(snapped + MIN_SHORT_SEC, Math.min(snapped + MAX_SHORT_SEC, end)));
  return { start: snapped, end, text: texts.join(" ") };
}

export async function analyzeViralMoments(opts: {
  file: File;
  trim: { start: number; end: number };
  count?: number;
  throttle?: ThrottleOptions;
  onProgress?: (phase: string) => void;
  onLog?: (m: string) => void;
  signal?: AbortSignal;
}): Promise<ViralMoment[]> {
  const { file, trim, onProgress, onLog, signal } = opts;
  const count = Math.max(3, Math.min(5, opts.count ?? 5));
  if (opts.throttle) geminiThrottle.configure(opts.throttle);

  onProgress?.("Analyse audio locale (énergie, ruptures, silences)");
  const profile = await buildAudioProfile(file, trim, onLog);

  onProgress?.("Transcription de la vidéo");
  const cues = await transcribeRange(
    file,
    trim,
    (d, t) => onProgress?.(`Transcription ${d}/${t}`),
    onLog,
    signal,
  );

  let hooks: Array<{ startSec: number; score: number; hookText: string; reason: string }> = [];
  if (cues.length > 0) {
    onProgress?.("Détection des hooks (IA)");
    try {
      const lines = cues.slice(0, 600).map((c) => ({ t: c.start, text: c.text.slice(0, 300) }));
      const r = await scoreHooks({ data: { lines, count } });
      hooks = r.hooks;
    } catch (e) {
      onLog?.(`Scoring IA indisponible: ${(e as Error).message}`);
    }
  }

  // Fallback 100% audio si pas de transcript / pas de hooks.
  if (hooks.length === 0) {
    const step = 3;
    const cands: Array<{ start: number; s: number }> = [];
    for (let t = trim.start; t + 25 <= trim.end; t += step) {
      cands.push({ start: t, s: windowAudioScore(profile, t, t + 25) });
    }
    cands.sort((a, b) => b.s - a.s);
    hooks = cands.slice(0, count * 2).map((c) => ({
      startSec: c.start,
      score: Math.round(c.s * 100),
      hookText: "",
      reason: "Pic d'énergie audio",
    }));
  }

  const moments: ViralMoment[] = [];
  for (const h of hooks) {
    if (h.startSec < trim.start - 1 || h.startSec > trim.end - MIN_SHORT_SEC) continue;
    const w = clampWindow(Math.max(trim.start, h.startSec), cues, trim.end);
    if (w.end - w.start < MIN_SHORT_SEC - 1) continue;
    // Rejet immédiat de tout candidat qui empiète sur un moment déjà retenu.
    if (moments.some((m) => w.start < m.end + 0.5 && m.start < w.end + 0.5)) continue;

    const audioScore = windowAudioScore(profile, w.start, w.end);
    const emotionScore = emotionDensity(`${h.hookText} ${w.text}`);
    const hookScore = h.score / 100;
    const score = Math.round(
      Math.max(0, Math.min(1, hookScore * 0.45 + audioScore * 0.3 + emotionScore * 0.25)) * 100,
    );
    moments.push({
      id: `${w.start.toFixed(2)}-${w.end.toFixed(2)}`,
      start: w.start,
      end: w.end,
      score,
      hookScore: Math.round(hookScore * 100),
      audioScore: Math.round(audioScore * 100),
      emotionScore: Math.round(emotionScore * 100),
      hookText: h.hookText,
      transcript: w.text.slice(0, 320),
      reason: h.reason,
    });
    if (moments.length >= count) break;
  }

  return moments.sort((a, b) => b.score - a.score);
}
