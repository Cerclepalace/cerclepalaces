import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { processVideo, type RenderMode, type Short } from "@/lib/video-processor";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NeonCut — Vidéos YouTube en Shorts TikTok avec sous-titres néon" },
      {
        name: "description",
        content:
          "Découpe une vidéo horizontale en shorts 9:16 de 60 à 80 secondes avec sous-titres néon blanc et vert générés par IA. 100% dans ton navigateur.",
      },
      { property: "og:title", content: "NeonCut — Vidéos YouTube en Shorts TikTok avec sous-titres néon" },
      {
        property: "og:description",
        content:
          "Découpe une vidéo horizontale en shorts 9:16 de 60 à 80 secondes avec sous-titres néon blanc et vert générés par IA. 100% dans ton navigateur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [segmentSec, setSegmentSec] = useState(70);
  const [renderMode, setRenderMode] = useState<RenderMode>("fast");
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(null);
  const [shorts, setShorts] = useState<Short[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const ytValid = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(youtubeUrl.trim());
  const cobaltUrl = ytValid
    ? `https://cobalt.tools/#${encodeURIComponent(youtubeUrl.trim())}`
    : "https://cobalt.tools";
  const ssyoutubeUrl = ytValid
    ? youtubeUrl.trim().replace(/youtube\.com|youtu\.be/i, "ssyoutube.com")
    : "https://ssyoutube.com";

  const handleFile = (f: File | null) => {
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
  };

  const run = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setShorts([]);
    setStatus("Démarrage…");
    try {
      const out = await processVideo({
        file,
        segmentSec,
        renderMode,
        onProgress: (info) => {
          setStatus(info.phase);
          if (info.segmentIndex !== undefined && info.totalSegments) {
            setProgress({ i: info.segmentIndex + 1, total: info.totalSegments });
          }
        },
        onShort: (short) => {
          setShorts((current) => [...current, short]);
        },
        onLog: (msg) => {
          if (msg && !msg.startsWith("frame=")) console.debug("[ffmpeg]", msg);
        },
      });
      setStatus(`${out.length} short${out.length > 1 ? "s" : ""} prêt${out.length > 1 ? "s" : ""}`);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [file, renderMode, segmentSec]);

  const download = (s: Short) => {
    const a = document.createElement("a");
    a.href = s.url;
    a.download = `short_${String(s.index + 1).padStart(2, "0")}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white">
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
            Uploade une vidéo horizontale. NeonCut la découpe en shorts 9:16 de 60 à 80 secondes,
            recadre avec fond flou et brûle des sous-titres néon générés par IA. Sur mobile, le mode
            rapide sort des fichiers plus légers pour éviter les rendus interminables.
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
            NeonCut ne peut pas télécharger YouTube directement (bloqué par le navigateur). Colle le
            lien ci-dessous, on t'ouvre un téléchargeur externe en un clic.
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
                Copie l'URL de la vidéo YouTube (barre d'adresse ou bouton "Partager").
              </li>
              <li>
                <span className="mr-2 font-bold text-[#39FF14]">2.</span>
                Colle-la dans le champ ci-dessus puis clique <b>Télécharger ↗</b>. Ça ouvre{" "}
                <a
                  href="https://cobalt.tools"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-[#39FF14]"
                >
                  cobalt.tools
                </a>{" "}
                (gratuit, sans pub, sans compte).
              </li>
              <li>
                <span className="mr-2 font-bold text-[#39FF14]">3.</span>
                Sur cobalt : choisis <b>Format : MP4</b> et <b>Qualité : 720p ou 1080p</b>, puis clique{" "}
                <b>Download</b>.
              </li>
              <li>
                <span className="mr-2 font-bold text-[#39FF14]">4.</span>
                Alternative si cobalt ne marche pas :{" "}
                <a
                  href={ssyoutubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-[#39FF14]"
                >
                  ssyoutube.com
                </a>{" "}
                (ajoute simplement <b>ss</b> devant "youtube" dans l'URL) ou{" "}
                <a
                  href="https://y2mate.nu"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-[#39FF14]"
                >
                  y2mate.nu
                </a>
                .
              </li>
              <li>
                <span className="mr-2 font-bold text-[#39FF14]">5.</span>
                Une fois le MP4 sur ton appareil, dépose-le dans la zone ci-dessous ⬇
              </li>
            </ol>
            <p className="mt-3 text-xs text-white/40">
              ⚠ Ne télécharge que des vidéos dont tu as les droits ou une licence Creative Commons.
            </p>
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
              handleFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <div className="text-4xl">🎬</div>
            <div className="text-lg font-semibold">
              {file ? file.name : "Dépose ta vidéo ici"}
            </div>
            <div className="text-xs text-white/50">
              {file
                ? `${(file.size / 1024 / 1024).toFixed(1)} Mo — touche pour changer`
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
              handleFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />

          <div className="mt-6">
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
              min={60}
              max={80}
              step={5}
              value={segmentSec}
              onChange={(e) => setSegmentSec(Number(e.target.value))}
              className="w-full accent-[#39FF14]"
              disabled={busy}
            />
            <div className="mt-1 flex justify-between text-xs text-white/40">
              <span>60s</span>
              <span>65s</span>
              <span>70s</span>
              <span>75s</span>
              <span>80s</span>
            </div>
          </div>

          <div className="mt-6">
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
            <p className="mt-2 text-xs text-white/45">
              Les shorts apparaissent un par un dès qu'ils sont prêts, sans attendre la fin complète.
            </p>
          </div>

          <Button
            onClick={run}
            disabled={!file || busy}
            className="mt-6 h-14 w-full text-base font-bold uppercase tracking-widest disabled:opacity-40"
            style={{
              backgroundColor: "#39FF14",
              color: "#050505",
              boxShadow: busy ? "none" : "0 0 24px rgba(57,255,20,0.5)",
            }}
          >
            {busy ? "Traitement en cours…" : `Générer en mode ${renderMode === "fast" ? "rapide" : "qualité"}`}
          </Button>

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
        </section>

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
