import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Ph } from "../components/Header";
import { useIsMobile } from "../components/TabBar";

const CATS = ["Artisanat", "Épicerie", "Textile", "Cuir"];

const chipStyle = (on: boolean): React.CSSProperties =>
  on
    ? { background: "var(--color-accent)", color: "var(--color-bg)", fontSize: 13, padding: "7px 14px" }
    : { border: "1px solid var(--color-divider)", fontSize: 13, padding: "7px 14px" };

const statLabel: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  opacity: 0.6,
  margin: 0,
};
const statValue: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: 28,
  margin: "4px 0 0",
};

export function MarketDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const isMobile = useIsMobile();
  /**
   * The artboard ships two market layouts. Sidebar is the default working view;
   * editorial leads with a full-bleed cover and oversized name. Mobile always
   * gets sidebar — the editorial hero does not survive a 390px viewport.
   */
  const [editorial, setEditorial] = useState(false);
  const isEditorial = editorial && !isMobile;

  const market = useQuery({ queryKey: ["market", id], queryFn: () => api.market(id) });
  const stores = useQuery({
    queryKey: ["market", id, "stores"],
    queryFn: () => api.marketStores(id),
  });

  const visible = useMemo(() => {
    let rows = stores.data?.stores ?? [];
    if (q.trim()) {
      const needle = q.toLowerCase();
      rows = rows.filter((s) => s.name.toLowerCase().includes(needle));
    }
    return rows;
  }, [stores.data, q]);

  if (market.isPending) {
    return <main style={page}><p className="text-muted">Chargement…</p></main>;
  }
  if (market.isError) {
    return <main style={page}><p style={{ color: "var(--color-accent-700)" }}>{market.error.message}</p></main>;
  }

  const m = market.data.market;

  return (
    <main>
      {isEditorial ? (
        <div style={{ position: "relative" }}>
          <Ph label="photo de couverture du marché · 2400 × 1000" height={420} src={m.coverUrl} />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              padding: "56px 40px 36px",
              background:
                "linear-gradient(transparent, color-mix(in srgb, var(--color-bg) 92%, transparent) 60%)",
            }}
          >
            <div style={{ maxWidth: 1280, margin: "0 auto" }}>
              <p
                style={{
                  fontSize: 12,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  opacity: 0.7,
                  margin: "0 0 10px",
                }}
              >
                {m.city} · Maroc
              </p>
              <h1 style={{ margin: 0, fontSize: 76, lineHeight: 0.98 }}>{m.name}</h1>
            </div>
          </div>
        </div>
      ) : (
        <Ph label="photo de couverture du marché · 2400 × 800" height={300} src={m.coverUrl} />
      )}

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 40px 96px" }}>
        <div
          data-row
          style={{
            display: isEditorial ? "none" : "flex",
            gap: 24,
            alignItems: "flex-end",
            marginTop: -56,
            position: "relative",
          }}
        >
          <div
            className="ph elev-md"
            style={{
              width: 130,
              height: 130,
              borderRadius: 999,
              flex: "none",
              border: "6px solid var(--color-bg)",
            }}
          >
            logo
          </div>
          <div style={{ paddingBottom: 14 }}>
            <p style={{ fontSize: 12, opacity: 0.6, margin: "0 0 6px" }}>
              Accueil / {m.city} / {m.name}
            </p>
            <h1 style={{ margin: 0, fontSize: 46 }}>{m.name}</h1>
          </div>
          <div style={{ marginLeft: "auto", paddingBottom: 16, display: "flex", gap: 10 }}>
            {!isMobile && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => setEditorial(true)}
              >
                Vue éditoriale
              </button>
            )}
            <button className="btn btn-secondary">Enregistrer</button>
            <button className="btn btn-primary" onClick={() => navigate("/carte")}>
              Voir sur la carte
            </button>
          </div>
        </div>

        {isEditorial && (
          <div
            data-cols
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 28,
              padding: "34px 0",
              boxShadow: "0 1px 0 var(--color-divider)",
            }}
          >
            <div>
              <p style={statLabel}>Boutiques</p>
              <p style={{ ...statValue, fontSize: 32 }}>{stores.data?.stores.length ?? 0}</p>
            </div>
            <div>
              <p style={statLabel}>Ville</p>
              <p style={{ ...statValue, fontSize: 32 }}>{m.city}</p>
            </div>
            <div>
              <p style={statLabel}>Coordonnées</p>
              <p style={{ ...statValue, fontSize: 24 }}>
                {m.lat.toFixed(3)}, {m.lng.toFixed(3)}
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setEditorial(false)}>
                Vue liste
              </button>
              <button className="btn btn-primary" onClick={() => navigate("/carte")}>
                Voir sur la carte
              </button>
            </div>
          </div>
        )}

        <div
          data-cols
          style={{
            display: "grid",
            gridTemplateColumns: isEditorial ? "1.3fr 1fr" : "1fr 320px",
            gap: 56,
            marginTop: 44,
          }}
        >
          <div>
            {m.description && (
              <p style={{ fontSize: 17, opacity: 0.78, maxWidth: "62ch", margin: "0 0 28px" }}>
                {m.description}
              </p>
            )}

            <div style={{ display: "flex", gap: 34, marginBottom: 36 }}>
              <div>
                <p style={statLabel}>Boutiques</p>
                <p style={statValue}>{stores.data?.stores.length ?? 0}</p>
              </div>
              <div>
                <p style={statLabel}>Ville</p>
                <p style={statValue}>{m.city}</p>
              </div>
            </div>

            <h3 style={{ margin: "0 0 14px" }}>Chercher dans ce marché</h3>
            <input
              className="input"
              placeholder="Ex. « ordinateur » — uniquement dans ce marché"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 30 }}>
              {CATS.map((c) => (
                <button
                  key={c}
                  className="btn"
                  onClick={() => setCat(cat === c ? null : c)}
                  style={chipStyle(cat === c)}
                >
                  {c}
                </button>
              ))}
            </div>

            <h2 style={{ margin: "0 0 20px" }}>
              {visible.length} boutique{visible.length > 1 ? "s" : ""}
            </h2>

            <div data-cols="products" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 22 }}>
              {visible.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/boutiques/${s.id}`)}
                  style={{ textAlign: "left", border: 0, background: "none", padding: 0 }}
                >
                  <div
                    className="card elev-sm"
                    style={{ padding: 0, overflow: "hidden", height: "100%" }}
                  >
                    <Ph label="photo boutique · 800 × 500" height={150} src={s.logoUrl} />
                    <div
                      style={{
                        padding: "18px 20px 20px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <span className="card-kicker">Boutique</span>
                      <span className="card-title" style={{ fontSize: 20 }}>
                        {s.name}
                      </span>
                      {s.description && (
                        <span style={{ fontSize: 12, opacity: 0.65 }}>{s.description}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {!visible.length && (
              <div className="card" style={{ alignItems: "flex-start", gap: 12, padding: 34 }}>
                <p className="card-title" style={{ margin: 0 }}>
                  Aucune boutique ne correspond
                </p>
                <p style={{ fontSize: 14, opacity: 0.7, margin: 0 }}>
                  Essayez un autre mot-clé ou retirez les filtres de catégorie.
                </p>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setQ("");
                    setCat(null);
                  }}
                >
                  Réinitialiser les filtres
                </button>
              </div>
            )}
          </div>

          <aside style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div className="card">
              <p className="card-kicker" style={{ margin: 0 }}>
                Informations
              </p>
              <p style={{ fontSize: 14, margin: 0, lineHeight: 1.9 }}>
                {m.city}, Maroc
              </p>
              <div className="ph" style={{ height: 150, borderRadius: 20, marginTop: 12 }}>
                mini-carte · {m.lat.toFixed(4)}, {m.lng.toFixed(4)}
              </div>
              <button className="btn btn-secondary btn-block" onClick={() => navigate("/carte")}>
                Itinéraire
              </button>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

const page: React.CSSProperties = { maxWidth: 1280, margin: "0 auto", padding: "72px 40px" };
