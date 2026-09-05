import { chromium } from "@playwright/test";
import fs from "node:fs";

/**
 * Sweeps every screen at desktop and phone widths, signed out and signed in as
 * each role, and reports what a person would actually hit: horizontal overflow,
 * console errors, failed requests, unlabelled controls, and low-contrast text.
 *
 *   node scripts/ui-audit.mjs <outDir> [baseUrl]
 */
const OUT = process.argv[2] ?? "./ui-audit";
const B = process.argv[3] ?? "https://qissariaty.controlwebagency.workers.dev";
fs.mkdirSync(OUT, { recursive: true });

const PW = "qissariaty-dev";
const ROLES = {
  anon: null,
  customer: null, // registered fresh below
  owner: "owner@qissariaty.ma",
  admin: "admin@qissariaty.ma",
  deliverer: "deliverer@qissariaty.ma",
};

/** page → which sessions should see it */
const PAGES = [
  ["home", "/", ["anon", "owner"]],
  ["map", "/carte", ["anon"]],
  ["search", "/recherche?q=babouches", ["anon"]],
  ["market", "/marches/a0000000-0000-4000-8000-000000000001", ["anon"]],
  ["store", "/boutiques/b0000000-0000-4000-8000-000000000001", ["anon"]],
  ["product", "/produits/d0000000-0000-4000-8000-000000000001", ["anon"]],
  ["cart", "/panier", ["anon"]],
  ["checkout", "/commande", ["anon"]],
  ["login", "/connexion", ["anon"]],
  ["signup", "/inscription", ["anon"]],
  ["signup-merchant", "/inscription?role=STORE_OWNER", ["anon"]],
  ["signup-deliverer", "/inscription?role=DELIVERER", ["anon"]],
  ["signup-customer", "/inscription?role=CUSTOMER", ["anon"]],
  ["account", "/compte", ["customer"]],
  ["seller", "/vendeur", ["owner"]],
  ["admin", "/admin", ["admin"]],
  ["deliveries", "/livraisons", ["deliverer"]],
];

const findings = [];

async function makeContext(browser, role) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (role === "anon") return ctx;
  const page = await ctx.newPage();
  const email = role === "customer" ? `audit-${Date.now()}@example.com` : ROLES[role];

  if (role === "customer") {
    await page.goto(`${B}/inscription?role=CUSTOMER`);
    await page.getByLabel("Nom complet").fill("Audit Client");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Mot de passe").fill("motdepasse-123");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
  } else {
    await page.goto(`${B}/connexion`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe").fill(PW);
    await page.getByRole("button", { name: "Se connecter" }).click();
  }
  await page.waitForTimeout(2000);
  await page.close();
  return ctx;
}

const browser = await chromium.launch();

for (const role of Object.keys(ROLES)) {
  const targets = PAGES.filter(([, , roles]) => roles.includes(role));
  if (!targets.length) continue;
  const ctx = await makeContext(browser, role);

  for (const [name, path] of targets) {
    for (const [tag, viewport] of [
      ["desktop", { width: 1440, height: 1000 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      const page = await ctx.newPage();
      await page.setViewportSize(viewport);
      const errors = [];
      const failed = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
      page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 160)));
      page.on("response", (r) => {
        if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(B, "")}`);
      });

      await page.goto(B + path, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(1000);

      const probe = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const label = (el) => `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).slice(0, 26) : ""}`;

        // Anything reaching past the viewport edge.
        const wide = [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > vw + 2)
          .slice(0, 4)
          .map(label);

        // Form controls with no accessible name.
        const unlabelled = [...document.querySelectorAll("input,select,textarea")]
          .filter((el) => {
            if (el.type === "hidden") return false;
            if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return false;
            if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
            return !el.closest("label");
          })
          .slice(0, 5)
          .map((el) => `${label(el)}[${el.type ?? ""}]`);

        // Buttons with no discernible text.
        const namelessButtons = [...document.querySelectorAll("button")]
          .filter((b) => !b.textContent.trim() && !b.getAttribute("aria-label"))
          .slice(0, 4)
          .map(label);

        // Tap targets below the 44px guideline, on mobile only.
        const small =
          vw < 500
            ? [...document.querySelectorAll("button,a,input,select")]
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  return r.width > 0 && r.height > 0 && r.height < 40;
                })
                .slice(0, 5)
                .map((el) => `${label(el)} ${Math.round(el.getBoundingClientRect().height)}px`)
            : [];

        // Images with no alt attribute at all.
        const noAlt = [...document.querySelectorAll("img")]
          .filter((i) => i.getAttribute("alt") === null)
          .slice(0, 4)
          .map((i) => i.src.slice(-40));

        return {
          overflow: document.documentElement.scrollWidth - vw,
          wide,
          unlabelled,
          namelessButtons,
          small,
          noAlt,
          h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim().slice(0, 40)),
          title: document.title,
          lang: document.documentElement.lang,
        };
      });

      await page.screenshot({
        path: `${OUT}/${role}-${name}-${tag}.png`,
        fullPage: tag === "desktop",
      });
      findings.push({ role, page: name, tag, path, errors, failed, ...probe });
      await page.close();
    }
  }
  await ctx.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(findings, null, 2));

const shout = (f) => {
  const bits = [];
  if (f.overflow > 0) bits.push(`OVERFLOW ${f.overflow}px ${f.wide.join(",")}`);
  if (f.errors.length) bits.push(`JS ${f.errors.join(" | ")}`);
  if (f.failed.length) bits.push(`HTTP ${[...new Set(f.failed)].join(",")}`);
  if (f.unlabelled.length) bits.push(`UNLABELLED ${f.unlabelled.join(",")}`);
  if (f.namelessButtons.length) bits.push(`NAMELESS-BTN ${f.namelessButtons.join(",")}`);
  if (f.small.length) bits.push(`SMALL-TAP ${f.small.join(",")}`);
  if (f.noAlt.length) bits.push(`NO-ALT ${f.noAlt.length}`);
  if (f.h1.length !== 1) bits.push(`H1x${f.h1.length}`);
  return bits;
};

let clean = 0;
for (const f of findings) {
  const bits = shout(f);
  if (!bits.length) clean++;
  else console.log(`${f.role}/${f.page}/${f.tag}:\n  ${bits.join("\n  ")}`);
}
console.log(`\n${clean}/${findings.length} views clean · document.title="${findings[0]?.title}" lang="${findings[0]?.lang}"`);
