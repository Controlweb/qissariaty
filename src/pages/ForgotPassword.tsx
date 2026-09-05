import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Field } from "../components/Field";

/**
 * Self-service password recovery.
 *
 * The success copy is deliberately non-committal about whether the address is
 * on file — the endpoint answers identically either way, and saying "no such
 * account" here would hand anyone a way to enumerate customers.
 */
export function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");

  const submit = useMutation({ mutationFn: () => api.forgotPassword(email) });
  const sent = submit.isSuccess;

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "64px 40px 120px" }}>
      <p className="card-kicker" style={{ margin: "0 0 14px" }}>
        Mot de passe oublié
      </p>
      <h1 style={{ margin: "0 0 12px" }}>Recevez un lien de réinitialisation</h1>

      {sent ? (
        <div className="card elev-sm" style={{ padding: 30, gap: 12, marginTop: 22, alignItems: "flex-start" }}>
          {submit.data?.delivered ? (
            <>
              <p className="card-title" style={{ margin: 0 }}>
                Vérifiez votre boîte mail
              </p>
              <p style={{ fontSize: 14, opacity: 0.75, margin: 0 }}>
                Si un compte existe pour <strong>{email}</strong>, un lien de réinitialisation vient
                d’être envoyé. Il est valable 24 heures et ne fonctionne qu’une fois. Pensez à
                regarder dans les indésirables.
              </p>
              {/* The response cannot say whether the message actually left —
                  doing so would reveal whether the account exists — so always
                  offer the human route as well. */}
              <p style={{ fontSize: 13, opacity: 0.65, margin: 0 }}>
                Rien reçu d’ici quelques minutes ? Écrivez à{" "}
                <a href="mailto:contact@qissariaty.ma">contact@qissariaty.ma</a> et nous vous
                transmettrons un lien directement.
              </p>
            </>
          ) : (
            <>
              <p className="card-title" style={{ margin: 0 }}>
                Envoi indisponible pour le moment
              </p>
              <p style={{ fontSize: 14, opacity: 0.75, margin: 0 }}>
                L’envoi automatique n’est pas encore actif. Écrivez à{" "}
                <a href="mailto:contact@qissariaty.ma">contact@qissariaty.ma</a> et nous vous
                transmettrons un lien de réinitialisation.
              </p>
            </>
          )}
          <button className="btn btn-secondary" onClick={() => navigate("/connexion")}>
            Retour à la connexion
          </button>
        </div>
      ) : (
        <form
          className="card elev-sm"
          style={{ padding: 30, gap: 16, marginTop: 22 }}
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <p style={{ fontSize: 14, opacity: 0.75, margin: 0 }}>
            Indiquez l’adresse de votre compte. Nous vous enverrons un lien pour choisir un nouveau
            mot de passe.
          </p>

          <Field label="E-mail">
            {({ id }) => (
              <input
                id={id}
                className="input"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
            style={{ padding: 14, fontSize: 15 }}
            disabled={!email.includes("@") || submit.isPending}
          >
            {submit.isPending ? "…" : "Envoyer le lien"}
          </button>
        </form>
      )}
    </main>
  );
}
