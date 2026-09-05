import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, money, type CartLine } from "../lib/api";
import { Ph } from "../components/Header";

/** Flat delivery fee, mirroring the worker's checkout calculation. */
const DELIVERY_FEE_MINOR = 1500;

export function Cart() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const cart = useQuery({ queryKey: ["cart"], queryFn: api.cart });

  const setQty = useMutation({
    mutationFn: ({ lineId, qty }: { lineId: string; qty: number }) => api.setCartQty(lineId, qty),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cart"] }),
  });

  const lines = cart.data?.lines ?? [];

  // The design groups the cart by store — each store ships separately, and the
  // checkout endpoint refuses a cart spanning more than one.
  const groups = useMemo(() => {
    const byStore = new Map<string, { storeName: string; marketName: string; items: CartLine[] }>();
    for (const l of lines) {
      const g = byStore.get(l.storeId) ?? {
        storeName: l.storeName,
        marketName: l.marketName,
        items: [],
      };
      g.items.push(l);
      byStore.set(l.storeId, g);
    }
    return [...byStore.entries()].map(([storeId, g]) => ({
      storeId,
      ...g,
      subtotalMinor: g.items.reduce((n, i) => n + i.priceMinor * i.qty, 0),
    }));
  }, [lines]);

  const cartCount = lines.reduce((n, l) => n + l.qty, 0);
  const subtotalMinor = cart.data?.subtotalMinor ?? 0;

  if (cart.isPending) {
    return <main style={page}><p className="text-muted">Chargement…</p></main>;
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "44px 40px 120px" }}>
      <h1 style={{ margin: "0 0 6px", fontSize: 42 }}>Votre panier</h1>
      <p style={{ opacity: 0.65, fontSize: 14, margin: "0 0 34px" }}>
        {cartCount} article{cartCount > 1 ? "s" : ""} · {groups.length} boutique
        {groups.length > 1 ? "s" : ""} · chaque boutique expédie séparément
      </p>

      <div
        data-cols
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gap: 48,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {groups.map((g) => (
            <div key={g.storeId} className="card" style={{ padding: "22px 24px", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div>
                  <p className="card-kicker" style={{ margin: 0 }}>
                    {g.marketName}
                  </p>
                  <p className="card-title" style={{ margin: "2px 0 0", fontSize: 19 }}>
                    {g.storeName}
                  </p>
                </div>
                <span style={{ fontSize: 13, opacity: 0.7 }}>
                  Sous-total {money(g.subtotalMinor)}
                </span>
              </div>

              {g.items.map((it) => (
                <div
                  key={it.lineId}
                  style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "center",
                    paddingTop: 14,
                    boxShadow: "0 -1px 0 var(--color-divider)",
                  }}
                >
                  <Ph
                    label="photo"
                    height={76}
                    style={{ width: 76, borderRadius: 20, flex: "none" }}
                  />
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 15 }}>{it.name}</p>
                    {it.variantLabel && (
                      <p style={{ margin: "1px 0 0", fontSize: 12, opacity: 0.7 }}>
                        {it.variantLabel}
                      </p>
                    )}
                    <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.65 }}>
                      {money(it.priceMinor)} l'unité
                    </p>
                    {it.stock < it.qty && (
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-accent-700)" }}>
                        Stock insuffisant · {it.stock} restant{it.stock > 1 ? "s" : ""}
                      </p>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      border: "1px solid var(--color-divider)",
                      borderRadius: 999,
                      padding: "3px 5px",
                    }}
                  >
                    <button
                      className="btn btn-icon"
                      disabled={setQty.isPending}
                      onClick={() =>
                        setQty.mutate({ lineId: it.lineId, qty: Math.max(0, it.qty - 1) })
                      }
                    >
                      –
                    </button>
                    <span style={{ minWidth: 22, textAlign: "center", fontSize: 14 }}>{it.qty}</span>
                    <button
                      className="btn btn-icon"
                      disabled={setQty.isPending || it.qty >= 99}
                      onClick={() => setQty.mutate({ lineId: it.lineId, qty: it.qty + 1 })}
                    >
                      +
                    </button>
                  </div>

                  <button
                    className="btn btn-ghost"
                    onClick={() => setQty.mutate({ lineId: it.lineId, qty: 0 })}
                    style={{ fontSize: 12 }}
                  >
                    Retirer
                  </button>
                </div>
              ))}
            </div>
          ))}

          {!lines.length && (
            <div className="card" style={{ alignItems: "flex-start", padding: 40 }}>
              <p className="card-title" style={{ margin: 0, fontSize: 20 }}>
                Votre panier est vide
              </p>
              <p style={{ fontSize: 14, opacity: 0.7, margin: 0 }}>
                Explorez les marchés pour trouver vos premières boutiques.
              </p>
              <button className="btn btn-primary" onClick={() => navigate("/carte")}>
                Explorer la carte
              </button>
            </div>
          )}
        </div>

        <div data-sticky className="card elev-sm" style={{ padding: 24, position: "sticky", top: 90 }}>
          <p className="card-kicker" style={{ margin: 0 }}>
            Récapitulatif
          </p>
          <Row label="Sous-total" value={money(subtotalMinor)} />
          <Row label="Livraison" value={lines.length ? money(DELIVERY_FEE_MINOR) : "—"} />
          <Row label="Remise" value="0,00 MAD" />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "var(--font-heading)",
              fontSize: 24,
              paddingTop: 10,
              boxShadow: "0 -1px 0 var(--color-divider)",
            }}
          >
            <span>Total</span>
            <span>{money(subtotalMinor + (lines.length ? DELIVERY_FEE_MINOR : 0))}</span>
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={!lines.length}
            onClick={() => navigate("/commande")}
            style={{ padding: 14, fontSize: 15 }}
          >
            Passer au paiement
          </button>
          {groups.length > 1 && (
            <p style={{ fontSize: 12, color: "var(--color-accent-700)", margin: "6px 0 0" }}>
              Votre panier contient plusieurs boutiques. Commandez une boutique à la fois.
            </p>
          )}
          <p style={{ fontSize: 12, opacity: 0.6, margin: "6px 0 0" }}>
            Paiement à la livraison ou par carte.
          </p>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const page: React.CSSProperties = { maxWidth: 1180, margin: "0 auto", padding: "44px 40px" };
