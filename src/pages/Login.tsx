import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { Field } from "../components/Field";

/**
 * Sign-in only. Account creation lives at /inscription, which asks for the role
 * first — the three paths need different information, so a single combined form
 * could only ever collect the wrong fields for two of them.
 */
export function Login() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });

  const submit = useMutation({
    mutationFn: () => api.login(form.email, form.password),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      // A basket filled before signing in is claimed by the login response.
      await qc.invalidateQueries({ queryKey: ["cart"] });
      navigate("/");
    },
  });

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "64px 40px 120px" }}>
      <div
        data-cols
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}
      >
        <div>
          <p className="card-kicker" style={{ margin: "0 0 16px" }}>
            Content de vous revoir
          </p>
          <h1 style={{ fontSize: 52, maxWidth: "12ch", margin: "0 0 18px" }}>Connexion</h1>
          <p style={{ fontSize: 17, opacity: 0.75, maxWidth: "40ch" }}>
            Suivez vos commandes, enregistrez vos marchés préférés et commandez en quelques minutes
            auprès des boutiques près de chez vous.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
          className="card elev-sm"
          style={{ padding: 32, gap: 16 }}
        >
          <Field label="Email">
            {({ id }) => (
              <input
                id={id}
                className="input"
                required
                type="email"
                autoComplete="email"
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
                required
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            )}
          </Field>

          {submit.isError && (
            <p style={{ color: "var(--color-accent-700)", fontSize: 14, margin: 0 }}>
              {submit.error.message}
            </p>
          )}

          <button
            className="btn btn-primary btn-block"
            disabled={submit.isPending}
            style={{ padding: 14, fontSize: 15 }}
          >
            {submit.isPending ? "…" : "Se connecter"}
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => navigate("/inscription")}
          >
            Pas de compte ? Créer un compte
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-block"
            style={{ fontSize: 13 }}
            onClick={() => navigate("/mot-de-passe-oublie")}
          >
            Mot de passe oublié ?
          </button>
        </form>
      </div>
    </main>
  );
}
