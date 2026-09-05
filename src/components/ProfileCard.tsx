import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ImageUpload } from "./ImageUpload";
import { Field } from "./Field";
import { useSession } from "../App";

/**
 * Name, phone and profile picture. The avatar is the one image every role
 * uploads, so `avatars` is the only media prefix open to plain customers.
 */
export function ProfileCard() {
  const qc = useQueryClient();
  const { data } = useSession();
  const user = data?.user;

  // Both hydrated from the session: phone was hard-coded to "" and so the
  // saved number was invisible to its owner forever.
  const [form, setForm] = useState({ name: user?.name ?? "", phone: user?.phone ?? "" });
  const [dirty, setDirty] = useState(false);

  const save = useMutation({
    mutationFn: (input: { name?: string; phone?: string; avatarKey?: string | null }) =>
      api.updateProfile(input),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  if (!user) return null;

  return (
    <div className="card" style={{ gap: 14 }}>
      <p className="card-kicker" style={{ margin: 0 }}>
        Mon profil
      </p>

      <ImageUpload
        prefix="avatars"
        label="Photo de profil"
        hint="Carrée de préférence. Optimisée sur votre appareil avant l'envoi."
        value={user.avatarKey ?? null}
        // Saved immediately: an avatar has nothing else to submit alongside it.
        onUploaded={(avatarKey) => save.mutate({ avatarKey })}
        options={{ maxDimension: 512, quality: 0.85 }}
      />

      <Field label="Nom complet">
        {({ id }) => (
          <input
            id={id}
            className="input"
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.target.value });
              setDirty(true);
            }}
          />
        )}
      </Field>

      <Field label="Téléphone">
        {({ id }) => (
          <input
            id={id}
            className="input"
            value={form.phone}
            placeholder="+212 6.."
            onChange={(e) => {
              setForm({ ...form, phone: e.target.value });
              setDirty(true);
            }}
          />
        )}
      </Field>

      {save.isError && (
        <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>
          {save.error.message}
        </p>
      )}
      {save.isSuccess && !dirty && (
        <p style={{ color: "var(--color-accent-2-700)", fontSize: 13, margin: 0 }}>Enregistré.</p>
      )}

      <button
        className="btn btn-secondary btn-block"
        disabled={!dirty || save.isPending}
        onClick={() =>
          save.mutate({ name: form.name, phone: form.phone || undefined })
        }
      >
        Enregistrer
      </button>
    </div>
  );
}
