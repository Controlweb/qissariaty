import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Field } from "../components/Field";
import { SellerSignup } from "./SellerSignup";
import { DelivererSignup } from "./DelivererSignup";

type Role = "CUSTOMER" | "STORE_OWNER" | "DELIVERER";

const ROLES: { role: Role; title: string; blurb: string; cta: string }[] = [
  {
    role: "CUSTOMER",
    title: "Client",
    blurb: "Explorez les marchés, commandez auprès des boutiques et suivez vos livraisons.",
    cta: "Créer un compte client",
  },
  {
    role: "STORE_OWNER",
    title: "Commerçant",
    blurb: "Rattachez votre boutique à son marché et vendez en ligne. Inscription gratuite.",
    cta: "Ouvrir ma boutique",
  },
  {
    role: "DELIVERER",
    title: "Livreur",
    blurb: "Livrez dans votre quartier, à vos horaires. Paiement par course.",
    cta: "Devenir livreur",
  },
];

/**
 * One entry point for every kind of account.
 *
 * Role comes first because the three paths genuinely differ: a customer needs
 * four fields, a merchant and a deliverer each need a vetted multi-step file.
 * Asking for a name and an email before knowing which is being created means
 * collecting the wrong things, which is what the old single form did.
 *
 * The choice is kept in the URL (`?role=`) so it survives a reload and can be
 * linked to directly from the marketing CTAs.
 */
export function Signup() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("role");
  const role = ROLES.some((r) => r.role === raw) ? (raw as Role) : null;

  const choose = (next: Role) => setParams({ role: next });

  if (role === "STORE_OWNER") return <Chosen onBack={() => setParams({})}><SellerSignup /></Chosen>;
  if (role === "DELIVERER") return <Chosen onBack={() => setParams({})}><DelivererSignup /></Chosen>;
  if (role === "CUSTOMER") return <Chosen onBack={() => setParams({})}><CustomerSignup /></Chosen>;

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "64px 40px 120px" }}>
      <p className="card-kicker" style={{ margin: "0 0 14px" }}>
        Créer un compte
      </p>
      <h1 style={{ margin: "0 0 12px", maxWidth: "18ch" }}>Vous rejoignez Qissariaty en tant que…</h1>
      <p style={{ fontSize: 17, opacity: 0.75, maxWidth: "52ch", margin: "0 0 36px" }}>
        Choisissez votre profil : la suite de l'inscription s'adapte à ce que vous venez faire.
      </p>

      <div data-cols style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 22 }}>
        {ROLES.map((r) => (
          <button
            key={r.role}
            onClick={() => choose(r.role)}
            style={{ border: 0, background: "none", padding: 0, textAlign: "left" }}
          >
            <div
              className="card elev-sm"
              style={{ padding: 26, gap: 12, height: "100%", alignItems: "flex-start" }}
            >
              <p className="card-title" style={{ margin: 0, fontSize: 22 }}>
                {r.title}
              </p>
              <p style={{ margin: 0, fontSize: 14, opacity: 0.75, flex: 1 }}>{r.blurb}</p>
              <span className="btn btn-primary" style={{ marginTop: 6 }}>
                {r.cta}
              </span>
            </div>
          </button>
        ))}
      </div>

      <p style={{ fontSize: 14, opacity: 0.75, marginTop: 30 }}>
        Vous avez déjà un compte ? <Anchor to="/connexion">Connectez-vous</Anchor>.
      </p>
    </main>
  );
}

/** Wraps a chosen path with a way back to the role picker. */
function Chosen({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 40px 0" }}>
        <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onBack}>
          ← Changer de profil
        </button>
      </div>
      {children}
    </>
  );
}

/** The customer path: the only one that is a single short form. */
function CustomerSignup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });

  const register = useMutation({
    mutationFn: () =>
      api.register({
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        role: "CUSTOMER",
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.invalidateQueries({ queryKey: ["cart"] });
      navigate("/");
    },
  });

  const ready = form.name.trim().length >= 2 && form.email.includes("@") && form.password.length >= 8;

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 40px 120px" }}>
      <p className="card-kicker" style={{ margin: "0 0 14px" }}>
        Compte client
      </p>
      <h1 style={{ margin: "0 0 12px", maxWidth: "18ch" }}>Achetez dans les souks, en ligne.</h1>
      <p style={{ fontSize: 17, opacity: 0.75, maxWidth: "52ch", margin: "0 0 30px" }}>
        Suivez vos commandes et enregistrez vos marchés préférés. Vous pouvez aussi commander sans
        compte : il sera créé à votre première commande.
      </p>

      <form
        className="card"
        style={{ padding: 30, maxWidth: 620, gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate();
        }}
      >
        <div data-cols style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Nom complet">
            {({ id }) => (
              <input
                id={id}
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Salma El Amrani"
              />
            )}
          </Field>
          <Field label="Téléphone">
            {({ id }) => (
              <input
                id={id}
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
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
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            )}
          </Field>
          <Field label="Mot de passe">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="8 caractères minimum"
              />
            )}
          </Field>
        </div>

        {register.isError && (
          <p style={{ color: "var(--color-accent-700)", fontSize: 14, margin: 0 }}>
            {register.error.message}
          </p>
        )}

        <button
          className="btn btn-primary"
          style={{ alignSelf: "flex-start", padding: "13px 28px" }}
          disabled={!ready || register.isPending}
        >
          {register.isPending ? "…" : "Créer mon compte"}
        </button>
      </form>
    </main>
  );
}

function Anchor({ to, children }: { to: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
