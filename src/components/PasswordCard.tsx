import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Field } from "./Field";
import { useSession } from "../App";

/**
 * Set or change your own password.
 *
 * An account created at checkout has no password hash at all — the order
 * confirmation tells those customers to "set a password from your account",
 * and until now there was nowhere in the app to do it, which left the account
 * permanently unsignintoable. `hasPassword` comes from the session so the
 * current-password field is only demanded from people who have one.
 */
export function PasswordCard() {
  const { data } = useSession();
  const user = data?.user;
  const hasPassword = user?.hasPassword ?? true;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const save = useMutation({
    mutationFn: () => api.setPassword(next, hasPassword ? current : undefined),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });

  if (!user) return null;

  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = next.length >= 8 && next === confirm && (!hasPassword || current.length > 0);

  return (
    <form
      className="card"
      style={{ gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="card-kicker" style={{ margin: 0 }}>
        {hasPassword ? "Mot de passe" : "Définir un mot de passe"}
      </p>
      {!hasPassword && (
        <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
          Votre compte a été créé lors d’une commande. Choisissez un mot de passe pour pouvoir vous
          reconnecter.
        </p>
      )}

      {hasPassword && (
        <Field label="Mot de passe actuel">
          {({ id }) => (
            <input
              id={id}
              className="input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
      )}

      <Field label="Nouveau mot de passe" hint="8 caractères minimum.">
        {({ id }) => (
          <input
            id={id}
            className="input"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
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
      {save.isError && (
        <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>
          {save.error.message}
        </p>
      )}
      {save.isSuccess && (
        <p style={{ color: "var(--color-accent-2-700)", fontSize: 13, margin: 0 }}>
          Mot de passe enregistré.
        </p>
      )}

      <button className="btn btn-secondary btn-block" disabled={!ready || save.isPending}>
        {save.isPending ? "…" : hasPassword ? "Changer le mot de passe" : "Définir le mot de passe"}
      </button>
    </form>
  );
}
