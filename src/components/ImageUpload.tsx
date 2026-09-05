import { useEffect, useRef, useState } from "react";
import { uploadMedia, type MediaPrefix } from "../lib/api";
import {
  optimizeImage,
  formatBytes,
  canOptimize,
  ImageError,
  DEFAULTS,
  type OptimizeOptions,
  type OptimizedImage,
} from "../lib/image";

type Phase = "idle" | "optimizing" | "uploading" | "done" | "error";

/**
 * Picks an image, optimises it on the device, and uploads only the result.
 *
 * The component owns the whole pipeline so no caller can accidentally send an
 * original: it never exposes the picked `File`, only the R2 key it got back.
 */
export function ImageUpload({
  prefix,
  label = "Image",
  hint,
  value,
  onUploaded,
  options,
}: {
  prefix: MediaPrefix;
  label?: string;
  hint?: string;
  /** Existing key, so an edit form can show what is already stored. */
  value?: string | null;
  onUploaded: (key: string | null) => void;
  options?: OptimizeOptions;
}) {
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>(value ? "done" : "idle");
  const [ratio, setRatio] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizedImage | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // An object URL is a live reference to a decoded blob; leaking one per pick
  // keeps whole images alive for the life of the page.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const supported = canOptimize();

  async function pick(file: File) {
    abort.current?.abort();
    abort.current = new AbortController();

    setFileName(file.name);
    setError(null);
    setPhase("optimizing");
    setRatio(0);

    try {
      const optimized = await optimizeImage(file, {
        ...options,
        onProgress: (_stage, r) => setRatio(r * 0.4),
      });

      setResult(optimized);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(optimized.file);
      });

      setPhase("uploading");
      // Only ever `optimized.file` — the original `file` is not referenced past
      // this point and is never handed to the network layer.
      const { key } = await uploadMedia(
        prefix,
        optimized.file,
        (r) => setRatio(0.4 + r * 0.6),
        abort.current.signal,
      );

      setPhase("done");
      onUploaded(key);
    } catch (err) {
      setPhase("error");
      setError(
        err instanceof ImageError || err instanceof Error
          ? err.message
          : "Échec du traitement de l'image.",
      );
    }
  }

  function clear() {
    abort.current?.abort();
    setFileName(null);
    setResult(null);
    setPhase("idle");
    setRatio(0);
    setError(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    if (input.current) input.current.value = "";
    onUploaded(null);
  }

  const busy = phase === "optimizing" || phase === "uploading";
  const shown = preview ?? (value ? `/api/media/${value}` : null);

  return (
    <div className="field">
      <label htmlFor={`upload-${prefix}`}>{label}</label>

      <div
        className="card"
        style={{ padding: 16, gap: 12, background: "var(--color-neutral-100)" }}
      >
        {shown ? (
          <img
            src={shown}
            alt=""
            className="washed"
            style={{
              width: "100%",
              maxHeight: 220,
              objectFit: "contain",
              borderRadius: "var(--radius-md)",
            }}
          />
        ) : (
          <div className="ph" style={{ height: 140, borderRadius: "var(--radius-md)" }}>
            aucune image
          </div>
        )}

        {/* Native control stays hidden: the design system has no file-input
            styling, so a .btn opens it and the name renders as plain text. */}
        <input
          id={`upload-${prefix}`}
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          disabled={!supported || busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pick(file);
          }}
          hidden
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 13 }}
            disabled={!supported || busy}
            onClick={() => input.current?.click()}
          >
            Choisir une image
          </button>
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            {fileName ?? "Aucun fichier choisi"}
          </span>
        </div>

        {busy && (
          <div>
            <div
              role="progressbar"
              aria-valuenow={Math.round(ratio * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                height: 6,
                borderRadius: 999,
                background: "var(--color-neutral-300)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.round(ratio * 100)}%`,
                  height: "100%",
                  background: "var(--color-accent)",
                  transition: "width .2s",
                }}
              />
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 12, opacity: 0.7 }}>
              {phase === "optimizing" ? "Optimisation sur votre appareil…" : "Envoi…"}
            </p>
          </div>
        )}

        {phase === "done" && result && (
          <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
            {result.originalWidth}×{result.originalHeight} · {formatBytes(result.originalBytes)} →{" "}
            <strong>
              {result.width}×{result.height} · {formatBytes(result.bytes)}
            </strong>{" "}
            {result.mimeType === "image/webp" ? "WebP" : "JPEG"}
            {result.originalBytes > result.bytes &&
              ` · −${Math.round((1 - result.bytes / result.originalBytes) * 100)} %`}
            {result.usedFallback && " (WebP non pris en charge par ce navigateur)"}
          </p>
        )}

        {error && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-accent-700)" }}>{error}</p>
        )}

        {!supported && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-accent-700)" }}>
            Votre navigateur ne peut pas préparer les images. Utilisez un navigateur récent.
          </p>
        )}

        {(shown || error) && (
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={clear}>
            Retirer
          </button>
        )}

        <p style={{ margin: 0, fontSize: 11, opacity: 0.6 }}>
          {hint ??
            `Redimensionnée à ${options?.maxDimension ?? DEFAULTS.maxDimension} px et convertie en WebP sur votre appareil. L'original n'est pas envoyé.`}
        </p>
      </div>
    </div>
  );
}
