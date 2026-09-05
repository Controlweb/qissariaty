/**
 * Client-side image optimisation.
 *
 * A phone photograph is routinely 4000×3000 and 8 MB; the largest it is ever
 * displayed here is a ~1400px hero. Sending the original wastes the visitor's
 * upload bandwidth (the scarce direction on mobile data), their battery, and
 * R2 storage — so the browser resizes and re-encodes before anything leaves the
 * device. The original bytes are never transmitted.
 *
 * No dependencies: `createImageBitmap` + `OffscreenCanvas` do the whole job.
 */

export type OptimizeOptions = {
  /** Longest side of the output, in pixels. Never upscales. */
  maxDimension?: number;
  /** 0–1. WebP at 0.8 is visually near-lossless at these sizes. */
  quality?: number;
  /** Preferred output format. */
  mimeType?: string;
  /** Used when the browser cannot encode `mimeType`. */
  fallbackMimeType?: string;
  /** Refuse anything larger than this *before* decoding it. */
  maxInputBytes?: number;
  onProgress?: (stage: OptimizeStage, ratio: number) => void;
};

export type OptimizeStage = "decoding" | "resizing" | "encoding" | "done";

export type OptimizedImage = {
  file: File;
  mimeType: string;
  width: number;
  height: number;
  originalBytes: number;
  bytes: number;
  originalWidth: number;
  originalHeight: number;
  /** True when the browser could not produce `mimeType` and fell back. */
  usedFallback: boolean;
};

export class ImageError extends Error {}

export const DEFAULTS = {
  maxDimension: 1920,
  quality: 0.8,
  mimeType: "image/webp",
  fallbackMimeType: "image/jpeg",
  // Generous: this is the *input* ceiling, and a 50 MP phone photo is ~25 MB.
  maxInputBytes: 32 * 1024 * 1024,
} satisfies Required<Omit<OptimizeOptions, "onProgress">>;

/** Formats we can hand to `createImageBitmap` with confidence. */
const DECODABLE = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/bmp"];

/**
 * Scale a box to fit inside `max` on its longest side.
 *
 * Only ever shrinks — a 600px image asked to fit 1920 comes back unchanged
 * rather than being blown up into a bigger, blurrier file.
 */
export function fitWithin(width: number, height: number, max: number) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height, scaled: false };
  const ratio = max / longest;
  return {
    // round, not floor: floor loses a pixel and can shift the aspect ratio.
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

let encoderSupport: Map<string, boolean> | null = null;

/** Can this browser *encode* the given type? Safari lacked WebP until 14. */
async function canEncode(type: string): Promise<boolean> {
  encoderSupport ??= new Map();
  const cached = encoderSupport.get(type);
  if (cached !== undefined) return cached;

  let ok = false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    // toDataURL silently falls back to PNG when the type is unsupported, so
    // the returned prefix — not the absence of a throw — is the real signal.
    ok = canvas.toDataURL(type).startsWith(`data:${type}`);
  } catch {
    ok = false;
  }
  encoderSupport.set(type, ok);
  return ok;
}

/** True when this browser can run the pipeline at all. */
export function canOptimize(): boolean {
  return (
    typeof createImageBitmap === "function" &&
    (typeof OffscreenCanvas === "function" || typeof document !== "undefined")
  );
}

async function toBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: string,
  quality: number,
): Promise<Blob> {
  // OffscreenCanvas keeps the work off the main thread's layout path and is
  // cheaper for large surfaces; the DOM canvas is the fallback.
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new ImageError("2D context unavailable");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type, quality });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new ImageError("2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageError("encoding produced no data"))),
      type,
      quality,
    );
  });
}

const extensionFor = (mimeType: string) => (mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1]!);

/** `IMG_1234.JPG` → `IMG_1234.webp` — name and extension must agree with the bytes. */
function rename(original: string, mimeType: string) {
  const stem = original.replace(/\.[^./\\]+$/, "") || "image";
  // Strip anything a server or filesystem would rather not see.
  const safe = stem.replace(/[^\w.-]+/g, "-").slice(0, 60);
  return `${safe}.${extensionFor(mimeType)}`;
}

/**
 * Decode → resize → re-encode, entirely on the device.
 *
 * `imageOrientation: "from-image"` is what stops phone photos arriving on their
 * side: EXIF orientation is baked into the pixels here, so the uploaded file
 * needs no orientation metadata and no viewer has to honour any.
 */
export async function optimizeImage(
  file: File,
  options: OptimizeOptions = {},
): Promise<OptimizedImage> {
  const {
    maxDimension,
    quality,
    mimeType,
    fallbackMimeType,
    maxInputBytes,
    onProgress,
  } = { ...DEFAULTS, ...options };

  if (!file.type.startsWith("image/")) {
    throw new ImageError("Ce fichier n'est pas une image.");
  }
  if (!DECODABLE.includes(file.type)) {
    // HEIC is the notable absentee: iOS converts to JPEG on <input> selection,
    // but a file picked from cloud storage can still arrive as HEIC.
    throw new ImageError(`Format non pris en charge : ${file.type}`);
  }
  if (file.size > maxInputBytes) {
    throw new ImageError(`Image trop lourde (max ${Math.round(maxInputBytes / 1024 / 1024)} Mo).`);
  }
  if (!canOptimize()) {
    throw new ImageError("Votre navigateur ne peut pas optimiser les images.");
  }

  onProgress?.("decoding", 0);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (err) {
    throw new ImageError(`Image illisible ou corrompue (${(err as Error).message})`);
  }

  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  if (!originalWidth || !originalHeight) {
    bitmap.close();
    throw new ImageError("Image de dimensions nulles.");
  }

  onProgress?.("resizing", 0.35);
  const target = fitWithin(originalWidth, originalHeight, maxDimension);

  onProgress?.("encoding", 0.6);
  let outputType = mimeType;
  let usedFallback = false;
  if (!(await canEncode(outputType))) {
    outputType = fallbackMimeType;
    usedFallback = true;
    if (!(await canEncode(outputType))) {
      bitmap.close();
      // Deliberately fail rather than fall back to sending the original: the
      // whole point is that the untouched file never leaves the device.
      throw new ImageError("Votre navigateur ne peut convertir cette image.");
    }
  }

  let blob: Blob;
  try {
    blob = await toBlob(bitmap, target.width, target.height, outputType, quality);
  } finally {
    // Frees the decoded surface immediately instead of waiting for GC — this
    // is what keeps several large phone photos in a row from exhausting memory.
    bitmap.close();
  }

  if (!blob.size) throw new ImageError("La conversion a produit un fichier vide.");

  onProgress?.("done", 1);

  return {
    file: new File([blob], rename(file.name, outputType), {
      type: outputType,
      lastModified: Date.now(),
    }),
    mimeType: outputType,
    width: target.width,
    height: target.height,
    originalBytes: file.size,
    bytes: blob.size,
    originalWidth,
    originalHeight,
    usedFallback,
  };
}

/** "8.4 Mo" — for showing the visitor what their device just saved them. */
export const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} o`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} Ko`
      : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
