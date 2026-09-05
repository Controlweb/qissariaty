import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, money, type CartLine } from "../lib/api";
import { useSession } from "../App";
import { Field } from "../components/Field";

const DELIVERY_FEE_MINOR = 1500;

const STEPS = ["Adresse", "Paiement", "Confirmation"];

const PAY_METHODS = [
  { key: "COD" as const, label: "Paiement à la livraison", hint: "Réglez en espèces au livreur." },
  { key: "CARD" as const, label: "Carte bancaire", hint: "Visa, Mastercard, CMI." },
];

const stepStyle = (i: number, current: number): React.CSSProperties =>
  i === current
    ? { background: "var(--color-accent)", color: "var(--color-bg)" }
    : i < current
      ? { background: "var(--color-accent-2-100)", color: "var(--color-accent-2-800)" }
      : { border: "1px solid var(--color-divider)", opacity: 0.7 };

export function Checkout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [pay, setPay] = useState<"COD" | "CARD">("COD");
  const [addressId, setAddressId] = useState("");
  const [form, setForm] = useState({
    line1: "",
    city: "Casablanca",
    notes: "",
  });

  const { data: session } = useSession();
  const signedIn = !!session?.user;
  const [guest, setGuest] = useState({ name: "", email: "", phone: "", password: "" });

  const cart = useQuery({ queryKey: ["cart"], queryFn: api.cart });
  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: api.addresses,
    enabled: signedIn,
  });

  const lines = cart.data?.lines ?? [];
  const subtotalMinor = cart.data?.subtotalMinor ?? 0;
  const totalMinor = subtotalMinor + (lines.length ? DELIVERY_FEE_MINOR : 0);

  const groups = useMemo(() => groupByStore(lines), [lines]);

  /**
   * Either a saved address is picked or a new one is typed. Both steps gate on
   * this one value — the confirm button used to test `addressId` alone, which
   * left every guest and every first-time buyer unable to place an order.
   */
  const addressReady = addressId ? true : form.line1.trim().length >= 3;

  // Casablanca centroid: the address form has no map picker yet and the API
  // requires coordinates. Replace with a geocode or a map pin.
  const address = () => ({
    line1: form.line1,
    city: form.city,
    lat: 33.5731,
    lng: -7.5898,
    notes: form.notes || undefined,
  });

  const placeOrder = useMutation({
    mutationFn: () =>
      api.checkout({
        ...(addressId ? { addressId } : { address: address() }),
        ...(signedIn
          ? {}
          : {
              guest: {
                name: guest.name,
                email: guest.email,
                phone: guest.phone || undefined,
                password: guest.password || undefined,
              },
            }),
        paymentMethod: pay,
      }),
    onSuccess: ({ order }) => {
      // A guest is signed in by this response, so the session must refresh too.
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["cart"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      setOrderRef(order.ref);
      setAccountCreated(!signedIn);
      setStep(2);
    },
  });
  const [orderRef, setOrderRef] = useState("");
  const [accountCreated, setAccountCreated] = useState(false);

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "44px 40px 120px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 30 }}>
        {STEPS.map((label, i) => (
          <span key={label} className="tag" style={stepStyle(i, step)}>
            {label}
          </span>
        ))}
      </div>

      <div
        data-cols
        style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 48, alignItems: "start" }}
      >
        <div>
          {step === 0 && (
            <>
              <h1 style={{ margin: "0 0 24px", fontSize: 36 }}>Adresse de livraison</h1>

              {!signedIn && (
                <div style={{ marginBottom: 24 }}>
                  <p className="card-kicker" style={{ margin: "0 0 10px" }}>
                    Vos coordonnées
                  </p>
                  <div data-cols style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <Field label="Nom complet">
                      {({ id }) => (
                        <input
                          id={id}
                          className="input"
                          value={guest.name}
                          onChange={(e) => setGuest({ ...guest, name: e.target.value })}
                          placeholder="Salma El Amrani"
                        />
                      )}
                    </Field>
                    <Field label="Téléphone">
                      {({ id }) => (
                        <input
                          id={id}
                          className="input"
                          value={guest.phone}
                          onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
                          placeholder="+212 6.."
                        />
                      )}
                    </Field>
                    <Field label="E-mail">
                      {({ id }) => (
                        <input
                          id={id}
                          className="input"
                          type="email"
                          value={guest.email}
                          onChange={(e) => setGuest({ ...guest, email: e.target.value })}
                          placeholder="salma@example.com"
                        />
                      )}
                    </Field>
                    <Field
                      label="Mot de passe (facultatif)"
                      hint="Pour retrouver vos commandes plus tard."
                    >
                      {({ id }) => (
                        <input
                          id={id}
                          className="input"
                          type="password"
                          value={guest.password}
                          onChange={(e) => setGuest({ ...guest, password: e.target.value })}
                          placeholder="8 caractères minimum"
                        />
                      )}
                    </Field>
                  </div>
                  <p style={{ fontSize: 12, opacity: 0.7, margin: "10px 0 0" }}>
                    Un compte sera créé automatiquement avec cet e-mail à la validation de votre
                    commande. Déjà client ?{" "}
                    <a
                      href="/connexion"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate("/connexion");
                      }}
                    >
                      Connectez-vous
                    </a>
                    .
                  </p>
                </div>
              )}

              {!!addresses.data?.addresses.length && (
                <div style={{ marginBottom: 20 }}>
                  <Field label="Adresses enregistrées">
          {({ id }) => (
            <select
            id={id}
            className="input"
            value={addressId}
            onChange={(e) => setAddressId(e.target.value)}
            >
            <option value="">Nouvelle adresse…</option>
            {addresses.data.addresses.map((a) => (
            <option key={a.id} value={a.id}>
            {a.line1}, {a.city}
            </option>
            ))}
            </select>
          )}
        </Field>
                </div>
              )}

              {!addressId && (
                <div data-cols style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <Field label="Adresse" style={{ gridColumn: "1/-1" }}>
          {({ id }) => (
            <input
            id={id}
            className="input"
            value={form.line1}
            onChange={(e) => setForm({ ...form, line1: e.target.value })}
            placeholder="18 rue Ibn Khaldoun, appartement 6"
            />
          )}
        </Field>
                  <Field label="Ville">
          {({ id }) => (
            <input
            id={id}
            className="input"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          )}
        </Field>
                  <Field label="Instructions de livraison (facultatif)" style={{ gridColumn: "1/-1" }}>
          {({ id }) => (
            <textarea
            id={id}
            className="input"
            style={{ borderRadius: 20 }}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Livrer après 17 h, interphone 6B."
            />
          )}
        </Field>
                </div>
              )}

              <button
                className="btn btn-primary"
                style={{ marginTop: 22, padding: "13px 28px" }}
                disabled={
                  !addressReady ||
                  (!signedIn && (guest.name.trim().length < 2 || !guest.email.includes("@")))
                }
                onClick={() => setStep(1)}
              >
                Continuer vers le paiement
              </button>
            </>
          )}

          {step === 1 && (
            <>
              <h1 style={{ margin: "0 0 24px", fontSize: 36 }}>Paiement</h1>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
                {PAY_METHODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPay(p.key)}
                    style={{ border: 0, background: "none", padding: 0, textAlign: "left" }}
                  >
                    <div
                      className="card"
                      style={
                        pay === p.key
                          ? { outline: "2px solid var(--color-accent)", outlineOffset: -2 }
                          : undefined
                      }
                    >
                      <p className="card-title" style={{ margin: 0, fontSize: 16 }}>
                        {p.label}
                      </p>
                      <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>{p.hint}</p>
                    </div>
                  </button>
                ))}
              </div>

              {pay === "CARD" && (
                <p
                  style={{
                    marginTop: 20,
                    maxWidth: 520,
                    fontSize: 13,
                    color: "var(--color-accent-700)",
                  }}
                >
                  Aucun prestataire de paiement n'est encore raccordé — la commande sera enregistrée
                  comme non payée. Choisissez le paiement à la livraison pour l'instant.
                </p>
              )}

              {placeOrder.isError && (
                <p style={{ color: "var(--color-accent-700)", fontSize: 14, marginTop: 16 }}>
                  {placeOrder.error.message}
                </p>
              )}

              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <button className="btn btn-secondary" onClick={() => setStep(0)}>
                  Retour
                </button>
                <button
                  className="btn btn-primary"
                  style={{ padding: "13px 28px" }}
                  disabled={!addressReady || !lines.length || placeOrder.isPending}
                  onClick={() => placeOrder.mutate()}
                >
                  Confirmer la commande · {money(totalMinor)}
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="card-kicker" style={{ margin: "0 0 12px" }}>
                Commande confirmée
              </p>
              <h1 style={{ margin: "0 0 14px", fontSize: 38 }}>Merci !</h1>
              <p style={{ fontSize: 16, opacity: 0.78, maxWidth: "52ch" }}>
                Votre commande {orderRef} a été transmise à la boutique concernée. Vous recevrez une
                notification à chaque étape.
              </p>
              {accountCreated && (
                <p style={{ fontSize: 14, opacity: 0.75, maxWidth: "52ch", marginTop: 10 }}>
                  Un compte a été créé pour <strong>{guest.email}</strong> et vous y êtes déjà
                  connecté.
                  {!guest.password &&
                    " Définissez un mot de passe depuis votre compte pour vous reconnecter plus tard."}
                </p>
              )}
              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <button className="btn btn-primary" onClick={() => navigate("/compte")}>
                  Suivre ma commande
                </button>
                <button className="btn btn-secondary" onClick={() => navigate("/")}>
                  Continuer mes achats
                </button>
              </div>
            </>
          )}
        </div>

        <div data-sticky className="card elev-sm" style={{ padding: 24, position: "sticky", top: 90 }}>
          <p className="card-kicker" style={{ margin: 0 }}>
            Votre commande
          </p>
          {groups.map((g) => (
            <div key={g.storeId} style={{ paddingBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 13, fontFamily: "var(--font-heading)" }}>
                {g.storeName}
              </p>
              {g.items.map((it) => (
                <p key={it.lineId} style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.7 }}>
                  {it.qty} × {it.name}{it.variantLabel ? ` · ${it.variantLabel}` : ""}
                </p>
              ))}
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 14,
              paddingTop: 10,
              boxShadow: "0 -1px 0 var(--color-divider)",
            }}
          >
            <span style={{ opacity: 0.7 }}>Sous-total</span>
            <span>{money(subtotalMinor)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
            <span style={{ opacity: 0.7 }}>Livraison</span>
            <span>{lines.length ? money(DELIVERY_FEE_MINOR) : "—"}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "var(--font-heading)",
              fontSize: 22,
            }}
          >
            <span>Total</span>
            <span>{money(totalMinor)}</span>
          </div>
        </div>
      </div>
    </main>
  );
}

export function groupByStore(lines: CartLine[]) {
  const byStore = new Map<string, { storeName: string; marketName: string; items: CartLine[] }>();
  for (const l of lines) {
    const g = byStore.get(l.storeId) ?? { storeName: l.storeName, marketName: l.marketName, items: [] };
    g.items.push(l);
    byStore.set(l.storeId, g);
  }
  return [...byStore.entries()].map(([storeId, g]) => ({
    storeId,
    ...g,
    subtotalMinor: g.items.reduce((n, i) => n + i.priceMinor * i.qty, 0),
  }));
}
