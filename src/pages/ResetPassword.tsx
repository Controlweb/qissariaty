import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Field } from "../components/Field";

/**
 * Redeems a one-time reset link.
 *
 * The token arrives in the URL because an admin issued the link and passed it
 * on by hand — this Worker has no email binding, so nothing self-service can
 * be delivered. Succeeding signs the person straight in.
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const submit = useMutation({
    mutationFn: () => api.resetPassword(token, password),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.invalidateQueries({ queryKey: ["cart"] });
      navigate("/compte");
    },
  });

  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= 8 && password === confirm;

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "64px 40px 120px" }}>
      <p className="card-kicker" style={{ margin: "0 0 14px" }}>
        Réinitialisation
      </p>
      <h1 style={{ margin: "0 0 12px" }}>Choisissez un nouveau mot de passe</h1>

      {!token ? (
        <p style={{ color: "var(--color-accent-700)", fontSize: 15 }}>
          Ce lien est incomplet. Demandez-en un nouveau à l’équipe Qissariaty.
        </p>
      ) : (
        <form
          className="card elev-sm"
          style={{ padding: 30, gap: 16, marginTop: 22 }}
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <Field label="Nouveau mot de passe" hint="8 caractères minimum.">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Field label="Confirmer le mot de passe">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>

          {mismatch && (
            <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>
              Les deux mots de passe ne correspondent pas.
            </p>
          )}
          {submit.isError && (
            <p style={{ color: "var(--color-accent-700)", fontSize: 14, margin: 0 }}>
              {submit.error.message}
            </p>
          )}

          <button
            className="btn btn-primary btn-block"
            style={{ padding: 14, fontSize: 15 }}
            disabled={!ready || submit.isPending}
          >
            {submit.isPending ? "…" : "Enregistrer et se connecter"}
          </button>
        </form>
      )}
    </main>
  );
}
