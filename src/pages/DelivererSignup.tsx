import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useSession } from "../App";
import { Field } from "../components/Field";

const STEPS = ["Compte", "Véhicule", "Zones", "Candidature"];
const VEHICLES = ["À pied", "Vélo", "Scooter", "Moto", "Voiture"] as const;
const ZONES = [
  "Casablanca centre",
  "Habous",
  "Maârif",
  "Derb Omar",
  "Ain Diab",
  "Sidi Bernoussi",
];

const stepStyle = (i: number, current: number): React.CSSProperties =>
  i === current
    ? { background: "var(--color-accent)", color: "var(--color-bg)", flex: "none" }
    : i < current
      ? {
          background: "var(--color-accent-2-100)",
          color: "var(--color-accent-2-800)",
          flex: "none",
        }
      : { border: "1px solid var(--color-divider)", opacity: 0.7, flex: "none" };

const chip = (on: boolean): React.CSSProperties =>
  on
    ? { background: "var(--color-accent)", color: "var(--color-bg)", fontSize: 13, flex: "none" }
    : { border: "1px solid var(--color-divider)", fontSize: 13, flex: "none" };

/**
 * Deliverer onboarding, four steps, ported from `isDelivSignup`.
 *
 * Same shape as the merchant wizard: public, registers at step 1, and files the
 * application at the end. The account is left PENDING — a deliverer must be
 * vetted before any job board is visible to them.
 */
export function DelivererSignup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const signedIn = !!session?.user;

  const [step, setStep] = useState(signedIn ? 1 : 0);
  const [account, setAccount] = useState({ name: "", phone: "", email: "", password: "" });
  const [vehicle, setVehicle] = useState<(typeof VEHICLES)[number]>("Scooter");
  const [doc, setDoc] = useState({ plate: "", idNumber: "" });
  const [zone, setZone] = useState({ city: "Casablanca", zones: [] as string[], availability: "" });

  const register = useMutation({
    mutationFn: () =>
      api.register({
        name: account.name,
        email: account.email,
        password: account.password,
        phone: account.phone || undefined,
        // Registered as a customer, promoted on submission — an abandoned
        // wizard must not leave a PENDING deliverer who can never sign in.
        role: "CUSTOMER",
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      setStep(1);
    },
  });

  const apply = useMutation({
    mutationFn: () =>
      api.applyAsDeliverer({
        vehicle,
        plate: doc.plate || undefined,
        idNumber: doc.idNumber || undefined,
        city: zone.city,
        zones: zone.zones,
        availability: zone.availability || undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      setStep(3);
    },
  });

  const onFoot = vehicle === "À pied" || vehicle === "Vélo";

  const canNext =
    step === 0
      ? account.name.length >= 2 && !!account.email && account.password.length >= 8
      : step === 1
        ? onFoot || doc.plate.trim().length > 0
        : step === 2
          ? zone.zones.length > 0 && zone.city.trim().length >= 2
          : false;

  const next = () => {
    if (step === 0) return register.mutate();
    if (step === 2) return apply.mutate();
    setStep(step + 1);
  };

  const nextLabel =
    step === 0 ? "Créer mon compte" : step === 2 ? "Envoyer ma candidature" : "Continuer";
  const busy = register.isPending || apply.isPending;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "52px 40px 120px" }}>
      <p className="card-kicker" style={{ margin: "0 0 14px" }}>
        Devenir livreur
      </p>
      <h1 style={{ margin: "0 0 12px", maxWidth: "18ch" }}>Livrez dans votre quartier.</h1>
      <p style={{ fontSize: 16, opacity: 0.75, maxWidth: "48ch", margin: "0 0 30px" }}>
        Choisissez vos horaires et vos zones. Paiement par course, versé chaque semaine.
      </p>

      <div className="hscroll" style={{ marginBottom: 26 }}>
        {STEPS.map((label, i) => (
          <span key={label} className="tag" style={stepStyle(i, step)}>
            {label}
          </span>
        ))}
      </div>

      <div className="card" style={{ padding: 28, maxWidth: 640 }}>
        {step === 0 && (
          <>
            <h3 style={{ margin: "0 0 18px" }}>Votre compte</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Nom complet">
          {({ id }) => (
            <input
            id={id}
            className="input"
            placeholder="Yassine Ouazzani"
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
            placeholder="yassine@example.com"
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
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div
                  className="ph"
                  style={{ width: 72, height: 72, borderRadius: 999, flex: "none" }}
                >
                  photo
                </div>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.68 }}>
                  Photo de profil visible par le client pendant la livraison.
                </p>
              </div>
            </div>
            {register.isError && <Err>{register.error.message}</Err>}
          </>
        )}

        {step === 1 && (
          <>
            <p className="card-kicker" style={{ margin: "0 0 8px" }}>
              Véhicule
            </p>
            <div className="hscroll" style={{ marginBottom: 14 }}>
              {VEHICLES.map((v) => (
                <button key={v} className="btn" style={chip(vehicle === v)} onClick={() => setVehicle(v)}>
                  {v}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Immatriculation" hint={onFoot ? "Non requise pour ce véhicule" : undefined}>
          {({ id }) => (
            <input
            id={id}
            className="input"
            placeholder="12345-A-6"
            disabled={onFoot}
            value={doc.plate}
            onChange={(e) => setDoc({ ...doc, plate: e.target.value })}
            />
          )}
        </Field>
              <Field label="Permis / pièce d'identité">
          {({ id }) => (
            <input
            id={id}
            className="input"
            placeholder="Numéro de pièce"
            value={doc.idNumber}
            onChange={(e) => setDoc({ ...doc, idNumber: e.target.value })}
            />
          )}
        </Field>
              <div className="ph" style={{ height: 110, borderRadius: 22 }}>
                photo du document · recto
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <Field label="Ville" style={{ marginBottom: 14 }}>
          {({ id }) => (
            <input
            id={id}
            className="input"
            value={zone.city}
            onChange={(e) => setZone({ ...zone, city: e.target.value })}
            />
          )}
        </Field>
            <p className="card-kicker" style={{ margin: "0 0 8px" }}>
              Zones préférées
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {ZONES.map((z) => (
                <button
                  key={z}
                  className="btn"
                  style={chip(zone.zones.includes(z))}
                  onClick={() =>
                    setZone({
                      ...zone,
                      zones: zone.zones.includes(z)
                        ? zone.zones.filter((x) => x !== z)
                        : [...zone.zones, z],
                    })
                  }
                >
                  {z}
                </button>
              ))}
            </div>
            <Field label="Disponibilités">
          {({ id }) => (
            <input
            id={id}
            className="input"
            placeholder="Lun–Sam, 09:00 – 19:00"
            value={zone.availability}
            onChange={(e) => setZone({ ...zone, availability: e.target.value })}
            />
          )}
        </Field>
            {apply.isError && <Err>{apply.error.message}</Err>}
          </>
        )}

        {step === 3 && (
          <>
            <span className="tag tag-accent" style={{ alignSelf: "flex-start" }}>
              Statut · en attente de validation
            </span>
            <h3 style={{ margin: "14px 0 8px" }}>Candidature envoyée</h3>
            <p style={{ fontSize: 14, opacity: 0.78, margin: "0 0 16px" }}>
              Un administrateur vérifie votre pièce d'identité et votre véhicule. Vous ne recevrez
              de courses qu'après validation.
            </p>
            <button
              className="btn btn-primary"
              style={{ alignSelf: "flex-start" }}
              onClick={() => navigate("/")}
            >
              Retour à l'accueil
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
              style={{ flex: 1, padding: "12px 26px" }}
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
