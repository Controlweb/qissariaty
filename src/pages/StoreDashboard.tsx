import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, money, type StoreOrder, type MyStore, type ProductInput } from "../lib/api";
import { VariantEditor } from "../components/VariantEditor";
import { ImageUpload } from "../components/ImageUpload";
import { Field } from "../components/Field";
import { ConfirmButton } from "../components/ConfirmButton";

type Tab = "apercu" | "produits" | "commandes" | "boutique";
const TABS: { key: Tab; label: string }[] = [
  { key: "apercu", label: "Aperçu" },
  { key: "produits", label: "Produits" },
  { key: "commandes", label: "Commandes" },
  { key: "boutique", label: "Ma boutique" },
];

const tabStyle = (on: boolean): React.CSSProperties => ({
  textAlign: "left",
  border: 0,
  borderRadius: 999,
  padding: "9px 14px",
  fontSize: 14,
  background: on ? "var(--color-accent)" : "none",
  color: on ? "var(--color-bg)" : "var(--color-text)",
});

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Reçue",
  CONFIRMED: "Confirmée",
  PREPARING: "Préparation",
  READY: "Prête",
  IN_TRANSIT: "En route",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
};

export function StoreDashboard() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("apercu");
  const [storeId, setStoreId] = useState("");

  const myStores = useQuery({ queryKey: ["me", "stores"], queryFn: api.myStores });

  // Select the first shop as soon as the list arrives, so the dashboard is
  // never blank for a seller who has exactly one.
  useEffect(() => {
    const first = myStores.data?.stores[0];
    if (first && !storeId) setStoreId(first.id);
  }, [myStores.data, storeId]);

  const store = myStores.data?.stores.find((s) => s.id === storeId);

  if (myStores.isPending) {
    return <main style={{ padding: "48px 40px" }}><p className="text-muted">Chargement…</p></main>;
  }

  if (!myStores.data?.stores.length) {
    return <NoStoreYet />;
  }

  return (
    <main
      // data-cols is what the mobile rule keys off; without it the 236px rail
      // stayed put on a phone and pushed the whole panel 290px off-screen.
      data-cols
      style={{
        display: "grid",
        gridTemplateColumns: "236px 1fr",
        // Fill what the sticky header leaves rather than assuming its height,
        // which is one row on desktop and two on a phone.
        flex: 1,
      }}
    >
      <aside style={{ padding: "26px 20px", boxShadow: "1px 0 0 var(--color-divider)" }}>
        <p className="card-kicker" style={{ margin: "0 0 4px" }}>
          Espace vendeur
        </p>
        <p style={{ fontFamily: "var(--font-heading)", fontSize: 18, margin: "0 0 20px" }}>
          {store?.name}
        </p>

        {myStores.data.stores.length > 1 && (
          <select
            className="input"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            style={{ marginBottom: 16 }}
          >
            {myStores.data.stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(tab === t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {store?.status === "PENDING" && (
          <div className="card" style={{ marginTop: 26, padding: 16 }}>
            <p className="card-kicker" style={{ margin: 0 }}>
              En attente
            </p>
            <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
              Votre boutique est en cours de validation. Elle n'apparaît pas encore aux clients.
            </p>
          </div>
        )}
      </aside>

      <section style={{ padding: "32px 40px 90px" }}>
        {storeId && tab === "apercu" && <Overview storeId={storeId} />}
        {storeId && tab === "produits" && <ProductsTab storeId={storeId} qc={qc} />}
        {storeId && tab === "commandes" && <OrdersTab storeId={storeId} />}
        {store && tab === "boutique" && <ShopTab store={store} />}
      </section>
    </main>
  );
}

function Overview({ storeId }: { storeId: string }) {
  const kpis = useQuery({ queryKey: ["store", storeId, "kpis"], queryFn: () => api.storeKpis(storeId) });
  const orders = useQuery({
    queryKey: ["store", storeId, "orders"],
    queryFn: () => api.storeOrders(storeId),
  });

  // Twelve weekly buckets of real revenue, matching the design's bar chart.
  const weeks = buildWeeklyRevenue(orders.data?.orders ?? []);
  const peak = Math.max(1, ...weeks);

  const cards = [
    { label: "Commandes", value: String(kpis.data?.orderCount ?? 0) },
    { label: "Chiffre d'affaires", value: money(kpis.data?.revenueMinor ?? 0) },
    { label: "Produits actifs", value: String(kpis.data?.productCount ?? 0) },
    {
      label: "Panier moyen",
      value: money(
        kpis.data && kpis.data.orderCount > 0
          ? Math.round(kpis.data.revenueMinor / kpis.data.orderCount)
          : 0,
      ),
    },
  ];

  return (
    <>
      <h1 style={{ margin: "0 0 26px", fontSize: 34 }}>Aperçu</h1>

      <div
        data-cols="products"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 18,
          marginBottom: 34,
        }}
      >
        {cards.map((k) => (
          <div key={k.label} className="card" style={{ padding: "18px 20px", gap: 4 }}>
            <p className="card-kicker" style={{ margin: 0 }}>
              {k.label}
            </p>
            <p className="stat">{k.value}</p>
          </div>
        ))}
      </div>

      <div data-cols style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
        <div className="card" style={{ padding: 22 }}>
          <p className="card-kicker" style={{ margin: 0 }}>
            Chiffre d'affaires · 12 dernières semaines
          </p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 170, marginTop: 12 }}>
            {weeks.map((v, i) => (
              <div
                key={i}
                title={money(v)}
                style={{
                  flex: 1,
                  // A zero week still shows a sliver, so the axis reads as 12 weeks.
                  height: `${Math.max(2, (v / peak) * 100)}%`,
                  background:
                    i >= 9
                      ? "var(--color-accent)"
                      : i >= 6
                        ? "var(--color-accent-500)"
                        : i >= 3
                          ? "var(--color-accent-400)"
                          : "var(--color-accent-300)",
                  borderRadius: "10px 10px 4px 4px",
                }}
              />
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <p className="card-kicker" style={{ margin: 0 }}>
            Meilleures ventes
          </p>
          {bestSellers(orders.data?.orders ?? []).map((b) => (
            <div
              key={b.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                padding: "9px 0",
                boxShadow: "0 1px 0 var(--color-divider)",
              }}
            >
              <span>{b.name}</span>
              <span style={{ opacity: 0.65 }}>{b.qty} vendus</span>
            </div>
          ))}
          {!orders.data?.orders.length && (
            <p style={{ fontSize: 13, opacity: 0.65, margin: "10px 0 0" }}>
              Aucune vente pour le moment.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

const PRODUCT_STATUS: Record<string, string> = {
  ACTIVE: "En vente",
  DRAFT: "Brouillon",
  ARCHIVED: "Archivé",
};

const emptyProduct = () => ({
  name: "",
  price: "",
  stock: "0",
  description: "",
  status: "ACTIVE" as "ACTIVE" | "DRAFT" | "ARCHIVED",
  imageKey: null as string | null,
});

type ProductDraft = ReturnType<typeof emptyProduct>;

function ProductsTab({ storeId, qc }: { storeId: string; qc: ReturnType<typeof useQueryClient> }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [variantsFor, setVariantsFor] = useState<{ id: string; priceMinor: number } | null>(null);

  // The owner view: drafts and archived items too. The public listing filters
  // to ACTIVE, which used to hide a merchant's own unpublished products from
  // them and made an archived one look deleted.
  const products = useQuery({
    queryKey: ["store", storeId, "catalogue"],
    queryFn: () => api.storeCatalogue(storeId),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["store", storeId, "catalogue"] });
    qc.invalidateQueries({ queryKey: ["store", storeId, "products"] });
  };

  const archive = useMutation({ mutationFn: api.archiveProduct, onSuccess: refresh });

  return (
    <>
      <div
        data-row
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 22,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 34 }}>Produits</h1>
        <button
          className="btn btn-primary"
          style={{ whiteSpace: "nowrap" }}
          onClick={() => {
            setCreating(!creating);
            setEditing(null);
          }}
        >
          {creating ? "Annuler" : "Ajouter un produit"}
        </button>
      </div>

      {creating && (
        <ProductForm
          key="new"
          initial={emptyProduct()}
          submitLabel="Publier le produit"
          onSubmit={(input) =>
            api.createProduct(storeId, {
              name: input.name!,
              description: input.description ?? undefined,
              priceMinor: input.priceMinor!,
              stock: input.stock!,
              imageKey: input.imageKey ?? undefined,
              status: input.status,
            })
          }
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Prix</th>
              <th>Stock</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.data?.products.map((p) => (
              <tr key={p.id} style={p.status === "ARCHIVED" ? { opacity: 0.55 } : undefined}>
                <td>
                  <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt=""
                        style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 12, flex: "none" }}
                      />
                    ) : (
                      <span className="ph" style={{ width: 44, height: 44, borderRadius: 12, flex: "none" }} />
                    )}
                    {p.name}
                  </span>
                </td>
                <td>{money(p.priceMinor, p.currency)}</td>
                <td>{p.stock}</td>
                <td>
                  <span
                    className={
                      p.status === "ACTIVE"
                        ? p.stock > 0
                          ? "tag tag-accent-2"
                          : "tag tag-accent"
                        : "tag tag-neutral"
                    }
                  >
                    {p.status === "ACTIVE" && p.stock < 1
                      ? "Épuisé"
                      : (PRODUCT_STATUS[p.status] ?? p.status)}
                  </span>
                </td>
                <td>
                  <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        setEditing(editing === p.id ? null : p.id);
                        setCreating(false);
                      }}
                    >
                      {editing === p.id ? "Fermer" : "Modifier"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={() =>
                        setVariantsFor(
                          variantsFor?.id === p.id ? null : { id: p.id, priceMinor: p.priceMinor },
                        )
                      }
                    >
                      {variantsFor?.id === p.id ? "Fermer" : "Déclinaisons"}
                    </button>
                    {p.status !== "ARCHIVED" && (
                      <ConfirmButton
                        label="Archiver"
                        style={{ fontSize: 12 }}
                        disabled={archive.isPending}
                        title={`Archiver ${p.name} ?`}
                        body="Le produit disparaît de votre boutique et ne peut plus être commandé. Les commandes déjà passées le conservent. Vous pourrez le remettre en vente depuis Modifier."
                        confirmLabel="Archiver le produit"
                        onConfirm={() => archive.mutate(p.id)}
                      />
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing &&
        (() => {
          const p = products.data?.products.find((x) => x.id === editing);
          if (!p) return null;
          return (
            <ProductForm
              key={p.id}
              initial={{
                name: p.name,
                price: (p.priceMinor / 100).toFixed(2),
                stock: String(p.stock),
                description: p.description ?? "",
                status: p.status as ProductDraft["status"],
                imageKey: p.imageKey ?? null,
              }}
              submitLabel="Enregistrer"
              onSubmit={(input) => api.updateProduct(p.id, input)}
              onDone={refresh}
            />
          );
        })()}

      {variantsFor && (
        <div style={{ marginTop: 20 }}>
          <VariantEditor productId={variantsFor.id} basePriceMinor={variantsFor.priceMinor} />
        </div>
      )}

      {products.data && !products.data.products.length && (
        <p className="text-muted" style={{ marginTop: 20 }}>
          Aucun produit. Ajoutez-en un pour commencer à vendre.
        </p>
      )}
    </>
  );
}

/** One form for creating and for editing — the fields are identical. */
function ProductForm({
  initial,
  submitLabel,
  onSubmit,
  onDone,
}: {
  initial: ProductDraft;
  submitLabel: string;
  onSubmit: (input: ProductInput) => Promise<unknown>;
  onDone: () => void;
}) {
  const [form, setForm] = useState<ProductDraft>(initial);
  const set = <K extends keyof ProductDraft>(k: K, v: ProductDraft[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const price = Number(form.price);
  // The API speaks minor units only — convert once, at the boundary.
  const priceMinor = Math.round(price * 100);
  const stock = Number(form.stock);
  const ready =
    form.name.trim().length >= 2 &&
    Number.isFinite(price) &&
    priceMinor >= 1 &&
    Number.isFinite(stock) &&
    stock >= 0;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: () =>
      onSubmit({
        name: form.name.trim(),
        description: form.description.trim() || null,
        priceMinor,
        stock,
        status: form.status,
        imageKey: form.imageKey,
      }),
    onSuccess: onDone,
  });

  return (
    <form
      className="card"
      style={{ padding: 24, margin: "0 0 24px", gap: 16, maxWidth: 720 }}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div data-cols style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="Nom du produit" style={{ gridColumn: "1/-1" }}>
          {({ id }) => (
            <input
              id={id}
              className="input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          )}
        </Field>
        <Field label="Prix (MAD)">
          {({ id }) => (
            <input
              id={id}
              className="input"
              type="number"
              step="0.01"
              min="0.01"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
            />
          )}
        </Field>
        <Field label="Stock">
          {({ id }) => (
            <input
              id={id}
              className="input"
              type="number"
              min="0"
              value={form.stock}
              onChange={(e) => set("stock", e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Statut"
          style={{ gridColumn: "1/-1" }}
          hint="Un brouillon reste invisible aux clients. Un produit archivé ne peut plus être commandé."
        >
          {() => (
            <div className="seg">
              {(["ACTIVE", "DRAFT", "ARCHIVED"] as const).map((st) => (
                <label key={st} className="seg-opt">
                  <input
                    type="radio"
                    name="product-status"
                    checked={form.status === st}
                    onChange={() => set("status", st)}
                  />
                  {PRODUCT_STATUS[st]}
                </label>
              ))}
            </div>
          )}
        </Field>
        <div style={{ gridColumn: "1/-1" }}>
          <ImageUpload
            prefix="products"
            label="Photo du produit"
            hint="Optimisée sur votre appareil avant l'envoi, enregistrée quand vous validez."
            value={form.imageKey}
            onUploaded={(imageKey) => set("imageKey", imageKey)}
          />
        </div>
        <Field label="Description" style={{ gridColumn: "1/-1" }}>
          {({ id }) => (
            <textarea
              id={id}
              className="input"
              style={{ borderRadius: 20 }}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          )}
        </Field>
      </div>

      {save.isError && (
        <p style={{ color: "var(--color-accent-700)", fontSize: 14, margin: 0 }}>
          {(save.error as Error).message}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" disabled={!ready || !dirty || save.isPending}>
          {save.isPending ? "…" : submitLabel}
        </button>
        {dirty && !save.isPending && (
          <span style={{ fontSize: 12, opacity: 0.65 }}>Modifications non enregistrées</span>
        )}
      </div>
    </form>
  );
}

function OrdersTab({ storeId }: { storeId: string }) {
  const qc = useQueryClient();
  const orders = useQuery({
    queryKey: ["store", storeId, "orders"],
    queryFn: () => api.storeOrders(storeId),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "CONFIRMED" | "PREPARING" | "READY" | "CANCELLED" }) =>
      api.setOrderStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["store", storeId, "orders"] }),
  });

  /** The one action that moves this order forward, or none if it has left the shop. */
  const nextAction = (status: string) =>
    status === "PENDING"
      ? { label: "Confirmer", to: "CONFIRMED" as const }
      : status === "CONFIRMED"
        ? { label: "En préparation", to: "PREPARING" as const }
        : status === "PREPARING"
          ? { label: "Prête", to: "READY" as const }
          : null;

  return (
    <>
      <h1 style={{ margin: "0 0 22px", fontSize: 34 }}>Commandes</h1>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {orders.data?.orders.map((o) => {
          const next = nextAction(o.status);
          return (
            <div key={o.id} className="card" style={{ padding: 22 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div>
                  <p className="card-kicker" style={{ margin: 0 }}>
                    {new Date(o.createdAt * 1000).toLocaleDateString("fr-MA")} · {o.customerName}
                  </p>
                  <p className="card-title" style={{ margin: "2px 0 0", fontSize: 18 }}>
                    {o.ref}
                  </p>
                </div>
                <span className="tag tag-accent-2">{STATUS_LABEL[o.status] ?? o.status}</span>
              </div>

              {o.items.map((it) => (
                <p key={it.id} style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.75 }}>
                  {it.qty} × {it.name} — {money(it.unitPriceMinor)}
                </p>
              ))}

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  marginTop: 14,
                  paddingTop: 14,
                  boxShadow: "0 -1px 0 var(--color-divider)",
                }}
              >
                <strong style={{ fontFamily: "var(--font-heading)", fontSize: 18, flex: 1 }}>
                  {money(o.totalMinor, o.currency)}
                </strong>
                {next && (
                  <button
                    className="btn btn-primary"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: o.id, status: next.to })}
                  >
                    {next.label}
                  </button>
                )}
                {next && (
                  <ConfirmButton
                    label="Annuler"
                    disabled={setStatus.isPending}
                    title={`Annuler la commande ${o.ref} ?`}
                    body="Le client sera prévenu que sa commande n’aboutira pas. Une commande annulée ne peut pas être relancée."
                    confirmLabel="Annuler la commande"
                    onConfirm={() => setStatus.mutate({ id: o.id, status: "CANCELLED" })}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!orders.data?.orders.length && (
        <p className="text-muted">Aucune commande pour le moment.</p>
      )}
    </>
  );
}

/** Shop identity: logo, description, contact. */
function ShopTab({ store }: { store: MyStore }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: store.name,
    description: store.description ?? "",
    phone: store.phone ?? "",
    category: store.category ?? "",
  });
  const [dirty, setDirty] = useState(false);

  const save = useMutation({
    mutationFn: (input: Parameters<typeof api.updateStore>[1]) => api.updateStore(store.id, input),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["me", "stores"] });
    },
  });

  const set = (k: keyof typeof form) => (v: string) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };

  return (
    <>
      <h1 style={{ margin: "0 0 22px", fontSize: 34 }}>Ma boutique</h1>

      <div className="card" style={{ padding: 24, gap: 16, maxWidth: 620 }}>
        <ImageUpload
          prefix="stores"
          label="Logo de la boutique"
          hint="Affiché sur votre page boutique et dans les résultats de recherche."
          value={store.logoKey ?? null}
          // Saved on upload: there is nothing to batch it with.
          onUploaded={(logoKey) => save.mutate({ logoKey })}
          options={{ maxDimension: 800, quality: 0.85 }}
        />

        <Field label="Nom de la boutique">
          {({ id }) => (
            <input
              id={id}
              className="input"
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
            />
          )}
        </Field>

        <Field label="Catégorie principale">
          {({ id }) => (
            <input
              id={id}
              className="input"
              value={form.category}
              placeholder="Textile"
              onChange={(e) => set("category")(e.target.value)}
            />
          )}
        </Field>

        <Field label="Téléphone">
          {({ id }) => (
            <input
              id={id}
              className="input"
              value={form.phone}
              placeholder="+212 6.."
              onChange={(e) => set("phone")(e.target.value)}
            />
          )}
        </Field>

        <Field label="Description">
          {({ id }) => (
            <textarea
              id={id}
              className="input"
              style={{ borderRadius: 20 }}
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
            />
          )}
        </Field>

        {save.isError && (
          <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>
            {save.error.message}
          </p>
        )}
        {save.isSuccess && !dirty && (
          <p style={{ color: "var(--color-accent-2-700)", fontSize: 13, margin: 0 }}>Enregistré.</p>
        )}

        <button
          className="btn btn-primary"
          style={{ alignSelf: "flex-start" }}
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              name: form.name,
              description: form.description || undefined,
              phone: form.phone || undefined,
              category: form.category || undefined,
            })
          }
        >
          Enregistrer
        </button>
      </div>
    </>
  );
}

/**
 * A STORE_OWNER with no shop abandoned the application wizard part-way. Send
 * them back to it rather than offering a second, different creation form.
 */
function NoStoreYet() {
  const navigate = useNavigate();
  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: "72px 40px" }}>
      <p className="card-kicker" style={{ margin: "0 0 12px" }}>
        Espace vendeur
      </p>
      <h1 style={{ margin: "0 0 12px" }}>Aucune boutique enregistrée</h1>
      <p style={{ fontSize: 16, opacity: 0.75, margin: "0 0 24px", maxWidth: "44ch" }}>
        Votre dossier n'a pas été terminé. Reprenez la demande pour rattacher votre boutique à son
        marché.
      </p>
      <button className="btn btn-primary" onClick={() => navigate("/inscription?role=STORE_OWNER")}>
        Reprendre ma demande
      </button>
    </main>
  );
}

function buildWeeklyRevenue(orders: StoreOrder[]) {
  const weeks = new Array(12).fill(0) as number[];
  const now = Date.now() / 1000;
  const WEEK = 7 * 24 * 3600;
  for (const o of orders) {
    if (o.status === "CANCELLED") continue;
    const age = Math.floor((now - o.createdAt) / WEEK);
    if (age >= 0 && age < 12) weeks[11 - age] = (weeks[11 - age] ?? 0) + o.totalMinor;
  }
  return weeks;
}

function bestSellers(orders: StoreOrder[]) {
  const tally = new Map<string, number>();
  for (const o of orders) {
    if (o.status === "CANCELLED") continue;
    for (const it of o.items) tally.set(it.name, (tally.get(it.name) ?? 0) + it.qty);
  }
  return [...tally.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 4);
}
