import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, money, type ProductVariant } from "../lib/api";
import { Ph } from "../components/Header";
import { VariantPicker } from "../components/VariantPicker";
import { Reviews } from "../components/Reviews";

export function ProductDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [qty, setQty] = useState(1);
  const [variant, setVariant] = useState<ProductVariant | null>(null);

  const product = useQuery({ queryKey: ["product", id], queryFn: () => api.product(id) });
  const p = product.data?.product;

  const store = useQuery({
    queryKey: ["store", p?.storeId],
    queryFn: () => api.store(p!.storeId),
    enabled: !!p,
  });

  const variants = useQuery({
    queryKey: ["product", id, "variants"],
    queryFn: () => api.variants(id),
  });

  const related = useQuery({
    queryKey: ["store", p?.storeId, "products"],
    queryFn: () => api.storeProducts(p!.storeId),
    enabled: !!p,
  });

  const addToCart = useMutation({
    mutationFn: (n: number) => api.addToCart(id, n, variant?.id ?? ""),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cart"] }),
  });

  if (product.isPending) {
    return <main style={page}><p className="text-muted">Chargement…</p></main>;
  }
  if (product.isError || !p) {
    return (
      <main style={page}>
        <p style={{ color: "var(--color-accent-700)" }}>Produit introuvable.</p>
      </main>
    );
  }

  const s = store.data?.store;
  const others = (related.data?.products ?? []).filter((x) => x.id !== p.id).slice(0, 4);

  const hasVariants = !!variants.data?.options.length;
  // Before a variant is chosen, show the product's own figures — the worker
  // keeps those in sync as the minimum price and the sum of variant stock.
  const price = variant?.priceMinor ?? p.priceMinor;
  const stock = variant?.stock ?? p.stock;
  // A varied product cannot be added until one exact combination is resolved.
  const blocked = stock < 1 || (hasVariants && !variant);

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 40px 96px" }}>
      <p style={{ fontSize: 12, opacity: 0.6, margin: "0 0 26px" }}>
        Accueil /{" "}
        {s && (
          <>
            <a
              href={`/marches/${s.marketId}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/marches/${s.marketId}`);
              }}
            >
              Marché
            </a>{" "}
            /{" "}
            <a
              href={`/boutiques/${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/boutiques/${s.id}`);
              }}
            >
              {s.name}
            </a>{" "}
            /{" "}
          </>
        )}
        {p.name}
      </p>

      <div data-cols style={{ display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 56 }}>
        <div>
          <Ph
            label="photo produit · 1400 × 1400"
            height={520}
            src={p.imageUrl}
            style={{ borderRadius: 32 }}
          />
          <div style={{ display: "flex", gap: 14, marginTop: 14 }}>
            {["vue 2", "vue 3", "vue 4"].map((v) => (
              <div key={v} className="ph" style={{ width: 96, height: 96, borderRadius: 22 }}>
                {v}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="card-kicker" style={{ margin: "0 0 12px" }}>
            Produit
          </p>
          <h1 style={{ margin: "0 0 14px", fontSize: 42 }}>{p.name}</h1>

          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 10 }}>
            <strong
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 36,
                color: "var(--color-accent-700)",
              }}
            >
              {money(price, p.currency)}
            </strong>
            {hasVariants && !variant && (
              <span style={{ fontSize: 13, opacity: 0.6 }}>à partir de</span>
            )}
          </div>

          <p
            style={{
              fontSize: 13,
              margin: "0 0 20px",
              color: stock > 0 ? "var(--color-accent-2-700)" : "var(--color-accent-700)",
            }}
          >
            {stock > 0 ? `En stock · ${stock} disponibles` : "Rupture de stock"}
            {variant?.sku ? ` · Réf. ${variant.sku}` : ""}
          </p>

          {hasVariants && (
            <VariantPicker
              options={variants.data!.options}
              variants={variants.data!.variants}
              onChange={setVariant}
            />
          )}

          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                border: "1px solid var(--color-divider)",
                borderRadius: 999,
                padding: "4px 6px",
              }}
            >
              <button className="btn btn-icon" onClick={() => setQty(Math.max(1, qty - 1))}>
                –
              </button>
              <span style={{ minWidth: 26, textAlign: "center", fontSize: 15 }}>{qty}</span>
              <button
                className="btn btn-icon"
                onClick={() => setQty(Math.min(99, Math.max(1, stock), qty + 1))}
              >
                +
              </button>
            </div>
            <button
              className="btn btn-primary"
              style={{ flex: 1, padding: 14, fontSize: 15 }}
              disabled={blocked || addToCart.isPending}
              onClick={() => addToCart.mutate(qty)}
            >
              Ajouter au panier
            </button>
          </div>

          <button
            className="btn btn-secondary btn-block"
            style={{ padding: 13 }}
            disabled={blocked || addToCart.isPending}
            onClick={() => addToCart.mutate(qty, { onSuccess: () => navigate("/commande") })}
          >
            Acheter maintenant
          </button>

          {addToCart.isError && (
            <p style={{ color: "var(--color-accent-700)", fontSize: 14, marginTop: 12 }}>
              {addToCart.error.message}
            </p>
          )}

          {s && (
            <div
              className="card"
              style={{ marginTop: 26, flexDirection: "row", alignItems: "center", gap: 16 }}
            >
              <div className="ph" style={{ width: 56, height: 56, borderRadius: 999, flex: "none" }}>
                logo
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 15, fontFamily: "var(--font-heading)" }}>{s.name}</p>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.65 }}>Boutique du marché</p>
              </div>
              <button className="btn btn-ghost" onClick={() => navigate(`/boutiques/${s.id}`)}>
                Visiter
              </button>
            </div>
          )}

          <h4 style={{ margin: "32px 0 10px" }}>Description</h4>
          <p style={{ fontSize: 15, opacity: 0.78, margin: "0 0 8px" }}>
            {p.description ?? "Aucune description fournie."}
          </p>
          <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>Réf. {p.id.slice(0, 8)}</p>
        </div>
      </div>

      <Reviews productId={p.id} />

      {!!others.length && (
        <section style={{ marginTop: 72 }}>
          <h2 style={{ margin: "0 0 20px" }}>Produits similaires</h2>
          <div data-cols="products" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 22 }}>
            {others.map((o) => (
              <div key={o.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
                <button
                  onClick={() => navigate(`/produits/${o.id}`)}
                  style={{ border: 0, padding: 0, background: "none", width: "100%" }}
                >
                  <Ph label="photo produit" height={170} src={o.imageUrl} />
                </button>
                <div
                  style={{
                    padding: "15px 17px 17px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                  }}
                >
                  <button
                    onClick={() => navigate(`/produits/${o.id}`)}
                    className="card-title"
                    style={{
                      border: 0,
                      background: "none",
                      padding: 0,
                      textAlign: "left",
                      fontSize: 16,
                    }}
                  >
                    {o.name}
                  </button>
                  <strong style={{ fontSize: 15, color: "var(--color-accent-700)" }}>
                    {money(o.priceMinor, o.currency)}
                  </strong>
                  <button
                    className="btn btn-secondary btn-block"
                    disabled={o.stock < 1}
                    onClick={() => api.addToCart(o.id).then(() => qc.invalidateQueries({ queryKey: ["cart"] }))}
                  >
                    Ajouter
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

const page: React.CSSProperties = { maxWidth: 1280, margin: "0 auto", padding: "48px 40px" };
