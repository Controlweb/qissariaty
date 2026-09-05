import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, money, type ProductCard } from "../lib/api";
import { Ph } from "../components/Header";
import { Reviews } from "../components/Reviews";

type Sort = "recent" | "price-asc" | "price-desc";
const SORTS: { key: Sort; label: string }[] = [
  { key: "recent", label: "Nouveautés" },
  { key: "price-asc", label: "Prix croissant" },
  { key: "price-desc", label: "Prix décroissant" },
];

const chipStyle = (on: boolean): React.CSSProperties =>
  on
    ? { background: "var(--color-accent)", color: "var(--color-bg)", fontSize: 13, padding: "7px 14px" }
    : { border: "1px solid var(--color-divider)", fontSize: 13, padding: "7px 14px" };

export function StoreDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");

  const store = useQuery({ queryKey: ["store", id], queryFn: () => api.store(id) });
  const products = useQuery({
    queryKey: ["store", id, "products"],
    queryFn: () => api.storeProducts(id),
  });

  const addToCart = useMutation({
    mutationFn: (productId: string) => api.addToCart(productId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cart"] }),
  });

  const visible = useMemo(() => {
    let rows: ProductCard[] = products.data?.products ?? [];
    if (q.trim()) {
      const needle = q.toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(needle));
    }
    // Copy before sorting — the query cache array must not be mutated in place.
    if (sort === "price-asc") rows = [...rows].sort((a, b) => a.priceMinor - b.priceMinor);
    if (sort === "price-desc") rows = [...rows].sort((a, b) => b.priceMinor - a.priceMinor);
    return rows;
  }, [products.data, q, sort]);

  if (store.isPending) {
    return <main style={page}><p className="text-muted">Chargement…</p></main>;
  }
  if (store.isError) {
    return <main style={page}><p style={{ color: "var(--color-accent-700)" }}>{store.error.message}</p></main>;
  }

  const s = store.data.store;

  return (
    <main>
      <Ph label="photo de couverture boutique · 2400 × 700" height={260} />

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 40px 96px" }}>
        <div data-row style={{ display: "flex", gap: 22, alignItems: "flex-end", marginTop: -48 }}>
          <div
            className="ph elev-md"
            style={{
              width: 112,
              height: 112,
              borderRadius: 999,
              flex: "none",
              border: "6px solid var(--color-bg)",
            }}
          >
            logo
          </div>
          <div style={{ paddingBottom: 12 }}>
            <p style={{ fontSize: 12, opacity: 0.6, margin: "0 0 6px" }}>
              Accueil /{" "}
              <a
                href={`/marches/${s.marketId}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/marches/${s.marketId}`);
                }}
              >
                Marché
              </a>{" "}
              / {s.name}
            </p>
            <h1 style={{ margin: 0, fontSize: 40 }}>{s.name}</h1>
          </div>
          <div
            style={{
              marginLeft: "auto",
              paddingBottom: 14,
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <span className="tag tag-accent">{visible.length} produits</span>
            <button className="btn btn-secondary">Enregistrer</button>
          </div>
        </div>

        <div data-cols style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 56, marginTop: 40 }}>
          <div>
            {s.description && (
              <p style={{ fontSize: 16, opacity: 0.78, maxWidth: "62ch", margin: "0 0 26px" }}>
                {s.description}
              </p>
            )}

            <div data-row style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
              <input
                className="input"
                placeholder="Chercher dans cette boutique"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ maxWidth: 320 }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SORTS.map((c) => (
                  <button
                    key={c.key}
                    className="btn"
                    onClick={() => setSort(c.key)}
                    style={chipStyle(sort === c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {addToCart.isError && (
              <p style={{ color: "var(--color-accent-700)", fontSize: 14 }}>
                {addToCart.error.message}
              </p>
            )}

            <div data-cols="products" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
              {visible.map((p) => (
                <div key={p.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <button
                    onClick={() => navigate(`/produits/${p.id}`)}
                    style={{ border: 0, padding: 0, background: "none", width: "100%" }}
                  >
                    <Ph label="photo produit · 800 × 800" height={170} src={p.imageUrl} />
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
                      onClick={() => navigate(`/produits/${p.id}`)}
                      className="card-title"
                      style={{
                        border: 0,
                        background: "none",
                        padding: 0,
                        textAlign: "left",
                        fontSize: 16,
                      }}
                    >
                      {p.name}
                    </button>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <strong style={{ fontSize: 16, color: "var(--color-accent-700)" }}>
                        {money(p.priceMinor, p.currency)}
                      </strong>
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.6 }}>
                      {p.stock > 0 ? `${p.stock} en stock` : "Rupture de stock"}
                    </span>
                    <button
                      className="btn btn-primary btn-block"
                      disabled={p.stock < 1 || addToCart.isPending}
                      onClick={() => addToCart.mutate(p.id)}
                    >
                      Ajouter
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {!visible.length && (
              <p className="text-muted">Aucun produit ne correspond à cette recherche.</p>
            )}

            <Reviews storeId={s.id} />
          </div>

          <aside style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div className="card">
              <p className="card-kicker" style={{ margin: 0 }}>
                Boutique
              </p>
              <p style={{ fontSize: 14, margin: 0, lineHeight: 1.9 }}>
                {s.phone ?? "Téléphone non renseigné"}
              </p>
              <div className="ph" style={{ height: 140, borderRadius: 20, marginTop: 10 }}>
                mini-carte boutique
              </div>
              <button
                className="btn btn-secondary btn-block"
                onClick={() => navigate(`/marches/${s.marketId}`)}
              >
                Voir le marché
              </button>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

const page: React.CSSProperties = { maxWidth: 1280, margin: "0 auto", padding: "72px 40px" };
