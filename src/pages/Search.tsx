import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, money } from "../lib/api";
import { Ph } from "../components/Header";

type Row = { key: string; name: string; meta: string; right: string; image: string | null; go: () => void };

export function Search() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q")?.trim() ?? "";

  const { data, isPending } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: q.length > 0,
  });

  const groups: { kind: string; items: Row[] }[] = [
    {
      kind: "Marchés",
      items: (data?.markets ?? []).map((m) => ({
        key: m.id,
        name: m.name,
        meta: m.city,
        right: "",
        image: m.coverUrl,
        go: () => navigate(`/marches/${m.id}`),
      })),
    },
    {
      kind: "Boutiques",
      items: (data?.stores ?? []).map((s) => ({
        key: s.id,
        name: s.name,
        meta: s.description ?? "Boutique",
        right: "",
        image: s.logoUrl,
        go: () => navigate(`/boutiques/${s.id}`),
      })),
    },
    {
      kind: "Produits",
      items: (data?.products ?? []).map((p) => ({
        key: p.id,
        name: p.name,
        meta: p.storeName,
        right: money(p.priceMinor, p.currency),
        image: p.imageUrl,
        go: () => navigate(`/produits/${p.id}`),
      })),
    },
  ].filter((g) => g.items.length > 0);

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "48px 40px 96px" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 40 }}>
        {q ? `Résultats pour « ${q} »` : "Rechercher"}
      </h1>
      <p style={{ opacity: 0.65, fontSize: 14, margin: "0 0 36px" }}>
        {!q
          ? "Tapez un marché, une boutique ou un produit dans la barre de recherche."
          : isPending
            ? "Recherche…"
            : `${data?.total ?? 0} résultat${(data?.total ?? 0) > 1 ? "s" : ""}`}
      </p>

      {groups.map((g) => (
        <section key={g.kind} style={{ marginBottom: 44 }}>
          <p className="card-kicker" style={{ margin: "0 0 14px" }}>
            {g.kind}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {g.items.map((it) => (
              <button
                key={it.key}
                onClick={it.go}
                style={{ textAlign: "left", border: 0, background: "none", padding: 0 }}
              >
                <div
                  className="card"
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 18,
                    padding: "16px 20px",
                  }}
                >
                  <Ph
                    label="photo"
                    height={64}
                    src={it.image}
                    style={{ width: 64, borderRadius: 18, flex: "none" }}
                  />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                    <span className="card-title">{it.name}</span>
                    <span style={{ fontSize: 12, opacity: 0.65 }}>{it.meta}</span>
                  </div>
                  <span style={{ fontSize: 15, color: "var(--color-accent-700)" }}>{it.right}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}

      {q && !isPending && !groups.length && (
        <div className="card" style={{ alignItems: "flex-start", padding: 34 }}>
          <p className="card-title" style={{ margin: 0 }}>
            Aucun résultat
          </p>
          <p style={{ fontSize: 14, opacity: 0.7, margin: 0 }}>
            Essayez un autre mot-clé, ou explorez les marchés sur la carte.
          </p>
          <button className="btn btn-primary" onClick={() => navigate("/carte")}>
            Explorer la carte
          </button>
        </div>
      )}
    </main>
  );
}
