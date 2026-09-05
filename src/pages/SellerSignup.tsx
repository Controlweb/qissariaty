import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useSession } from "../App";
import { Field } from "../components/Field";
import { ImageUpload } from "../components/ImageUpload";

const STEPS = ["Votre compte", "Votre boutique", "Emplacement", "Dossier envoyé"];

const stepStyle = (i: number, current: number): React.CSSProperties =>
  i === current
    ? { background: "var(--color-accent)", color: "var(--color-bg)" }
    : i < current
      ? { background: "var(--color-accent-2-100)", color: "var(--color-accent-2-800)" }
      : { border: "1px solid var(--color-divider)", opacity: 0.7 };

/**
 * Merchant onboarding, four steps, ported from `isSellerSignup`.
 *
 * Public on purpose: this is how a visitor *becomes* a merchant, so gating it
 * behind the STORE_OWNER role — as the dashboard route is — would make it
 * unreachable by exactly the people it is for. Step 1 registers the account (or
 * is skipped when already signed in); the shop is created at the end.
 */
export function SellerSignup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const signedIn = !!session?.user;

  // A signed-in visitor has no account step to complete.
  const [step, setStep] = useState(signedIn ? 1 : 0);
  const [account, setAccount] = useState({ name: "", phone: "", email: "", password: "" });
  const [shop, setShop] = useState({
    name: "",
    category: "",
    registryNumber: "",
    description: "",
  });
  const [logoKey, setLogoKey] = useState<string | null>(null);
  const [marketId, setMarketId] = useState("");
  const [proposing, setProposing] = useState(false);
  const [proposal, setProposal] = useState({ name: "", city: "Casablanca", note: "" });

  const markets = useQuery({ queryKey: ["markets", "all"], queryFn: () => api.markets() });

  const register = useMutation({
    mutationFn: () =>
      api.register({
        name: account.name,
        email: account.email,
        password: account.password,
        phone: account.phone || undefined,
        // Registered as a customer; /seller/apply promotes on submission, so an
        // abandoned wizard does not leave a shopless STORE_OWNER behind.
        role: "CUSTOMER",
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      setStep(1);
    },
  });

  const apply = useMutation({
    mutationFn: () => {
      const picked = markets.data?.markets.find((m) => m.id === marketId);
      return api.applyAsSeller({
        name: shop.name,
        marketId,
        logoKey: logoKey ?? undefined,
        category: shop.category || undefined,
        registryNumber: shop.registryNumber || undefined,
        description: shop.description || undefined,
        phone: account.phone || undefined,
        // The design's step 3 has a map to place the exact shop pin; until that
        // exists, inherit the market's coordinates rather than inventing any.
        lat: picked?.lat ?? 33.5731,
        lng: picked?.lng ?? -7.5898,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.invalidateQueries({ queryKey: ["me", "stores"] });
      setStep(3);
    },
  });

  const requestMarket = useMutation({
    mutationFn: () =>
      api.requestMarket({
        name: proposal.name,
        city: proposal.city,
        note: proposal.note || undefined,
      }),
    onSuccess: () => setProposing(false),
  });

  const canNext =
    step === 0
      ? account.name.length >= 2 && !!account.email && account.password.length >= 8
      : step === 1
        ? shop.name.length >= 2
        : step === 2
          ? !!marketId
          : false;

  const next = () => {
    if (step === 0) return register.mutate();
    if (step === 2) return apply.mutate();
    setStep(step + 1);
  };

  const nextLabel = step === 0 ? "Créer mon compte" : step === 2 ? "Envoyer le dossier" : "Continuer";
  const busy = register.isPending || apply.isPending;

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "52px 40px 120px" }}>
      <p className="card-kicker" style={{ margin: "0 0 14px" }}>
        Vendre sur Qissariaty
      </p>
      <h1 style={{ margin: "0 0 12px", fontSize: 48, maxWidth: "20ch" }}>
        Votre boutique du souk, en ligne.
      </h1>
      <p style={{ fontSize: 17, opacity: 0.75, maxWidth: "52ch", margin: "0 0 34px" }}>
        Rattachez votre boutique à son marché, ajoutez vos produits, recevez vos commandes.
        Inscription gratuite.
      </p>

      <div className="hscroll" style={{ marginBottom: 30 }}>
        {STEPS.map((label, i) => (
          <span key={label} className="tag" style={{ ...stepStyle(i, step), flex: "none" }}>
            {label}
          </span>
        ))}
      </div>

      <div className="card" style={{ padding: 30, maxWidth: 680 }}>
        {step === 0 && (
          <>
            <h3 style={{ margin: "0 0 18px" }}>Votre compte</h3>
            <div data-cols style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Nom complet">
          {({ id }) => (
            <input
            id={id}
            className="input"
            placeholder="Karim Bennani"
            value={account.name}
            onChange={(e) => setAccount({ ...account, name: e.target.value })}
            />
          )}
        </Field>
              <Field label="Téléphone">
          {({ id }) => (
            <input
            id={id}
            className="input"
            placeholder="+212 6.."
            value={account.phone}
            onChange={(e) => setAccount({ ...account, phone: e.target.value })}
            />
          )}
        </Field>
              <Field label="E-mail">
          {({ id }) => (
            <input
            id={id}
            className="input"
            type="email"
            placeholder="karim@boutique.ma"
            value={account.email}
            onChange={(e) => setAccount({ ...account, email: e.target.value })}
            />
          )}
        </Field>
              <Field label="Mot de passe">
          {({ id }) => (
            <input
            id={id}
            className="input"
            type="password"
            placeholder="8 caractères minimum"
            value={account.password}
            onChange={(e) => setAccount({ ...account, password: e.target.value })}
            />
          )}
        </Field>
            </div>
            {register.isError && <Err>{register.error.message}</Err>}
            <p style={{ fontSize: 13, opacity: 0.7, margin: "16px 0 0" }}>
              Vous avez déjà un compte ?{" "}
              <a
                href="/connexion"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/connexion");
                }}
              >
                Connectez-vous
              </a>{" "}
              puis revenez ici.
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <h3 style={{ margin: "0 0 18px" }}>Votre boutique</h3>
            <div data-cols style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Field label="Nom de la boutique" style={{ gridColumn: "1/-1" }}>
          {({ id }) => (
            <input
            id={id}
            className="input"
            placeholder="Tissus Bennani"
            value={shop.name}
            onChange={(e) => setShop({ ...shop, name: e.target.value })}
            />
          )}
        </Field>
              <Field label="Catégorie principale">
          {({ id }) => (
            <input
            id={id}
            className="input"
            placeholder="Textile"
            value={shop.category}
            onChange={(e) => setShop({ ...shop, category: e.target.value })}
            />
          )}
        </Field>
              <Field label="Registre de commerce">
          {({ id }) => (
            <input
            id={id}
            className="input"
            placeholder="RC 148920"
            value={shop.registryNumber}
            onChange={(e) => setShop({ ...shop, registryNumber: e.target.value })}
            />
          )}
        </Field>
              <div style={{ gridColumn: "1/-1" }}>
                <ImageUpload
                  prefix="stores"
                  label="Logo de la boutique"
                  value={logoKey}
                  onUploaded={setLogoKey}
                  options={{ maxDimension: 800, quality: 0.85 }}
                />
              </div>
              <Field label="Description" style={{ gridColumn: "1/-1" }}>
          {({ id }) => (
            <textarea
            id={id}
            className="input"
            style={{ borderRadius: 20 }}
            placeholder="Ce que vous vendez, depuis quand, ce qui vous distingue."
            value={shop.description}
            onChange={(e) => setShop({ ...shop, description: e.target.value })}
            />
          )}
        </Field>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h3 style={{ margin: "0 0 6px" }}>Emplacement</h3>
            <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 16px" }}>
              Votre boutique se trouve-t-elle dans un marché existant ?
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {markets.data?.markets.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMarketId(m.id)}
                  style={{ border: 0, background: "none", padding: 0, textAlign: "left" }}
                >
                  <div
                    className="card"
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 14,
                      padding: "12px 16px",
                      ...(marketId === m.id
                        ? { outline: "2px solid var(--color-accent)", outlineOffset: -2 }
                        : {}),
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 15, fontFamily: "var(--font-heading)" }}>
                        {m.name}
                      </p>
                      <p style={{ margin: 0, fontSize: 12, opacity: 0.65 }}>{m.city}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {!proposing ? (
              <button
                className="btn btn-ghost"
                style={{ marginTop: 14 }}
                onClick={() => setProposing(true)}
              >
                Mon marché n'est pas dans la liste — le proposer
              </button>
            ) : (
              <div className="card" style={{ marginTop: 14, padding: 18, gap: 12 }}>
                <Field label="Nom du marché">
          {({ id }) => (
            <input
            id={id}
            className="input"
            value={proposal.name}
            onChange={(e) => setProposal({ ...proposal, name: e.target.value })}
            placeholder="Souk El Had"
            />
          )}
        </Field>
                <Field label="Ville">
          {({ id }) => (
            <input
            id={id}
            className="input"
            value={proposal.city}
            onChange={(e) => setProposal({ ...proposal, city: e.target.value })}
            />
          )}
        </Field>
                {requestMarket.isError && <Err>{requestMarket.error.message}</Err>}
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    className="btn btn-primary"
                    disabled={proposal.name.length < 2 || requestMarket.isPending}
                    onClick={() => requestMarket.mutate()}
                  >
                    Proposer ce marché
                  </button>
                  <button className="btn btn-ghost" onClick={() => setProposing(false)}>
                    Annuler
                  </button>
                </div>
                <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>
                  Un administrateur l'examinera. En attendant, choisissez le marché le plus proche
                  pour continuer.
                </p>
              </div>
            )}

            {requestMarket.isSuccess && (
              <p style={{ fontSize: 13, color: "var(--color-accent-2-700)", marginTop: 12 }}>
                Marché proposé — nous vous répondrons après vérification.
              </p>
            )}

            <div className="ph" style={{ height: 180, borderRadius: 24, marginTop: 16 }}>
              carte · placer l'emplacement exact de la boutique
            </div>
            {apply.isError && <Err>{apply.error.message}</Err>}
          </>
        )}

        {step === 3 && (
          <>
            <h3 style={{ margin: "0 0 10px" }}>Dossier envoyé</h3>
            <p style={{ fontSize: 15, opacity: 0.78, margin: "0 0 8px" }}>
              Votre boutique est en <strong>attente de validation</strong>. Un administrateur
              vérifie le registre de commerce et l'emplacement.
            </p>
            <span className="tag tag-accent">Statut · en attente</span>
            <button
              className="btn btn-primary"
              style={{ marginTop: 18, alignSelf: "flex-start" }}
              onClick={() => navigate("/vendeur")}
            >
              Aller au tableau de bord
            </button>
          </>
        )}

        {step < 3 && (
          <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
            {step > (signedIn ? 1 : 0) && (
              <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>
                Retour
              </button>
            )}
            <button
              className="btn btn-primary"
              style={{ padding: "12px 26px" }}
              disabled={!canNext || busy}
              onClick={next}
            >
              {busy ? "…" : nextLabel}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

const Err = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: "var(--color-accent-700)", fontSize: 14, margin: "14px 0 0" }}>{children}</p>
);
