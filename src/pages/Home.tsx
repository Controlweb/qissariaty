import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, money } from "../lib/api";
import { Ph } from "../components/Header";

/** Casablanca-wide box — the landing page shows a city's worth, not the country. */
const FEATURED_BOUNDS = { north: 33.65, south: 33.45, east: -7.45, west: -7.75 };

const CATEGORIES = [
  "Artisanat",
  "Épicerie",
  "Textile",
  "Cuir",
  "Épices",
  "Cosmétique",
  "Décoration",
  "Bijoux",
];

export function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const markets = useQuery({
    queryKey: ["markets", "featured"],
    queryFn: () => api.marketsInBounds(FEATURED_BOUNDS),
  });

  const addToCart = useMutation({
    mutationFn: (productId: string) => api.addToCart(productId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cart"] }),
  });

  // Lead with markets that actually have shops — an empty souk is a poor
  // advertisement, and it used to starve the featured-products row below.
  const featured = [...(markets.data?.markets ?? [])]
    .sort((a, b) => (b.storeCount ?? 0) - (a.storeCount ?? 0))
    .slice(0, 3);

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "0 40px 96px" }}>
      <section
        data-cols
        style={{
          display: "grid",
          gridTemplateColumns: "1.15fr .85fr",
          gap: 56,
          alignItems: "center",
          padding: "72px 0 64px",
        }}
      >
        <div>
          <p className="card-kicker" style={{ margin: "0 0 18px" }}>
            Maroc · 6 villes · 4 140 boutiques
          </p>
          <h1 style={{ fontSize: 64, maxWidth: "14ch", margin: "0 0 22px" }}>
            Découvrez les marchés. Achetez local.
          </h1>
          <p style={{ fontSize: 18, maxWidth: "46ch", opacity: 0.75, margin: "0 0 30px" }}>
            Des souks de Marrakech aux galeries de Derb Omar : explorez les marchés sur la carte,
            parcourez les boutiques et commandez en quelques minutes.
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              className="btn btn-primary"
              onClick={() => navigate("/carte")}
              style={{ padding: "13px 26px", fontSize: 15 }}
            >
              Explorer la carte
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => navigate("/inscription?role=STORE_OWNER")}
              style={{ padding: "13px 26px", fontSize: 15 }}
            >
              Commencer à vendre
            </button>
          </div>
        </div>
        <Ph
          label="photographie · vue d'un souk"
          height={400}
          style={{ borderRadius: "200px 200px 32px 32px" }}
        />
      </section>

      <section style={{ padding: "32px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <h2 style={{ margin: 0 }}>Marchés en vedette</h2>
          <button className="btn btn-ghost" onClick={() => navigate("/carte")}>
            Voir tous les marchés
          </button>
        </div>
        <div data-cols="products" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24 }}>
          {featured.map((m) => (
            <button
              key={m.id}
              onClick={() => navigate(`/marches/${m.id}`)}
              style={{ textAlign: "left", border: 0, padding: 0, background: "none" }}
            >
              <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
                <Ph label="photo marché · 900 × 600" height={200} src={m.coverUrl} />
                <div
                  style={{
                    padding: "20px 22px 22px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <span className="card-kicker">{m.city}</span>
                  <span className="card-title" style={{ fontSize: 22 }}>
                    {m.name}
                  </span>
                  <span style={{ fontSize: 13, opacity: 0.7 }}>
                    {m.storeCount ?? 0} boutiques
                  </span>
                </div>
              </div>
            </button>
          ))}
          {!featured.length && (
            <p className="text-muted" style={{ gridColumn: "1 / -1" }}>
              {markets.isPending ? "Chargement des marchés…" : "Aucun marché pour le moment."}
            </p>
          )}
        </div>
      </section>

      <section style={{ padding: "48px 0" }}>
        <h2 style={{ margin: "0 0 24px" }}>Catégories populaires</h2>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className="btn btn-secondary"
              onClick={() => navigate(`/recherche?cat=${encodeURIComponent(c)}`)}
              style={{ padding: "11px 22px", fontSize: 14 }}
            >
              {c}
            </button>
          ))}
        </div>
      </section>

      <FeaturedProducts onAdd={(id) => addToCart.mutate(id)} />

      <section
        data-cols
        style={{
          padding: "56px 0 0",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 56,
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 20px" }}>Pour les acheteurs</h3>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 15, lineHeight: 2.1, opacity: 0.8 }}>
            <li>Trouvez un marché près de vous</li>
            <li>Explorez les boutiques</li>
            <li>Choisissez vos produits</li>
            <li>Commandez et suivez la livraison</li>
          </ol>
        </div>
        <div>
          <h3 style={{ margin: "0 0 20px" }}>Pour les commerçants</h3>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 15, lineHeight: 2.1, opacity: 0.8 }}>
            <li>Créez votre compte vendeur</li>
            <li>Rattachez votre boutique à un marché</li>
            <li>Ajoutez vos produits</li>
            <li>Recevez vos premières commandes</li>
          </ol>
          <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={() => navigate("/inscription?role=STORE_OWNER")}>
              Devenir vendeur
            </button>
            <button className="btn btn-secondary" onClick={() => navigate("/inscription?role=DELIVERER")}>
              Devenir livreur
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * Featured products come from the first market's first store — there is no
 * curation table yet, so this is an honest stand-in rather than a fake list.
 */
function FeaturedProducts({ onAdd }: { onAdd: (productId: string) => void }) {
  const navigate = useNavigate();
  const markets = useQuery({
    queryKey: ["markets", "featured"],
    queryFn: () => api.marketsInBounds(FEATURED_BOUNDS),
  });
  // The first market with shops, not simply the first: picking blindly meant a
  // market with zero boutiques produced "aucun produit" on a stocked site.
  const firstMarket =
    markets.data?.markets.find((m) => (m.storeCount ?? 0) > 0) ?? markets.data?.markets[0];

  const stores = useQuery({
    queryKey: ["market", firstMarket?.id, "stores"],
    queryFn: () => api.marketStores(firstMarket!.id),
    enabled: !!firstMarket,
  });
  const firstStore = stores.data?.stores[0];

  const products = useQuery({
    queryKey: ["store", firstStore?.id, "products"],
    queryFn: () => api.storeProducts(firstStore!.id),
    enabled: !!firstStore,
  });

  const items = products.data?.products.slice(0, 4) ?? [];

  return (
    <section style={{ padding: "48px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <h2 style={{ margin: 0 }}>Produits en vedette</h2>
        <button className="btn btn-ghost" onClick={() => navigate("/recherche")}>
          Tout voir
        </button>
      </div>
      <div data-cols="products" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 22 }}>
        {items.map((p) => (
          <div key={p.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
            <button
              onClick={() => navigate(`/produits/${p.id}`)}
              style={{ border: 0, padding: 0, background: "none", textAlign: "left" }}
            >
              <Ph label="photo produit · 800 × 800" height={190} src={p.imageUrl} />
            </button>
            <div
              style={{
                padding: "16px 18px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.6 }}>{firstStore?.name}</span>
              <button
                onClick={() => navigate(`/produits/${p.id}`)}
                className="card-title"
                style={{ border: 0, background: "none", padding: 0, textAlign: "left" }}
              >
                {p.name}
              </button>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <strong style={{ fontSize: 17, color: "var(--color-accent-700)" }}>
                  {money(p.priceMinor, p.currency)}
                </strong>
              </span>
              <button
                className="btn btn-primary btn-block"
                disabled={p.stock < 1}
                onClick={() => onAdd(p.id)}
              >
                {p.stock < 1 ? "Rupture de stock" : "Ajouter au panier"}
              </button>
            </div>
          </div>
        ))}
        {!items.length && (
          <p className="text-muted" style={{ gridColumn: "1 / -1" }}>
            Aucun produit publié pour le moment.
          </p>
        )}
      </div>
    </section>
  );
}
