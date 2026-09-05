// Downloads + optimizes the seed photography set (run once, outputs committed).
//
// Usage: node scripts/fetch-seed-media.mjs
// Output: seed-media/*.jpg — max 1400px wide, JPEG q72, no metadata.
//
// Licensing: Unsplash License + Pexels License both allow free use, including
// commercial, without permission. Photographers are credited below and in
// seed-media/ATTRIBUTION.md as a courtesy.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "seed-media");

/** ZS: `w` caps width, `q` keeps each file ~100–200 KB. */
const U = (id) => `https://images.unsplash.com/${id}?fm=jpg&w=1600&q=70&auto=format&fit=crop`;
/** ZL: pre-cropped landscape for the wide market heroes. */
const UL = (id) => `https://images.unsplash.com/${id}?fm=jpg&w=1600&h=1000&q=70&auto=format&fit=crop`;

export const MANIFEST = [
  {
    file: "habous.jpg",
    key: "markets/a1000000-0000-4000-8000-000000000001.jpg",
    url: U("photo-1762538190295-276692c3d3b1"),
    credit: "Unsplash — Marrakech artisan street (yarn alley)",
  },
  {
    file: "derb-ghallef.jpg",
    key: "markets/a1000000-0000-4000-8000-000000000002.jpg",
    url: UL("photo-1753740023014-143ab3536662"),
    credit: "Unsplash — Martina Picciau, Moroccan marketplace wares",
  },
  {
    file: "semmarine.jpg",
    key: "markets/a1000000-0000-4000-8000-000000000003.jpg",
    url: UL("photo-1570135460237-510ca82c6781"),
    credit: "Unsplash — Marrakech spice market",
  },
  {
    file: "maison-du-cuir.jpg",
    key: "stores/b1000000-0000-4000-8000-000000000001.jpg",
    url: U("photo-1768213470228-995720632f58"),
    credit: "Unsplash — Joseph Lee (@lshre93), tannery dye vats",
  },
  {
    file: "epices-atlas.jpg",
    key: "stores/b1000000-0000-4000-8000-000000000002.jpg",
    url: U("photo-1758745464235-ccb8c1253074"),
    credit: "Unsplash — Marrakesh spice stall",
  },
  {
    file: "babouches.jpg",
    key: "products/d1000000-0000-4000-8000-000000000001.jpg",
    url: U("photo-1761416182630-9a5a974e3fca"),
    credit: "Unsplash — mana5280 (@mana5280), babouches on shelves, Marrakesh",
  },
  {
    file: "sac.jpg",
    key: "products/d1000000-0000-4000-8000-000000000002.jpg",
    url: U("photo-1772026251816-a6d382c67b3b"),
    credit: "Unsplash — brown leather handbag still life",
  },
  {
    file: "safran.jpg",
    key: "products/d1000000-0000-4000-8000-000000000003.jpg",
    url: U("photo-1756363886854-b51467278a52"),
    credit: "Unsplash — dried saffron threads close-up",
  },
  {
    file: "argan.jpg",
    key: "products/d1000000-0000-4000-8000-000000000004.jpg",
    url: "https://images.pexels.com/photos/9909784/pexels-photo-9909784.jpeg?auto=compress&cs=tinysrgb&w=1600",
    credit: "Pexels — argan oil cosmetic products on wood",
  },
];

for (const item of MANIFEST) {
  const res = await fetch(item.url);
  if (!res.ok) throw new Error(`download failed ${res.status} for ${item.file}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const out = await sharp(buf)
    .rotate() // honor EXIF orientation, then strip it
    .resize({ width: 1400, withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, item.file), out);
  console.log(`${item.file}: ${(buf.length / 1024).toFixed(0)} KB -> ${(out.length / 1024).toFixed(0)} KB`);
}

await writeFile(
  path.join(outDir, "ATTRIBUTION.md"),
  `# Seed photography credits\n\nFree to use under the Unsplash License / Pexels License.\n\n${MANIFEST.map((m) => `- \`${m.file}\` — ${m.credit}`).join("\n")}\n`,
);
console.log("wrote ATTRIBUTION.md");
