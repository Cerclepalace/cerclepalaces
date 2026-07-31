import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { renderPromoShort, type LogoPosition } from "@/lib/promo-render";
import { probeDuration } from "@/lib/video-processor";
import defaultLogo from "@/assets/promo-pause-logo.png.asset.json";
import vo1 from "@/assets/vo/vo-1.mp3.asset.json";
import vo2 from "@/assets/vo/vo-2.mp3.asset.json";
import vo3 from "@/assets/vo/vo-3.mp3.asset.json";
import vo4 from "@/assets/vo/vo-4.mp3.asset.json";
import vo5 from "@/assets/vo/vo-5.mp3.asset.json";
import vo6 from "@/assets/vo/vo-6.mp3.asset.json";
import vo7 from "@/assets/vo/vo-7.mp3.asset.json";
import vo8 from "@/assets/vo/vo-8.mp3.asset.json";

const VO_PRESETS = [vo1, vo2, vo3, vo4, vo5, vo6, vo7, vo8].map((a, i) => ({
  id: `preset-${i + 1}`,
  label: `Voix ${i + 1}`,
  url: a.url,
}));

const TITLE = "Promo Pause — Short vertical 9:16 avec pause promo";
const DESC =
  "Transforme une vidéo en short 9:16 avec une pause promotionnelle incrustée : image figée, voix off, texte et logo. Tout se passe dans ton navigateur.";

export const Route = createFileRoute("/promo")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PromoPage,
});

const STEPS = ["Import", "Cadrage", "Pause promo", "Voix & logo", "Export"];

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function PromoPage() {
  const [step, setStep] = useState(0);

  // source
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [natural, setNatural] = useState({ w: 16, h: 9 });

  // trim + crop
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [cropX, setCropX] = useState(0.5);
  const [cropZoom, setCropZoom] = useState(1);

  // promo pause
  const [pauseEnabled, setPauseEnabled] = useState(true);
  const [pauseAt, setPauseAt] = useState(5);
  const [pauseDuration, setPauseDuration] = useState(7);
  const [promoText, setPromoText] = useState("OFFRE SPÉCIALE\nLIEN EN BIO");
  const [duckDb, setDuckDb] = useState(20);

  // voice
  const [voiceMode, setVoiceMode] = useState<"preset" | "upload" | "tts">(
    "preset",
  );
  const [presetId, setPresetId] = useState(VO_PRESETS[0].id);
  const [voFile, setVoFile] = useState<File | null>(null);
  const [ttsText, setTtsText] = useState(
    "Profite de l'offre spéciale, le lien est en bio !",
  );
  const [ttsVoiceId, setTtsVoiceId] = useState("EXAVITQu4vr4xnSDxMaL");
  const [ttsBlob, setTtsBlob] = useState<Blob | null>(null);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);

  // logo
  const [useLogo, setUseLogo] = useState(true);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPosition, setLogoPosition] =
    useState<LogoPosition>("bottom-center");
  const [logoScale, setLogoScale] = useState(0.28);
  const [logoOpacity, setLogoOpacity] = useState(0.9);
  const [logoAlways, setLogoAlways] = useState(false);

  // export
  const [quality, setQuality] = useState<"fast" | "premium">("premium");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const onPick = useCallback(async (f: File) => {
    setError(null);
    setResult(null);
    setFile(f);
    const url = URL.createObjectURL(f);
    setVideoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
    try {
      const d = await probeDuration(f);
      setDuration(d);
      setTrimStart(0);
      setTrimEnd(Math.min(d, 60));
      setPauseAt(Math.min(5, Math.max(1, d / 4)));
      setStep(1);
    } catch {
      setError("Impossible de lire cette vidéo.");
    }
  }, []);

  const clipDur = Math.max(0, trimEnd - trimStart);

  // 9:16 window position over the displayed video (as % of width)
  const windowWidthPct = useMemo(() => {
    const srcAspect = natural.w / natural.h;
    const target = 9 / 16;
    const w = target / srcAspect / cropZoom;
    return Math.min(1, w) * 100;
  }, [natural, cropZoom]);

  const windowLeftPct = useMemo(
    () => (100 - windowWidthPct) * cropX,
    [windowWidthPct, cropX],
  );

  const setCropFromPointer = useCallback(
    (clientX: number) => {
      const el = previewWrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const half = (windowWidthPct / 100) * r.width * 0.5;
      const usable = Math.max(1, r.width - half * 2);
      const x = clientX - r.left - half;
      setCropX(Math.min(1, Math.max(0, x / usable)));
    },
    [windowWidthPct],
  );

  const voiceBlob = useMemo(() => {
    if (!pauseEnabled) return null;
    if (voiceMode === "upload") return voFile;
    if (voiceMode === "tts") return ttsBlob;
    return null;
  }, [pauseEnabled, voiceMode, voFile, ttsBlob]);

  const generateTts = useCallback(async () => {
    setTtsBusy(true);
    setTtsError(null);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: ttsText, voiceId: ttsVoiceId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Erreur ${res.status}`);
      }
      setTtsBlob(await res.blob());
    } catch (e) {
      setTtsError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setTtsBusy(false);
    }
  }, [ttsText, ttsVoiceId]);

  const doRender = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      let vo: Blob | null = voiceBlob;
      if (pauseEnabled && voiceMode === "preset") {
        const preset = VO_PRESETS.find((p) => p.id === presetId);
        if (preset) vo = await (await fetch(preset.url)).blob();
      }
      let logo: Blob | null = null;
      if (useLogo) {
        logo = logoFile ?? (await (await fetch(defaultLogo.url)).blob());
      }

      const blob = await renderPromoShort({
        file,
        trimStart,
        trimEnd,
        cropX,
        cropZoom,
        pauseEnabled,
        pauseAt,
        pauseDuration,
        promoText,
        voiceover: vo,
        duckDb,
        logo,
        logoPosition,
        logoScale,
        logoOpacity,
        logoAlwaysVisible: logoAlways,
        quality,
        signal: ctrl.signal,
        onProgress: (p) => {
          setPhase(p.phase);
          if (typeof p.progress === "number") setProgress(p.progress);
        },
      });
      setResult(URL.createObjectURL(blob));
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setError(e instanceof Error ? e.message : "Le rendu a échoué.");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [
    file,
    trimStart,
    trimEnd,
    cropX,
    cropZoom,
    pauseEnabled,
    pauseAt,
    pauseDuration,
    promoText,
    voiceBlob,
    voiceMode,
    presetId,
    duckDb,
    useLogo,
    logoFile,
    logoPosition,
    logoScale,
    logoOpacity,
    logoAlways,
    quality,
  ]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <header className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Promo Pause
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Short vertical 9:16 avec pause promotionnelle incrustée.
              </p>
            </div>
            <Link
              to="/"
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              ← NeonCut
            </Link>
          </div>

          <ol className="mt-6 flex flex-wrap gap-2">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={i > 0 && !file}
                  onClick={() => setStep(i)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    i === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  } disabled:opacity-40`}
                >
                  {i + 1}. {s}
                </button>
              </li>
            ))}
          </ol>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <section className="space-y-6 rounded-xl border border-border bg-card p-5">
            {/* STEP 0 — import */}
            {step === 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">1. Importe ta vidéo</h2>
                <p className="text-sm text-muted-foreground">
                  MP4, MOV ou WebM. Le traitement reste sur ton appareil.
                </p>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-12 text-center transition-colors hover:border-primary">
                  <span className="text-sm font-medium">
                    Choisir un fichier vidéo
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ou glisse-dépose ici
                  </span>
                  <input
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm,video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onPick(f);
                    }}
                  />
                </label>
                {file ? (
                  <p className="text-sm text-muted-foreground">
                    {file.name} — {fmt(duration)}
                  </p>
                ) : null}
              </div>
            )}

            {/* STEP 1 — cadrage */}
            {step === 1 && (
              <div className="space-y-5">
                <h2 className="text-lg font-semibold">
                  2. Cadrage 9:16 et découpe
                </h2>
                <Field
                  label="Position du cadre"
                  hint="Glisse sur l'aperçu ou utilise le curseur"
                >
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={cropX}
                    onChange={(e) => setCropX(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </Field>
                <Field label="Zoom" hint={`${cropZoom.toFixed(2)}×`}>
                  <input
                    type="range"
                    min={1}
                    max={2}
                    step={0.01}
                    value={cropZoom}
                    onChange={(e) => setCropZoom(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Début" hint={fmt(trimStart)}>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0.1, duration)}
                      step={0.1}
                      value={trimStart}
                      onChange={(e) => {
                        const v = Math.min(Number(e.target.value), trimEnd - 1);
                        setTrimStart(Math.max(0, v));
                        if (videoRef.current) videoRef.current.currentTime = v;
                      }}
                      className="w-full accent-primary"
                    />
                  </Field>
                  <Field label="Fin" hint={fmt(trimEnd)}>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0.1, duration)}
                      step={0.1}
                      value={trimEnd}
                      onChange={(e) => {
                        const v = Math.max(
                          Number(e.target.value),
                          trimStart + 1,
                        );
                        setTrimEnd(Math.min(duration, v));
                      }}
                      className="w-full accent-primary"
                    />
                  </Field>
                </div>
                <p className="text-sm text-muted-foreground">
                  Durée du short : <strong>{clipDur.toFixed(1)}s</strong>
                  {pauseEnabled
                    ? ` (+ ${pauseDuration.toFixed(1)}s de pause promo)`
                    : ""}
                </p>
              </div>
            )}

            {/* STEP 2 — promo */}
            {step === 2 && (
              <div className="space-y-5">
                <h2 className="text-lg font-semibold">3. Pause promo</h2>
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={pauseEnabled}
                    onChange={(e) => setPauseEnabled(e.target.checked)}
                    className="size-4 accent-primary"
                  />
                  Activer la pause promotionnelle (image figée)
                </label>
                <Field
                  label="Moment de la pause"
                  hint={`${pauseAt.toFixed(1)}s`}
                >
                  <input
                    type="range"
                    min={0.5}
                    max={Math.max(1, clipDur - 0.5)}
                    step={0.1}
                    value={Math.min(pauseAt, Math.max(1, clipDur - 0.5))}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPauseAt(v);
                      if (videoRef.current)
                        videoRef.current.currentTime = trimStart + v;
                    }}
                    disabled={!pauseEnabled}
                    className="w-full accent-primary"
                  />
                </Field>
                <Field
                  label="Durée de la pause"
                  hint={`${pauseDuration.toFixed(1)}s`}
                >
                  <input
                    type="range"
                    min={2}
                    max={15}
                    step={0.5}
                    value={pauseDuration}
                    onChange={(e) => setPauseDuration(Number(e.target.value))}
                    disabled={!pauseEnabled}
                    className="w-full accent-primary"
                  />
                </Field>
                <Field label="Texte promo" hint="3 lignes max">
                  <textarea
                    rows={3}
                    value={promoText}
                    onChange={(e) => setPromoText(e.target.value)}
                    disabled={!pauseEnabled}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </Field>
                <Field
                  label="Atténuation du son original"
                  hint={`-${duckDb} dB`}
                >
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={duckDb}
                    onChange={(e) => setDuckDb(Number(e.target.value))}
                    disabled={!pauseEnabled}
                    className="w-full accent-primary"
                  />
                </Field>
              </div>
            )}

            {/* STEP 3 — voix & logo */}
            {step === 3 && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold">4. Voix off & logo</h2>

                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["preset", "Mes voix"],
                        ["upload", "Fichier"],
                        ["tts", "Synthèse IA"],
                      ] as const
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setVoiceMode(k)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                          voiceMode === k
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>

                  {voiceMode === "preset" && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {VO_PRESETS.map((p) => (
                        <div
                          key={p.id}
                          className={`flex items-center gap-2 rounded-md border p-2 ${
                            presetId === p.id
                              ? "border-primary bg-accent"
                              : "border-border"
                          }`}
                        >
                          <input
                            type="radio"
                            name="vo"
                            checked={presetId === p.id}
                            onChange={() => setPresetId(p.id)}
                            className="accent-primary"
                          />
                          <span className="text-xs font-medium">{p.label}</span>
                          <audio
                            controls
                            preload="none"
                            src={p.url}
                            className="ml-auto h-7 w-32"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {voiceMode === "upload" && (
                    <input
                      type="file"
                      accept="audio/mpeg,audio/wav,audio/*"
                      onChange={(e) => setVoFile(e.target.files?.[0] ?? null)}
                      className="text-sm"
                    />
                  )}

                  {voiceMode === "tts" && (
                    <div className="space-y-3">
                      <textarea
                        rows={2}
                        value={ttsText}
                        onChange={(e) => setTtsText(e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                      <select
                        value={ttsVoiceId}
                        onChange={(e) => setTtsVoiceId(e.target.value)}
                        className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        <option value="EXAVITQu4vr4xnSDxMaL">Sarah</option>
                        <option value="JBFqnCBsd6RMkjVDRZzb">George</option>
                        <option value="XrExE9yKIg1WjnnlVkGX">Matilda</option>
                        <option value="onwK4e9ZLuTAKqWW03F9">Daniel</option>
                      </select>
                      <Button
                        type="button"
                        onClick={() => void generateTts()}
                        disabled={ttsBusy}
                      >
                        {ttsBusy ? "Génération…" : "Générer la voix"}
                      </Button>
                      {ttsBlob ? (
                        <audio
                          controls
                          src={URL.createObjectURL(ttsBlob)}
                          className="w-full"
                        />
                      ) : null}
                      {ttsError ? (
                        <p className="text-xs text-destructive">{ttsError}</p>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="space-y-3 border-t border-border pt-4">
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={useLogo}
                      onChange={(e) => setUseLogo(e.target.checked)}
                      className="size-4 accent-primary"
                    />
                    Afficher un logo / watermark
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/webp"
                    onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                    disabled={!useLogo}
                    className="text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Sans fichier, ton logo « pause » importé est utilisé.
                  </p>
                  <Field label="Position">
                    <select
                      value={logoPosition}
                      onChange={(e) =>
                        setLogoPosition(e.target.value as LogoPosition)
                      }
                      disabled={!useLogo}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="top-left">Haut gauche</option>
                      <option value="top-center">Haut centre</option>
                      <option value="top-right">Haut droite</option>
                      <option value="center">Centre</option>
                      <option value="bottom-left">Bas gauche</option>
                      <option value="bottom-center">Bas centre</option>
                      <option value="bottom-right">Bas droite</option>
                    </select>
                  </Field>
                  <Field
                    label="Taille"
                    hint={`${Math.round(logoScale * 100)}% de la largeur`}
                  >
                    <input
                      type="range"
                      min={0.08}
                      max={0.7}
                      step={0.01}
                      value={logoScale}
                      onChange={(e) => setLogoScale(Number(e.target.value))}
                      disabled={!useLogo}
                      className="w-full accent-primary"
                    />
                  </Field>
                  <Field
                    label="Opacité"
                    hint={`${Math.round(logoOpacity * 100)}%`}
                  >
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={logoOpacity}
                      onChange={(e) => setLogoOpacity(Number(e.target.value))}
                      disabled={!useLogo}
                      className="w-full accent-primary"
                    />
                  </Field>
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={logoAlways}
                      onChange={(e) => setLogoAlways(e.target.checked)}
                      disabled={!useLogo}
                      className="size-4 accent-primary"
                    />
                    Visible sur toute la vidéo (sinon seulement pendant la
                    pause)
                  </label>
                </div>
              </div>
            )}

            {/* STEP 4 — export */}
            {step === 4 && (
              <div className="space-y-5">
                <h2 className="text-lg font-semibold">5. Export</h2>
                <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Qualité maximale : 1080×1920 · CRF 19 · audio 192k (automatique).
                </div>

                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>• Format : 1080×1920 (9:16)</li>
                  <li>
                    • Durée finale :{" "}
                    {(clipDur + (pauseEnabled ? pauseDuration : 0)).toFixed(1)}s
                  </li>
                  <li>
                    • Pause promo :{" "}
                    {pauseEnabled
                      ? `à ${pauseAt.toFixed(1)}s pendant ${pauseDuration.toFixed(1)}s`
                      : "désactivée"}
                  </li>
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void doRender()}
                    disabled={!file || busy}
                  >
                    {busy ? "Rendu en cours…" : "Générer le short"}
                  </Button>
                  {busy ? (
                    <Button
                      variant="destructive"
                      onClick={() => {
                        abortRef.current?.abort();
                        setBusy(false);
                      }}
                    >
                      ⏹ Annuler
                    </Button>
                  ) : null}
                </div>
                {busy ? (
                  <div className="space-y-1">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {phase} — {Math.round(progress * 100)}%
                    </p>
                  </div>
                ) : null}
                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : null}
                {result ? (
                  <div className="space-y-3">
                    <video
                      src={result}
                      controls
                      playsInline
                      className="mx-auto max-h-[60vh] rounded-lg border border-border"
                    />
                    <a
                      href={result}
                      download="promo-short.mp4"
                      className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Télécharger le MP4
                    </a>
                  </div>
                ) : null}
              </div>
            )}

            <div className="flex justify-between border-t border-border pt-4">
              <Button
                variant="secondary"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
              >
                Précédent
              </Button>
              <Button
                onClick={() => setStep((s) => Math.min(4, s + 1))}
                disabled={!file || step === 4}
              >
                Suivant
              </Button>
            </div>
          </section>

          {/* preview */}
          <aside className="space-y-3">
            <h3 className="text-sm font-semibold">Aperçu du cadrage</h3>
            <div
              ref={previewWrapRef}
              className="relative overflow-hidden rounded-lg border border-border bg-muted"
              onPointerDown={(e) => {
                draggingRef.current = true;
                setCropFromPointer(e.clientX);
              }}
              onPointerMove={(e) => {
                if (draggingRef.current) setCropFromPointer(e.clientX);
              }}
              onPointerUp={() => {
                draggingRef.current = false;
              }}
              onPointerLeave={() => {
                draggingRef.current = false;
              }}
            >
              {videoUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    playsInline
                    muted
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      setNatural({
                        w: v.videoWidth || 16,
                        h: v.videoHeight || 9,
                      });
                    }}
                    className="w-full"
                  />
                  <div
                    className="pointer-events-none absolute inset-y-0 border-2 border-primary"
                    style={{
                      left: `${windowLeftPct}%`,
                      width: `${windowWidthPct}%`,
                    }}
                  />
                </>
              ) : (
                <div className="flex aspect-video items-center justify-center text-xs text-muted-foreground">
                  Aucune vidéo
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Le rectangle indique la zone conservée en 9:16.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
