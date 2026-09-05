import { test, expect } from "@playwright/test";

test("home renders the Organic design and navigates", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Qissariaty", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Découvrez les marchés/ })).toBeVisible();

  // The design system must actually be applied, not just the markup ported.
  const bg = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue("--color-bg").trim(),
  );
  expect(bg).toBe("#f5ead8");

  await page.getByRole("button", { name: "Carte", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Explorer" })).toBeVisible();
});

test("client-side routes fall back to the SPA, api 404s stay json", async ({ page, request }) => {
  await page.goto("/connexion");
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();

  const health = await request.get("/api/health");
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toMatchObject({ ok: true });

  const missing = await request.get("/api/nope");
  expect(missing.status()).toBe(404);
});

test("mobile shows the bottom tab bar and stacks the layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  // The tab bar replaces the header's inline nav below 900px.
  await expect(page.getByRole("button", { name: "Accueil" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Carte", exact: true })).toBeVisible();

  const cols = await page
    .locator("[data-cols]")
    .first()
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  // A single track once collapsed — the desktop split would report two.
  expect(cols.split(" ").length).toBe(1);
});

test("product page offers variants and blocks add until one is chosen", async ({ page }) => {
  await page.goto("/produits/d0000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("heading", { name: /Babouches/ })).toBeVisible();

  const add = page.getByRole("button", { name: "Ajouter au panier" });
  await expect(add).toBeDisabled();

  await page.getByRole("button", { name: "Noir", exact: true }).click();
  await page.getByRole("button", { name: "42", exact: true }).click();
  await expect(add).toBeEnabled();
});

test("signup asks for a role first, then shows that role's flow", async ({ page }) => {
  await page.goto("/inscription");
  await expect(page.getByRole("heading", { name: /en tant que/ })).toBeVisible();

  await page.getByRole("button", { name: /Commerçant/ }).click();
  await expect(page).toHaveURL(/role=STORE_OWNER/);
  await expect(page.getByRole("heading", { name: /Votre boutique du souk/ })).toBeVisible();

  // The choice is reversible.
  await page.getByRole("button", { name: /Changer de profil/ }).click();
  await page.getByRole("button", { name: /Livreur/ }).click();
  await expect(page.getByRole("heading", { name: /Livrez dans votre quartier/ })).toBeVisible();

  await page.goto("/inscription?role=CUSTOMER");
  await expect(page.getByRole("heading", { name: /Achetez dans les souks/ })).toBeVisible();
});

test("the merchant CTA reaches the merchant flow from a logged-out home page", async ({ page }) => {
  await page.goto("/");
  // Regression: this used to route into the role-gated dashboard, which bounced
  // any non-merchant straight back out.
  await page.getByRole("button", { name: "Vendre sur Qissariaty" }).click();
  await expect(page).toHaveURL(/role=STORE_OWNER/);

  const next = page.getByRole("button", { name: "Créer mon compte" });
  await expect(next).toBeDisabled();
  await page.getByLabel("Nom complet").fill("Karim Bennani");
  await page.getByLabel("E-mail").fill(`e2e-${Date.now()}@example.com`);
  await page.getByLabel("Mot de passe").fill("motdepasse-123");
  await expect(next).toBeEnabled();
});

test("a visitor can fill a cart and reach checkout with no account", async ({ page }) => {
  await page.goto("/produits/d0000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Noir", exact: true }).click();
  await page.getByRole("button", { name: "42", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter au panier" }).click();

  await page.goto("/panier");
  await expect(page.getByRole("heading", { name: "Votre panier" })).toBeVisible();
  await page.getByRole("button", { name: "Passer au paiement" }).click();

  // Guest identity is collected here instead of behind a login wall.
  await expect(page.getByRole("heading", { name: "Adresse de livraison" })).toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();

  // ...and the guest must be able to finish. Stopping the assertions at the
  // address form is what let a permanently-disabled confirm button ship: the
  // API tests all posted an addressId, which no guest ever has.
  await page.getByLabel("Nom complet").fill("Salma El Amrani");
  await page.getByLabel("E-mail").fill(`e2e-${Date.now()}@example.com`);
  // Unique: users.phone is UNIQUE, and the seed already holds the round numbers.
  await page.getByLabel("Téléphone").fill(`+2126${Date.now().toString().slice(-8)}`);
  await page.getByLabel("Adresse", { exact: true }).fill("18 rue Ibn Khaldoun");
  await page.getByRole("button", { name: "Continuer vers le paiement" }).click();

  const confirm = page.getByRole("button", { name: /Confirmer la commande/ });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByRole("heading", { name: "Merci !" })).toBeVisible();
});
