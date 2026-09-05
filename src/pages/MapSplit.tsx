import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api, type MapBounds, type MarketCard } from "../lib/api";
import { useUi } from "../store/ui";
import { MarketMap } from "../components/MarketMap";
import { Ph } from "../components/Header";
import { useIsMobile } from "../components/TabBar";

const CITIES = ["Casablanca", "Marrakech", "Fès", "Rabat", "Tanger"];
const CATS = ["Artisanat", "Épicerie", "Textile", "Cuir", "Épices"];

/** Chip styling for the design's `{{ c.style }}` binding — selected vs not. */
const chipStyle = (on: boolean): React.CSSProperties =>
  on
    ? { background: "var(--color-accent)", color: "var(--color-bg)", fontSize: 13, padding: "7px 14px" }
    : { border: "1px solid var(--color-divider)", fontSize: 13, padding: "7px 14px" };

export function MapSplit() {
  const navigate = useNavigate();
  const { bounds, setBounds, filters, setFilter } = useUi();

  const [pending, setPending] = useState<MapBounds | null>(bounds);
  const [query, setQuery] = useState("");
  const [dist, setDist] = useState(120);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  /**
   * The artboard ships two map layouts. Split is the default; immersive is a
   * full-bleed map with the list as floating cards, and is what mobile always
   * gets — a 400px sidebar does not fit a phone.
   */
  const [immersive, setImmersive] = useState(false);
  const fullBleed = immersive || isMobile;

  const { data, isFetching } = useQuery({
    queryKey: ["markets", "bounds", pending && round(pending)],
    queryFn: () => api.marketsInBounds(pending!),
    enabled: !!pending,
    placeholderData: keepPreviousData,
  });

  const markets = useMemo(() => {
    let rows = data?.markets ?? [];
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter((m) => m.name.toLowerCase().includes(q) || m.city.toLowerCase().includes(q));
    }
    if (filters.city) rows = rows.filter((m) => m.city === filters.city);
    return rows;
  }, [data, query, filters.city]);

  const selected: MarketCard | undefined =
    markets.find((m) => m.id === selectedId) ?? markets[0];

  return (
    <main
      style={
        fullBleed
          // flex:1 fills whatever the sticky header leaves; minHeight:0 lets the
          // panels scroll instead of stretching the page.
          ? { position: "relative", flex: 1, minHeight: 0 }
          : { display: "grid", gridTemplateColumns: "400px 1fr", flex: 1, minHeight: 0 }
      }
    >
      <aside
        style={
          fullBleed
            ? {
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 500,
                maxHeight: "46%",
                overflow: "auto",
                padding: "18px 20px 24px",
                background: "var(--color-bg)",
                borderRadius: "28px 28px 0 0",
                boxShadow: "var(--shadow-lg)",
              }
            : {
                overflow: "auto",
                padding: "26px 28px 40px",
                background: "var(--color-bg)",
                boxShadow: "1px 0 0 var(--color-divider)",
              }
        }
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: "0 0 6px", fontSize: 27 }}>Explorer</h2>
          {!isMobile && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              onClick={() => setImmersive(!immersive)}
            >
              {immersive ? "Vue liste" : "Vue immersive"}
            </button>
          )}
        </div>
        <p style={{ fontSize: 13, opacity: 0.65, margin: "0 0 20px" }}>
          {isFetching ? "Recherche…" : `${markets.length} marché${markets.length > 1 ? "s" : ""} dans cette zone`}
        </p>

        <input
          className="input"
          placeholder="Marchés, boutiques, produits"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginBottom: 18 }}
        />

        {/* The filter stack is tall; the bottom sheet has no room for it. */}
        {!fullBleed && (
          <>
            <p style={labelStyle}>Ville</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {CITIES.map((c) => (
                <button
                  key={c}
                  className="btn"
                  onClick={() => setFilter("city", filters.city === c ? null : c)}
                  style={chipStyle(filters.city === c)}
                >
                  {c}
                </button>
              ))}
            </div>

            <p style={labelStyle}>Catégorie</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {CATS.map((c) => (
                <button
                  key={c}
                  className="btn"
                  onClick={() => setFilter("categoryId", filters.categoryId === c ? null : c)}
                  style={chipStyle(filters.categoryId === c)}
                >
                  {c}
                </button>
              ))}
            </div>

            <p style={{ ...labelStyle, marginBottom: 10 }}>Distance · {dist} km</p>
            <input
              type="range"
              min={5}
              max={600}
              step={5}
              value={dist}
              onChange={(e) => setDist(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--color-accent)", marginBottom: 8 }}
            />
          </>
        )}

        <button
          className="btn btn-secondary btn-block"
          onClick={() => {
            navigator.geolocation?.getCurrentPosition((pos) => {
              const { latitude: lat, longitude: lng } = pos.coords;
              const b = { north: lat + 0.05, south: lat - 0.05, east: lng + 0.05, west: lng - 0.05 };
              setPending(b);
              setBounds(b);
            });
          }}
          style={{ marginBottom: 26 }}
        >
          Utiliser ma position
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {markets.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              style={{ textAlign: "left", border: 0, background: "none", padding: 0 }}
            >
              <div
                className="card"
                style={
                  m.id === selected?.id
                    ? { outline: "2px solid var(--color-accent)", outlineOffset: -2 }
                    : undefined
                }
              >
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <Ph
                    label="photo"
                    height={70}
                    src={m.coverUrl}
                    style={{ width: 70, borderRadius: 20, flex: "none" }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span className="card-kicker">{m.city}</span>
                    <span className="card-title">{m.name}</span>
                    <span style={{ fontSize: 12, opacity: 0.65 }}>
                      {m.storeCount ?? 0} boutiques
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
          {!markets.length && !isFetching && (
            <p className="text-muted" style={{ fontSize: 13 }}>
              Aucun marché dans cette zone. Dézoomez ou déplacez la carte.
            </p>
          )}
        </div>
      </aside>

      <div style={fullBleed ? { position: "absolute", inset: 0 } : { position: "relative" }}>
        <MarketMap
          markets={markets}
          selectedId={selected?.id}
          onBoundsChange={(b) => {
            setPending(b);
            setBounds(b);
          }}
          onSelect={setSelectedId}
          compact={isMobile}
        />

        {selected && (
          <div
            style={
              fullBleed
                ? { position: "absolute", left: 16, right: 16, top: 16, zIndex: 400 }
                : { position: "absolute", left: 24, bottom: 24, width: 360, zIndex: 500 }
            }
          >
            <div className="card elev-lg" style={{ padding: 0, overflow: "hidden" }}>
              <Ph label="photo marché · 900 × 400" height={130} src={selected.coverUrl} />
              <div
                style={{ padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 8 }}
              >
                <span className="card-kicker">{selected.city}</span>
                <span className="card-title" style={{ fontSize: 21 }}>
                  {selected.name}
                </span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                  {selected.storeCount ?? 0} boutiques
                </span>
                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => navigate(`/marches/${selected.id}`)}
                  >
                    Ouvrir le marché
                  </button>
                  <button className="btn btn-secondary">Enregistrer</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  opacity: 0.6,
  margin: "0 0 8px",
};

/** ~100 m of precision is plenty for a cache key and collapses jittery pans. */
const round = (b: MapBounds) => ({
  north: +b.north.toFixed(3),
  south: +b.south.toFixed(3),
  east: +b.east.toFixed(3),
  west: +b.west.toFixed(3),
});
