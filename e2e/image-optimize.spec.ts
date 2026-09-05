import { test, expect, type Page } from "@playwright/test";

/**
 * The optimiser only exists in a browser (createImageBitmap / OffscreenCanvas),
 * so it cannot be covered by the Worker test pool. Vite serves and transforms
 * TS on demand during `pnpm dev`, which lets these run the real module rather
 * than a re-implementation.
 */
type Result = {
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
  mimeType: string;
  name: string;
  originalWidth: number;
  originalHeight: number;
};

/** Builds a genuine encoded image in-page, then optimises it. */
async function run(
  page: Page,
  spec: {
    w: number;
    h: number;
    type: "image/jpeg" | "image/png";
    name: string;
    transparent?: boolean;
    options?: Record<string, unknown>;
  },
): Promise<Result> {
  return page.evaluate(async (s) => {
    const { optimizeImage } = await import(/* @vite-ignore */ "/src/lib/image.ts");

    const canvas = document.createElement("canvas");
    canvas.width = s.w;
    canvas.height = s.h;
    const ctx = canvas.getContext("2d")!;
    if (!s.transparent) {
      ctx.fillStyle = "#c67139";
      ctx.fillRect(0, 0, s.w, s.h);
    }
    // Detail so the encoder cannot trivially compress to nothing.
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `hsl(${(i * 7) % 360} 70% 50%)`;
      ctx.fillRect((i * 37) % s.w, (i * 53) % s.h, s.w / 12, s.h / 12);
    }

    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), s.type, 0.92));
    const file = new File([blob], s.name, { type: s.type });
    const out = await optimizeImage(file, s.options ?? {});

    return {
      width: out.width,
      height: out.height,
      bytes: out.bytes,
      originalBytes: out.originalBytes,
      mimeType: out.mimeType,
      name: out.file.name,
      originalWidth: out.originalWidth,
      originalHeight: out.originalHeight,
    };
  }, spec);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("a large phone-sized JPEG is resized, converted and shrunk", async ({ page }) => {
  const out = await run(page, { w: 4032, h: 3024, type: "image/jpeg", name: "IMG_1234.JPG" });

  // 4032×3024 is 4:3; the long side lands exactly on the 1920 cap.
  expect(out.originalWidth).toBe(4032);
  expect(out.width).toBe(1920);
  expect(out.height).toBe(1440);
  expect(out.mimeType).toBe("image/webp");
  expect(out.name).toBe("IMG_1234.webp");
  expect(out.bytes).toBeLessThan(out.originalBytes);
});

test("aspect ratio survives a non-square source", async ({ page }) => {
  const out = await run(page, { w: 3000, h: 1000, type: "image/jpeg", name: "pano.jpg" });
  expect(out.width).toBe(1920);
  expect(out.height).toBe(640);
  expect(out.width / out.height).toBeCloseTo(3, 2);
});

test("an image already under the cap is not upscaled", async ({ page }) => {
  const out = await run(page, { w: 320, h: 240, type: "image/png", name: "small.png" });
  expect(out.width).toBe(320);
  expect(out.height).toBe(240);
  expect(out.mimeType).toBe("image/webp");
});

test("maxDimension and quality are configurable", async ({ page }) => {
  const small = await run(page, {
    w: 2000,
    h: 2000,
    type: "image/jpeg",
    name: "q.jpg",
    options: { maxDimension: 512, quality: 0.4 },
  });
  expect(small.width).toBe(512);

  const large = await run(page, {
    w: 2000,
    h: 2000,
    type: "image/jpeg",
    name: "q.jpg",
    options: { maxDimension: 512, quality: 0.95 },
  });
  // Higher quality at identical dimensions must cost more bytes.
  expect(large.bytes).toBeGreaterThan(small.bytes);
});

test("transparency survives the conversion to WebP", async ({ page }) => {
  const alpha = await page.evaluate(async () => {
    const { optimizeImage } = await import(/* @vite-ignore */ "/src/lib/image.ts");

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    // Left half opaque, right half fully transparent.
    ctx.fillStyle = "#7a8a5e";
    ctx.fillRect(0, 0, 100, 200);

    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
    const out = await optimizeImage(new File([blob], "logo.png", { type: "image/png" }));

    // Decode the *output* and sample both halves.
    const bitmap = await createImageBitmap(out.file);
    const check = document.createElement("canvas");
    check.width = bitmap.width;
    check.height = bitmap.height;
    const cctx = check.getContext("2d")!;
    cctx.drawImage(bitmap, 0, 0);
    return {
      opaque: cctx.getImageData(20, 100, 1, 1).data[3],
      transparent: cctx.getImageData(180, 100, 1, 1).data[3],
      type: out.mimeType,
    };
  });

  expect(alpha.type).toBe("image/webp");
  expect(alpha.opaque).toBe(255);
  // Would be 255 if the pipeline flattened onto an opaque background.
  expect(alpha.transparent).toBe(0);
});

test("EXIF orientation is baked in, so phone photos are not sideways", async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { optimizeImage } = await import(/* @vite-ignore */ "/src/lib/image.ts");

    // A landscape JPEG tagged Orientation=6 ("rotate 90° CW to display"), which
    // is what a phone held upright actually writes.
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#c67139";
    ctx.fillRect(0, 0, 1200, 600);

    const plain: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.9));
    const raw = new Uint8Array(await plain.arrayBuffer());

    // Splice a little-endian TIFF header carrying one IFD entry: tag 0x0112
    // (Orientation) = 6, as an APP1 segment right after SOI.
    //
    // The APP1 length counts itself but not the 0xFFE1 marker, and the IFD must
    // be terminated by a 4-byte next-IFD offset — omit either and browsers
    // silently ignore the whole block, which looks exactly like a pipeline that
    // handles orientation correctly.
    const exif = [
      0xff, 0xe1, 0x00, 0x22, // APP1, length 34 = 2 + 6 + 8 + 2 + 12 + 4
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // II*, IFD0 at offset 8
      0x01, 0x00, // one entry
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, // orientation = 6
      0x00, 0x00, 0x00, 0x00, // no further IFD
    ];
    const tagged = new Uint8Array(2 + exif.length + (raw.length - 2));
    tagged.set(raw.subarray(0, 2), 0);
    tagged.set(exif, 2);
    tagged.set(raw.subarray(2), 2 + exif.length);

    const file = new File([tagged], "IMG_9999.JPG", { type: "image/jpeg" });
    const result = await optimizeImage(file);
    return { width: result.width, height: result.height };
  });

  // Stored landscape, displayed portrait: the optimiser must emit portrait
  // pixels, because the output carries no EXIF for a viewer to honour.
  expect(out.height).toBeGreaterThan(out.width);
  expect(out.width).toBe(600);
  expect(out.height).toBe(1200);
});

test("non-images and unsupported formats are refused, not uploaded", async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const { optimizeImage } = await import(/* @vite-ignore */ "/src/lib/image.ts");
    const out: string[] = [];

    for (const file of [
      new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" }),
      new File([new Uint8Array([1, 2, 3])], "photo.heic", { type: "image/heic" }),
      new File([new Uint8Array([1, 2, 3])], "broken.png", { type: "image/png" }),
    ]) {
      try {
        await optimizeImage(file);
        out.push("NO ERROR");
      } catch (e) {
        out.push((e as Error).constructor.name);
      }
    }
    return out;
  });

  expect(errors).toEqual(["ImageError", "ImageError", "ImageError"]);
});

test("the upload request carries the WebP, never the original bytes", async ({ page }) => {
  // Playwright cannot read the body of an XHR blob upload, so the page itself
  // records what `send` was handed — which is the byte-level ground truth.
  await page.addInitScript(() => {
    const original = XMLHttpRequest.prototype.send;
    (window as any).__sent = [];
    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      if (body instanceof Blob) {
        const blob = body;
        void blob.arrayBuffer().then((buf) => {
          const b = new Uint8Array(buf);
          const ascii = (from: number, to: number) =>
            String.fromCharCode(...b.subarray(from, to));
          (window as any).__sent.push({
            size: b.byteLength,
            type: blob.type,
            riff: ascii(0, 4),
            webp: ascii(8, 12),
            jpegSoi: b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
          });
        });
      }
      return original.call(this, body as XMLHttpRequestBodyInit);
    };
  });

  await page.goto("/connexion");
  await page.getByLabel("Email").fill("owner@qissariaty.ma");
  await page.getByLabel("Mot de passe").fill("qissariaty-dev");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/vendeur");
  await page.getByRole("button", { name: "Produits" }).click();
  await page.getByRole("button", { name: "Ajouter un produit" }).click();

  const jpeg = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 4032;
    c.height = 3024;
    const ctx = c.getContext("2d")!;
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `hsl(${(i * 11) % 360} 80% 50%)`;
      ctx.fillRect((i * 97) % 4032, (i * 61) % 3024, 400, 400);
    }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.95));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });

  const original = Buffer.from(jpeg);
  // Flat synthetic blocks compress better than a real photo; ~400 KB is still
  // far larger than any optimised output, which is all this needs to prove.
  expect(original.byteLength).toBeGreaterThan(300_000);

  const upload = page.waitForRequest(
    (r) => r.url().includes("/api/media/products") && r.method() === "POST",
  );

  await page.locator('input[type="file"]').setInputFiles({
    name: "IMG_1234.JPG",
    mimeType: "image/jpeg",
    buffer: original,
  });

  const req = await upload;
  expect(req.headers()["content-type"]).toBe("image/webp");

  await expect(page.getByText(/1920×1440/)).toBeVisible();

  const sent = await page.evaluate(() => (window as any).__sent as {
    size: number;
    type: string;
    riff: string;
    webp: string;
    jpegSoi: boolean;
  }[]);

  expect(sent).toHaveLength(1);
  const [payload] = sent;
  // The wire format is genuinely WebP…
  expect(payload!.type).toBe("image/webp");
  expect(payload!.riff).toBe("RIFF");
  expect(payload!.webp).toBe("WEBP");
  // …it is not a JPEG…
  expect(payload!.jpegSoi).toBe(false);
  // …and it is nothing like the original in size.
  expect(payload!.size).toBeLessThan(original.byteLength);
  expect(payload!.size).not.toBe(original.byteLength);

  await expect(page.getByText(/4032×3024/)).toBeVisible();
});
