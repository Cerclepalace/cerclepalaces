/// <reference lib="webworker" />
// Web Worker hosting one FFmpeg.wasm instance. Exposes extract + render ops.
// Main thread sends the input bytes + fonts once at init; every subsequent job
// reuses the in-memory FS.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

const CORE_VERSION = "0.12.10";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

type InitMsg = {
  type: "init";
  id: string;
  inputBytes: ArrayBuffer;
  fonts: Array<{ file: string; bytes: ArrayBuffer }>;
  voiceBytes?: ArrayBuffer | null;
  logoBytes?: ArrayBuffer | null;
};

type ExtractMsg = {
  type: "extract";
  id: string;
  index: number;
  start: number;
  duration: number;
};

type RenderMsg = {
  type: "render";
  id: string;
  index: number;
  start: number;
  duration: number;
  ass: string;
  hasCues: boolean;
  filter: string;
  crf: string;
  audioBitrate: string;
  preset?: string;
  hasPromo?: boolean;
  hasVoice?: boolean;
  hasLogo?: boolean;
};



type Incoming = InitMsg | ExtractMsg | RenderMsg;

let ff: FFmpeg | null = null;
let ready: Promise<FFmpeg> | null = null;

async function ensureLoaded(): Promise<FFmpeg> {
  if (ff) return ff;
  if (ready) return ready;
  ready = (async () => {
    const inst = new FFmpeg();
    inst.on("log", ({ message }) => {
      // eslint-disable-next-line no-restricted-globals
      (self as unknown as Worker).postMessage({ type: "log", message });
    });
    await inst.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ff = inst;
    return inst;
  })();
  return ready;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// eslint-disable-next-line no-restricted-globals
self.addEventListener("message", async (ev: MessageEvent<Incoming>) => {
  const msg = ev.data;
  const post = (m: unknown, transfer?: Transferable[]) =>
    // eslint-disable-next-line no-restricted-globals
    (self as unknown as Worker).postMessage(m, transfer ?? []);

  try {
    if (msg.type === "init") {
      const inst = await ensureLoaded();
      await inst.createDir("/fonts").catch(() => {});
      for (const f of msg.fonts) {
        await inst.writeFile(`/fonts/${f.file}`, new Uint8Array(f.bytes));
      }
      await inst.writeFile("input.mp4", new Uint8Array(msg.inputBytes));
      if (msg.voiceBytes) {
        await inst.writeFile("promo_vo.mp3", new Uint8Array(msg.voiceBytes));
      }
      if (msg.logoBytes) {
        await inst.writeFile("pause_logo.png", new Uint8Array(msg.logoBytes));
      }
      post({ type: "ok", id: msg.id });
      return;
    }

    if (msg.type === "extract") {
      const inst = await ensureLoaded();
      const audioName = `audio_${msg.index}.webm`;
      await inst.exec([
        "-ss", msg.start.toFixed(3),
        "-i", "input.mp4",
        "-t", msg.duration.toFixed(3),
        "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "libopus", "-b:a", "16k",
        "-y", audioName,
      ]);
      const audio = (await inst.readFile(audioName)) as Uint8Array;
      const b64 = uint8ToBase64(audio);
      await inst.deleteFile(audioName).catch(() => {});
      post({ type: "ok", id: msg.id, audioBase64: b64 });
      return;
    }

    if (msg.type === "render") {
      const inst = await ensureLoaded();
      const assName = `subs_${msg.index}.ass`;
      const outName = `out_${msg.index}.mp4`;
      try {
        await inst.writeFile(assName, new TextEncoder().encode(msg.ass));
        await inst.exec([
          "-ss", msg.start.toFixed(3),
          "-i", "input.mp4",
          "-t", msg.duration.toFixed(3),
          ...(msg.hasPromo && msg.hasVoice ? ["-i", "promo_vo.mp3"] : []),
          ...(msg.hasPromo && msg.hasLogo ? ["-i", "pause_logo.png"] : []),
          "-filter_complex", msg.filter,
          "-map", "[vencoded]",
          ...(msg.hasPromo ? ["-map", "[aout]"] : ["-map", "0:a?"]),
          "-c:v", "libx264",
          "-threads", "2",
          "-preset", msg.preset ?? "ultrafast",
          "-crf", msg.crf,

          "-c:a", "aac",
          "-b:a", msg.audioBitrate,
          "-movflags", "+faststart",
          "-y", outName,
        ]);
        const out = (await inst.readFile(outName)) as Uint8Array;
        // Transfer the ArrayBuffer to avoid a copy.
        const buf = out.slice().buffer;
        post({ type: "ok", id: msg.id, mp4: buf }, [buf]);
      } finally {
        await inst.deleteFile(assName).catch(() => {});
        await inst.deleteFile(outName).catch(() => {});
      }
      return;
    }
  } catch (e) {
    post({ type: "err", id: (msg as { id: string }).id, message: (e as Error).message });
  }
});

export {}; // module worker
