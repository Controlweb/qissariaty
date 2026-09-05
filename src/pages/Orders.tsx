import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, money } from "../lib/api";
import { ProfileCard } from "../components/ProfileCard";
import { PasswordCard } from "../components/PasswordCard";
import type { Order } from "../../worker/schema";

/** The pipeline a customer actually sees, in order. */
const FLOW = ["PENDING", "CONFIRMED", "PREPARING", "READY", "IN_TRANSIT", "DELIVERED"] as const;
const FLOW_LABELS = ["Reçue", "Confirmée", "Préparation", "Prête", "En route", "Livrée"];

const STATUS_LABEL: Record<Order["status"], string> = {
  PENDING: "Reçue",
  CONFIRMED: "Confirmée",
  PREPARING: "En préparation",
  READY: "Prête",
  IN_TRANSIT: "En route",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
};

export function Orders() {
  const navigate = useNavigate();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["orders"],
    queryFn: api.orders,
  });

  if (isPending) return <main style={page}><p className="text-muted">Chargement…</p></main>;
  if (isError) {
    return (
      <main style={page}>
        <p style={{ color: "var(--color-accent-700)" }}>{error.message}</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "44px 40px 120px" }}>
      <p style={{ fontSize: 12, opacity: 0.6, margin: "0 0 10px" }}>Compte / Commandes</p>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 34,
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 6px", fontSize: 40 }}>Mes commandes</h1>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.7 }}>
            {data.orders.length} commande{data.orders.length > 1 ? "s" : ""}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate("/")}>
          Besoin d'aide ?
        </button>
      </div>

      <div
        data-cols
        style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 48, alignItems: "start" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {data.orders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}

          {!data.orders.length && (
            <div className="card" style={{ alignItems: "flex-start", padding: 40 }}>
              <p className="card-title" style={{ margin: 0, fontSize: 20 }}>
                Aucune commande
              </p>
              <p style={{ fontSize: 14, opacity: 0.7, margin: 0 }}>
                Vos commandes apparaîtront ici une fois passées.
              </p>
              <button className="btn btn-primary" onClick={() => navigate("/carte")}>
                Explorer la carte
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <ProfileCard />
          <PasswordCard />

          <div className="card">
            <p className="card-kicker" style={{ margin: 0 }}>
              Paiement
            </p>
            <p style={{ margin: 0, fontSize: 14 }}>
              Paiement à la livraison. Aucune carte n'est enregistrée.
            </p>
          </div>

          <div className="card">
            <p className="card-kicker" style={{ margin: 0 }}>
              Rejoindre Qissariaty
            </p>
            <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
              Vous tenez une boutique ou vous souhaitez livrer dans votre quartier ?
            </p>
            <button
              className="btn btn-secondary btn-block"
              onClick={() => navigate("/inscription?role=STORE_OWNER")}
            >
              Devenir vendeur
            </button>
            <button
              className="btn btn-secondary btn-block"
              onClick={() => navigate("/inscription?role=DELIVERER")}
            >
              Devenir livreur
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function OrderCard({ order }: { order: Order }) {
  const items = useQuery({
    queryKey: ["order", order.id],
    queryFn: () => api.order(order.id),
  });

  const reached = FLOW.indexOf(order.status as (typeof FLOW)[number]);
  const cancelled = order.status === "CANCELLED";

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <p className="card-kicker" style={{ margin: 0 }}>
            {new Date(order.createdAt * 1000).toLocaleDateString("fr-MA", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
          <p className="card-title" style={{ margin: "2px 0 0", fontSize: 19 }}>
            {order.ref}
          </p>
        </div>
        <span className={cancelled ? "tag tag-neutral" : "tag tag-accent-2"}>
          {STATUS_LABEL[order.status]}
        </span>
      </div>

      {!cancelled && (
        <div style={{ display: "flex", gap: 8, margin: "16px 0 6px" }}>
          {FLOW_LABELS.map((label, i) => (
            <div key={label} style={{ flex: 1 }}>
              <div
                style={{
                  height: 4,
                  borderRadius: 999,
                  background:
                    i <= reached ? "var(--color-accent)" : "var(--color-neutral-300)",
                }}
              />
              <p style={{ margin: "8px 0 0", fontSize: 11, opacity: 0.7 }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {items.data?.items.map((it) => (
        <div
          key={it.id}
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            paddingTop: 14,
            boxShadow: "0 -1px 0 var(--color-divider)",
          }}
        >
          <div className="ph" style={{ width: 56, height: 56, borderRadius: 16, flex: "none" }}>
            photo
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14 }}>{it.name}</p>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.65 }}>
              {it.qty} × {money(it.unitPriceMinor)}
            </p>
          </div>
        </div>
      ))}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-heading)",
          fontSize: 18,
          paddingTop: 14,
          marginTop: 4,
          boxShadow: "0 -1px 0 var(--color-divider)",
        }}
      >
        <span>Total</span>
        <span>{money(order.totalMinor, order.currency)}</span>
      </div>
    </div>
  );
}

const page: React.CSSProperties = { maxWidth: 1080, margin: "0 auto", padding: "44px 40px" };
