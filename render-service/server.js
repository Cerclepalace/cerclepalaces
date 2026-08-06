// NeonCut render service — ffmpeg natif côté serveur.
//
// Le navigateur (surtout mobile) n'encode plus rien : il ouvre une "session"
// en uploadant la vidéo source (+ voix off, logo, polices), puis demande
// segment par segment une extraction audio ou un rendu MP4.
//
// Le protocole reprend exactement celui du Web Worker ffmpeg.wasm côté client,
// donc le graphe de filtres (crop 9:16, sous-titres ASS karaoké, pause promo,
// logo, voix off) est identique — seul le moteur change.

import express from "express";
import cors from "cors";
import multer from "multer";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = Number(process.env.PORT || 8080);
const WORK_DIR = process.env.WORK_DIR || path.join(os.tmpdir(), "neoncut");
const SECRET = process.env.RENDER_SERVICE_SECRET || "";
const SESSION_TTL_MS = 1000 * 60 * 60; // 1 h
// Valeurs fixes et sûres : plus aucun réglage exposé à l'utilisateur.
const MAX_RENDER_CONCURRENCY = Math.max(1, Number(process.env.MAX_RENDER_CONCURRENCY || 2));
// Coupe-circuit automatique : tout job ffmpeg dépassant 90 s est tué et son
// créneau immédiatement rendu au job suivant.
const FFMPEG_TIMEOUT_MS = Math.max(10_000, Number(process.env.FFMPEG_TIMEOUT_MS || 90_000));

let activeRenders = 0;
const renderQueue = [];

if (!SECRET) {
  console.warn("[neoncut] RENDER_SERVICE_SECRET manquant — le service refusera toutes les requêtes.");
}

await fs.mkdir(WORK_DIR, { recursive: true });

const app = express();
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);
app.use(express.json({ limit: "8mb" }));

// ── auth : jeton HMAC court terme émis par le backend Lovable ───────────────
function verifyToken(token) {
  if (!SECRET || !token) return false;
  const [expRaw, sig] = String(token).split(".");
  if (!expRaw || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(expRaw).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!verifyToken(token)) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ── sessions ────────────────────────────────────────────────────────────────
const sessions = new Map(); // id -> { dir, createdAt }

function sessionDir(id) {
  return path.join(WORK_DIR, id);
}

async function touchSession(id) {
  let s = sessions.get(id);
  if (!s) {
    // Le service a pu redémarrer (déploiement, OOM) : les fichiers de session
    // sont toujours sur le disque, on réhydrate au lieu de renvoyer un 404.
    const dir = sessionDir(String(id).replace(/[^\w-]/g, ""));
    try {
      await fs.access(path.join(dir, "input.mp4"));
      s = { dir, createdAt: Date.now() };
      sessions.set(id, s);
    } catch {
      return null;
    }
  }
  s.createdAt = Date.now();
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
      fs.rm(s.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}, 60_000).unref();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, req.__dir),
    filename: (req, file, cb) => {
      if (file.fieldname === "input") return cb(null, "input.mp4");
      if (file.fieldname === "voice") return cb(null, "promo_vo.mp3");
      if (file.fieldname === "logo") return cb(null, "pause_logo.png");
      // polices
      const safe = path.basename(file.originalname).replace(/[^\w.\-]/g, "_");
      cb(null, path.join("fonts", safe));
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 Go
});

function runFfmpeg(args, cwd, req, timeoutMs = FFMPEG_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { cwd });
    let stderr = "";
    let aborted = false;
    let timedOut = false;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      req?.off?.("aborted", onClose);
      fn(value);
    };
    // Si le client (iPhone) coupe la connexion, on tue ffmpeg au lieu de laisser
    // le CPU tourner pour rien et bloquer la file d'attente.
    const onClose = () => {
      aborted = true;
      proc.kill("SIGKILL");
    };
    // Un processus ffmpeg figé ne doit jamais conserver un créneau de rendu à
    // vie. Le finally de la route libérera ensuite le worker pour le short suivant.
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    timeout.unref();
    req?.once?.("aborted", onClose);
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 40_000) stderr = stderr.slice(-20_000);
    });
    proc.on("error", (e) => {
      finish(reject, e);
    });
    proc.on("close", (code) => {
      if (timedOut) finish(reject, new Error("ffmpeg timeout — délai maximal de rendu dépassé"));
      else if (aborted) finish(reject, new Error("client déconnecté"));
      else if (code === 0) finish(resolve);
      else finish(reject, new Error(`ffmpeg exit ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function acquireRenderSlot(req) {
  if (activeRenders < MAX_RENDER_CONCURRENCY) {
    activeRenders++;
    return;
  }
  await new Promise((resolve, reject) => {
    const entry = { resolve, reject, req };
    const onAbort = () => {
      const index = renderQueue.indexOf(entry);
      if (index >= 0) renderQueue.splice(index, 1);
      reject(new Error("client déconnecté pendant l'attente"));
    };
    entry.onAbort = onAbort;
    req.once("aborted", onAbort);
    renderQueue.push(entry);
  });
  activeRenders++;
}

function releaseRenderSlot() {
  activeRenders = Math.max(0, activeRenders - 1);
  while (renderQueue.length > 0) {
    const entry = renderQueue.shift();
    if (!entry || entry.req.aborted) continue;
    entry.req.off("aborted", entry.onAbort);
    entry.resolve();
    break;
  }
}

/**
 * Maintient la compatibilité avec les clients déjà ouverts pendant un
 * déploiement. Certaines anciennes versions terminaient le graphe par [vout]
 * (ou envoyaient un filtre vide), alors que le serveur mappe [vencoded].
 */
function ensureVideoOutput(filter, width, height, fps) {
  const graph = String(filter || "").trim().replace(/fontsdir=\/fonts/g, "fontsdir=fonts");
  if (/\[vencoded\]/.test(graph)) return graph;

  const normalize = `scale=${width}:${height}:flags=lanczos,setsar=1,fps=${fps},format=yuv420p[vencoded]`;
  for (const label of ["vout", "vpre", "vs", "v", "vraw"]) {
    if (new RegExp(`\\[${label}\\]`).test(graph)) {
      return `${graph};[${label}]${normalize}`;
    }
  }

  // Dernier filet de sécurité : un short cadré correctement vaut mieux qu'un
  // échec total si un ancien client n'a pas transmis son graphe de filtres.
  return (
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${Math.max(2, Math.round(width / 2))}:${Math.max(2, Math.round(height / 2))}:force_original_aspect_ratio=increase,` +
    `crop=${Math.max(2, Math.round(width / 2))}:${Math.max(2, Math.round(height / 2))},boxblur=14:1,scale=${width}:${height}[bgv];` +
    `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgv];` +
    `[bgv][fgv]overlay=(W-w)/2:(H-h)/2,${normalize}`
  );
}

app.get("/health", (_req, res) =>
  res.json({ ok: true, activeRenders, queued: renderQueue.length, maxConcurrency: MAX_RENDER_CONCURRENCY }),
);

// ── auto-test : simule un ffmpeg figé et vérifie le coupe-circuit ───────────
// Lance un encodage volontairement infini avec un timeout court, puis mesure
// que le processus est bien tué et que le créneau de la file est relâché.
app.post("/diagnostics/stall", requireAuth, async (req, res) => {
  const timeoutMs = Math.max(3000, Math.min(30_000, Number(req.body?.timeoutMs) || 8000));
  const startedAt = Date.now();
  let slot = false;
  let killed = false;
  let detail = "";
  try {
    await acquireRenderSlot(req);
    slot = true;
    await runFfmpeg(
      [
        "-re",
        "-f", "lavfi",
        "-i", "testsrc=size=64x64:rate=5",
        "-t", "3600",
        "-f", "null", "-",
      ],
      WORK_DIR,
      req,
      timeoutMs,
    );
  } catch (e) {
    detail = String(e?.message || e);
    killed = /timeout/i.test(detail);
  } finally {
    if (slot) releaseRenderSlot();
  }
  const elapsedMs = Date.now() - startedAt;
  res.json({
    killed,
    detail,
    timeoutMs,
    elapsedMs,
    activeRenders,
    queued: renderQueue.length,
    maxConcurrency: MAX_RENDER_CONCURRENCY,
    // Le coupe-circuit est validé si ffmpeg a été tué au bon moment ET que la
    // file est revenue à zéro rendu actif.
    slotReleased: activeRenders === 0,
    ok: killed && activeRenders === 0 && elapsedMs < timeoutMs + 5000,
  });
});

// Ouvre une session et reçoit la vidéo source + assets.
app.post(
  "/session",
  requireAuth,
  async (req, res, next) => {
    const id = crypto.randomUUID();
    const dir = sessionDir(id);
    await fs.mkdir(path.join(dir, "fonts"), { recursive: true });
    req.__dir = dir;
    req.__id = id;
    next();
  },
  upload.any(),
  async (req, res) => {
    sessions.set(req.__id, { dir: req.__dir, createdAt: Date.now() });
    res.json({ sessionId: req.__id });
  },
);

// Extraction audio d'un segment → base64 (pour la transcription Gemini).
app.post("/session/:id/extract", requireAuth, async (req, res) => {
  const s = await touchSession(req.params.id);
  if (!s) return res.status(404).json({ error: "session inconnue" });
  const { index = 0, start = 0, duration = 0 } = req.body || {};
  const out = `audio_${index}.webm`;
  try {
    await runFfmpeg(
      [
        "-ss", Number(start).toFixed(3),
        "-i", "input.mp4",
        "-t", Number(duration).toFixed(3),
        "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "libopus", "-b:a", "16k",
        "-y", out,
      ],
      s.dir,
      req,
    );
    const buf = await fs.readFile(path.join(s.dir, out));
    await fs.rm(path.join(s.dir, out), { force: true });
    res.json({ audioBase64: buf.toString("base64") });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Rendu d'un segment → MP4 binaire.
app.post("/session/:id/render", requireAuth, async (req, res) => {
  const s = await touchSession(req.params.id);
  if (!s) return res.status(404).json({ error: "session inconnue" });
  const {
    index = 0,
    start = 0,
    duration = 0,
    ass = "",
    hasCues = false,
    filter = "",
    crf = "23",
    audioBitrate = "128k",
    preset = "veryfast",
    hasPromo = false,
    hasVoice = false,
    hasLogo = false,
    outputWidth = 1080,
    outputHeight = 1920,
    outputFps = 30,
  } = req.body || {};

  const assName = `subs_${index}.ass`;
  const outName = `out_${index}.mp4`;
  const safeWidth = Math.max(2, Math.min(2160, Math.round(Number(outputWidth) || 1080)));
  const safeHeight = Math.max(2, Math.min(3840, Math.round(Number(outputHeight) || 1920)));
  const safeFps = Math.max(1, Math.min(60, Math.round(Number(outputFps) || 30)));
  // Le client cible /fonts (FS virtuel du worker) ; ici les polices sont dans
  // le dossier de session. Répare aussi les graphes issus d'un client ancien.
  const localFilter = ensureVideoOutput(filter, safeWidth, safeHeight, safeFps);
  let renderSlotAcquired = false;

  try {
    if (hasCues) await fs.writeFile(path.join(s.dir, assName), ass, "utf8");
    await acquireRenderSlot(req);
    renderSlotAcquired = true;
    await runFfmpeg(
      [
        "-ss", Number(start).toFixed(3),
        "-i", "input.mp4",
        "-t", Number(duration).toFixed(3),
        ...(hasPromo && hasVoice ? ["-i", "promo_vo.mp3"] : []),
        ...(hasPromo && hasLogo ? ["-i", "pause_logo.png"] : []),
        "-filter_complex", localFilter,
        "-map", "[vencoded]",
        ...(hasPromo
          ? ["-map", "[aout]"]
          : ["-map", "0:a?", "-af", "aresample=48000:async=1:first_pts=0,loudnorm=I=-14:TP=-1.5:LRA=11"]),

        "-c:v", "libx264",
        "-threads", "1",
        "-preset", String(preset),
        "-crf", String(crf),
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", String(audioBitrate),
        "-movflags", "+faststart",
        "-y", outName,
      ],
      s.dir,
      req,
    );
    const full = path.join(s.dir, outName);
    const stat = await fs.stat(full);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", String(stat.size));
    const stream = createReadStream(full);
    await new Promise((resolve) => {
      stream.pipe(res);
      const cleanup = () => {
        fs.rm(full, { force: true }).catch(() => {});
        fs.rm(path.join(s.dir, assName), { force: true }).catch(() => {});
        resolve();
      };
      stream.once("close", cleanup);
      stream.once("error", cleanup);
    });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e.message || e) });
    else res.destroy();
  } finally {
    if (renderSlotAcquired) releaseRenderSlot();
  }
});

app.delete("/session/:id", requireAuth, async (req, res) => {
  const s = sessions.get(req.params.id);
  if (s) {
    sessions.delete(req.params.id);
    await fs.rm(s.dir, { recursive: true, force: true }).catch(() => {});
  }
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[neoncut] render service on :${PORT}`);
});
