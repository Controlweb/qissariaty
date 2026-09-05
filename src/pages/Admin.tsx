import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, money, type MarketInput } from "../lib/api";
import { ImageUpload } from "../components/ImageUpload";
import { Field } from "../components/Field";
import { ConfirmButton } from "../components/ConfirmButton";

type Tab = "apercu" | "moderation" | "utilisateurs" | "marches";
const TABS: { key: Tab; label: string }[] = [
  { key: "apercu", label: "Aperçu" },
  { key: "moderation", label: "Modération" },
  { key: "utilisateurs", label: "Utilisateurs" },
  { key: "marches", label: "Marchés" },
];

const tabStyle = (on: boolean): React.CSSProperties => ({
  textAlign: "left",
  border: 0,
  borderRadius: 999,
  padding: "9px 14px",
  fontSize: 14,
  background: on ? "var(--color-accent)" : "none",
  color: on ? "var(--color-bg)" : "var(--color-text)",
});

/** A proposal being turned into a real souk: name and city carry over, the pin
 *  does not exist yet, and the request is resolved once the market is created. */
export type MarketPrefill = { requestId: string; name: string; city: string };

export function Admin() {
  const [tab, setTab] = useState<Tab>("apercu");
  const [prefill, setPrefill] = useState<MarketPrefill | null>(null);

  return (
    <main
      // data-cols is what the mobile rule keys off; without it the 236px rail
      // stayed put on a phone and pushed the whole panel 290px off-screen.
      data-cols
      style={{
        display: "grid",
        gridTemplateColumns: "236px 1fr",
        // Fill what the sticky header leaves rather than assuming its height,
        // which is one row on desktop and two on a phone.
        flex: 1,
      }}
    >
      <aside style={{ padding: "26px 20px", boxShadow: "1px 0 0 var(--color-divider)" }}>
        <p className="card-kicker" style={{ margin: "0 0 4px" }}>
          Administration
        </p>
        <p style={{ fontFamily: "var(--font-heading)", fontSize: 18, margin: "0 0 20px" }}>
          Qissariaty
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(tab === t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </aside>

      <section style={{ padding: "32px 40px 90px" }}>
        {tab === "apercu" && <Kpis />}
        {tab === "moderation" && (
          <Moderation
            onBuildMarket={(p) => {
              setPrefill(p);
              setTab("marches");
            }}
          />
        )}
        {tab === "utilisateurs" && <Users />}
        {tab === "marches" && <Markets prefill={prefill} onPrefillUsed={() => setPrefill(null)} />}
      </section>
    </main>
  );
}

function Kpis() {
  const { data } = useQuery({ queryKey: ["admin", "kpis"], queryFn: api.adminKpis });
  const cards = [
    { label: "Utilisateurs", value: String(data?.users ?? 0) },
    { label: "Boutiques", value: String(data?.stores ?? 0) },
    { label: "Marchés", value: String(data?.markets ?? 0) },
    { label: "Commandes", value: String(data?.orders ?? 0) },
    { label: "Volume d'affaires", value: money(data?.gmvMinor ?? 0) },
  ];

  return (
    <>
      <h1 style={{ margin: "0 0 26px", fontSize: 34 }}>Aperçu</h1>
      <div data-cols="products" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18 }}>
        {cards.map((k) => (
          <div key={k.label} className="card" style={{ padding: "18px 20px", gap: 4 }}>
            <p className="card-kicker" style={{ margin: 0 }}>
              {k.label}
            </p>
            <p className="stat">{k.value}</p>
          </div>
        ))}
      </div>
    </>
  );
}

function Moderation({ onBuildMarket }: { onBuildMarket: (p: MarketPrefill) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin", "pending"], queryFn: api.adminPending });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin"] });
  };
  const approve = useMutation({ mutationFn: api.adminApprove, onSuccess: invalidate });
  const reject = useMutation({ mutationFn: api.adminReject, onSuccess: invalidate });

  return (
    <>
      <h1 style={{ margin: "0 0 22px", fontSize: 34 }}>Modération</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {data?.stores.map((s) => (
          <div
            key={s.id}
            className="card"
            style={{ flexDirection: "row", alignItems: "center", gap: 18, padding: "18px 22px" }}
          >
            <div style={{ flex: 1 }}>
              <p className="card-kicker" style={{ margin: 0 }}>
                {s.marketName}
              </p>
              <p className="card-title" style={{ margin: "2px 0 0" }}>
                {s.name}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.65 }}>
                {s.ownerName} · {s.ownerEmail}
              </p>
            </div>
            <button
              className="btn btn-primary"
              disabled={approve.isPending}
              onClick={() => approve.mutate(s.id)}
            >
              Approuver
            </button>
            <ConfirmButton
              label="Rejeter"
              disabled={reject.isPending}
              title={`Rejeter ${s.name} ?`}
              body="La boutique restera invisible aux clients et le commerçant devra refaire une demande. Cette action ne peut pas être annulée depuis cet écran."
              confirmLabel="Rejeter la boutique"
              onConfirm={() => reject.mutate(s.id)}
            />
          </div>
        ))}
      </div>
      {!data?.stores.length && (
        <p className="text-muted">Aucune boutique en attente de validation.</p>
      )}

      <MarketRequests onBuildMarket={onBuildMarket} />
    </>
  );
}

/** Souks proposed by merchants whose market was not in the list. */
function MarketRequests({ onBuildMarket }: { onBuildMarket: (p: MarketPrefill) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin", "market-requests"],
    queryFn: api.adminMarketRequests,
  });

  const resolve = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) =>
      api.adminResolveMarketRequest(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "market-requests"] }),
  });

  const pending = data?.requests.filter((r) => r.status === "PENDING") ?? [];

  return (
    <>
      <h2 style={{ margin: "40px 0 16px", fontSize: 24 }}>Marchés proposés</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {pending.map((r) => (
          <div
            key={r.id}
            className="card"
            style={{ flexDirection: "row", alignItems: "center", gap: 18, padding: "18px 22px" }}
          >
            <div style={{ flex: 1 }}>
              <p className="card-kicker" style={{ margin: 0 }}>
                {r.city}
              </p>
              <p className="card-title" style={{ margin: "2px 0 0" }}>
                {r.name}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.65 }}>
                Proposé par {r.requestedBy}
                {r.note ? ` · ${r.note}` : ""}
              </p>
            </div>
            <button
              className="btn btn-primary"
              // Approving used to flip a status flag and nothing else: no market
              // was ever created, so the merchant still had nowhere to attach a
              // shop. The proposal carries no coordinates, so it opens the
              // create form pre-filled and the admin drops the pin.
              onClick={() => onBuildMarket({ requestId: r.id, name: r.name, city: r.city })}
            >
              Créer le marché
            </button>
            <ConfirmButton
              label="Rejeter"
              disabled={resolve.isPending}
              title={`Rejeter la proposition « ${r.name} » ?`}
              body="Le commerçant ne sera pas notifié et sa proposition disparaîtra de cette liste."
              confirmLabel="Rejeter la proposition"
              onConfirm={() => resolve.mutate({ id: r.id, status: "REJECTED" })}
            />
          </div>
        ))}
      </div>
      {!pending.length && <p className="text-muted">Aucun marché proposé.</p>}
    </>
  );
}

function Users() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin", "users"], queryFn: api.adminUsers });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "SUSPENDED" }) =>
      api.adminSetUserStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  return (
    <>
      <h1 style={{ margin: "0 0 22px", fontSize: 34 }}>Utilisateurs</h1>
      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>Email</th>
            <th>Rôle</th>
            <th>Statut</th>
            <th>Inscrit</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {data?.users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td style={{ opacity: 0.7 }}>{u.email}</td>
              <td>
                <span className="tag tag-neutral">{u.role}</span>
              </td>
              <td>
                <span className={u.status === "ACTIVE" ? "tag tag-accent-2" : "tag tag-accent"}>
                  {u.status}
                </span>
              </td>
              <td style={{ opacity: 0.7 }}>
                {new Date(u.createdAt * 1000).toLocaleDateString("fr-MA")}
              </td>
              <td>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {u.status === "ACTIVE" ? (
                    <ConfirmButton
                      label="Suspendre"
                      style={{ fontSize: 12 }}
                      disabled={setStatus.isPending}
                      title={`Suspendre ${u.name} ?`}
                      body="La personne ne pourra plus se connecter. Vous pouvez réactiver le compte à tout moment depuis cette liste."
                      confirmLabel="Suspendre le compte"
                      onConfirm={() => setStatus.mutate({ id: u.id, status: "SUSPENDED" })}
                    />
                  ) : (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: u.id, status: "ACTIVE" })}
                    >
                      Activer
                    </button>
                  )}
                  <ResetLink userId={u.id} name={u.name} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

const MARKET_STATUS: Record<string, string> = { ACTIVE: "Visible", HIDDEN: "Masqué" };

/** A blank souk, centred on Casablanca so the pin starts somewhere plausible. */
const emptyMarket = () => ({
  name: "",
  nameAr: "",
  city: "",
  description: "",
  lat: "33.5731",
  lng: "-7.5898",
  status: "ACTIVE" as "ACTIVE" | "HIDDEN",
  coverKey: null as string | null,
});

type MarketDraft = ReturnType<typeof emptyMarket>;

/**
 * Issues a one-time password-reset link for a user and shows it once.
 *
 * There is no email binding on this Worker, so nothing can be sent
 * automatically — the admin copies the link and passes it on by phone or
 * WhatsApp. The token is shown here and never retrievable again.
 */
function ResetLink({ userId, name }: { userId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const issue = useMutation({ mutationFn: () => api.adminResetLink(userId), onSuccess: (r) => setUrl(r.url) });

  if (url) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", maxWidth: 320 }}>
        <input className="input" readOnly value={url} style={{ fontSize: 11 }} aria-label={`Lien de réinitialisation pour ${name}`} />
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 12, whiteSpace: "nowrap" }}
          onClick={() => {
            navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? "Copié" : "Copier"}
        </button>
      </span>
    );
  }

  return (
    <ConfirmButton
      label="Réinitialiser"
      style={{ fontSize: 12 }}
      disabled={issue.isPending}
      title={`Créer un lien de réinitialisation pour ${name} ?`}
      body="Le lien est valable 24 h et ne sert qu'une fois. Tout lien précédent est annulé. Aucun e-mail n'est envoyé : transmettez-le vous-même."
      confirmLabel="Créer le lien"
      onConfirm={() => issue.mutate()}
    />
  );
}

function Markets({
  prefill,
  onPrefillUsed,
}: {
  prefill: MarketPrefill | null;
  onPrefillUsed: () => void;
}) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ["admin", "markets"], queryFn: api.adminMarkets });
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const open = creating || !!prefill;

  // The public map, the home page and the seller wizard all read markets.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "markets"] });
    qc.invalidateQueries({ queryKey: ["markets"] });
  };

  return (
    <>
      <div
        data-row
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 22,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 34 }}>Marchés</h1>
        <button
          className="btn btn-primary"
          style={{ whiteSpace: "nowrap" }}
          onClick={() => {
            if (prefill) onPrefillUsed();
            setCreating(!open);
            setEditing(null);
          }}
        >
          {open ? "Annuler" : "Nouveau marché"}
        </button>
      </div>

      {open && (
        <>
          {prefill && (
            <p className="card-kicker" style={{ margin: "0 0 10px" }}>
              Proposé par un commerçant · placez le point sur la carte pour valider
            </p>
          )}
          <MarketForm
            key={prefill?.requestId ?? "new"}
            initial={{ ...emptyMarket(), name: prefill?.name ?? "", city: prefill?.city ?? "" }}
            submitLabel="Créer le marché"
            onSubmit={(input) => api.createMarket(input as Parameters<typeof api.createMarket>[0])}
            onDone={async () => {
              // The proposal is only resolved once the souk actually exists.
              if (prefill) {
                await api.adminResolveMarketRequest(prefill.requestId, "APPROVED").catch(() => {});
                onPrefillUsed();
              }
              setCreating(false);
              refresh();
              qc.invalidateQueries({ queryKey: ["admin", "market-requests"] });
            }}
          />
        </>
      )}

      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Marché</th>
            <th>Ville</th>
            <th>Boutiques</th>
            <th>Statut</th>
            <th>Couverture</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.markets.map((m) => (
            <tr key={m.id}>
              <td>
                <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {m.coverKey ? (
                    <img
                      src={`/api/media/${m.coverKey}`}
                      alt=""
                      style={{ width: 56, height: 36, objectFit: "cover", borderRadius: 8, flex: "none" }}
                    />
                  ) : (
                    <span
                      className="ph"
                      style={{ width: 56, height: 36, borderRadius: 8, flex: "none" }}
                    />
                  )}
                  <span>
                    {m.name}
                    {m.nameAr && (
                      // marginLeft, not marginInlineStart: the logical property
                      // resolves against this span's own rtl direction and puts
                      // the gap on the far side, butting the two names together.
                      <span style={{ opacity: 0.6, marginLeft: 8 }} dir="rtl">
                        {m.nameAr}
                      </span>
                    )}
                  </span>
                </span>
              </td>
              <td style={{ opacity: 0.7 }}>{m.city}</td>
              <td>{m.storeCount}</td>
              <td>
                <span className={m.status === "ACTIVE" ? "tag tag-accent-2" : "tag tag-neutral"}>
                  {MARKET_STATUS[m.status] ?? m.status}
                </span>
              </td>
              <td style={{ opacity: 0.7, fontSize: 12 }}>{m.coverKey ? "Oui" : "—"}</td>
              <td>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => {
                    setEditing(editing === m.id ? null : m.id);
                    setCreating(false);
                  }}
                >
                  {editing === m.id ? "Fermer" : "Modifier"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {isPending && <p className="text-muted" style={{ marginTop: 16 }}>Chargement des marchés…</p>}
      {data && !data.markets.length && (
        <p className="text-muted" style={{ marginTop: 16 }}>
          Aucun marché. Créez-en un pour que les commerçants puissent s'y rattacher.
        </p>
      )}

      {editing &&
        (() => {
          const m = data?.markets.find((x) => x.id === editing);
          if (!m) return null;
          return (
            <MarketForm
              // Remount when the row changes, so the draft never carries over.
              key={m.id}
              initial={{
                name: m.name,
                nameAr: m.nameAr ?? "",
                city: m.city,
                description: m.description ?? "",
                lat: String(m.lat),
                lng: String(m.lng),
                status: m.status,
                coverKey: m.coverKey ?? null,
              }}
              submitLabel="Enregistrer"
              onSubmit={(input) => api.updateMarket(m.id, input)}
              onDone={refresh}
            />
          );
        })()}
    </>
  );
}

/**
 * One form for both creating and editing a souk.
 *
 * The cover is held in the draft and written by the save button rather than on
 * upload: elsewhere in the app an image save fires the moment the file lands,
 * which makes ImageUpload's "Retirer" a one-click irreversible delete.
 */
function MarketForm({
  initial,
  submitLabel,
  onSubmit,
  onDone,
}: {
  initial: MarketDraft;
  submitLabel: string;
  onSubmit: (input: MarketInput) => Promise<unknown>;
  onDone: () => void;
}) {
  const [form, setForm] = useState<MarketDraft>(initial);
  const set = <K extends keyof MarketDraft>(k: K, v: MarketDraft[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const lat = Number(form.lat);
  const lng = Number(form.lng);
  const coordsValid =
    form.lat.trim() !== "" &&
    form.lng.trim() !== "" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;
  const ready = form.name.trim().length >= 2 && form.city.trim().length >= 2 && coordsValid;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: () =>
      onSubmit({
        name: form.name.trim(),
        nameAr: form.nameAr.trim() || null,
        city: form.city.trim(),
        description: form.description.trim() || null,
        lat,
        lng,
        status: form.status,
        coverKey: form.coverKey,
      }),
    onSuccess: onDone,
  });

  return (
    <form
      className="card"
      style={{ padding: 24, margin: "0 0 24px", gap: 16, maxWidth: 720 }}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div data-cols style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Field label="Nom du marché">
          {({ id }) => (
            <input
              id={id}
              className="input"
              value={form.name}
              placeholder="Souk Derb Ghallef"
              onChange={(e) => set("name", e.target.value)}
            />
          )}
        </Field>
        <Field label="Nom en arabe (facultatif)">
          {({ id }) => (
            <input
              id={id}
              className="input"
              dir="rtl"
              value={form.nameAr}
              placeholder="درب غلف"
              onChange={(e) => set("nameAr", e.target.value)}
            />
          )}
        </Field>
        <Field label="Ville">
          {({ id }) => (
            <input
              id={id}
              className="input"
              value={form.city}
              placeholder="Casablanca"
              onChange={(e) => set("city", e.target.value)}
            />
          )}
        </Field>
        <Field label="Statut" hint="Un marché masqué disparaît de la carte et de la recherche.">
          {() => (
            <div className="seg">
              {(["ACTIVE", "HIDDEN"] as const).map((s) => (
                <label key={s} className="seg-opt">
                  <input
                    type="radio"
                    name="market-status"
                    checked={form.status === s}
                    onChange={() => set("status", s)}
                  />
                  {MARKET_STATUS[s]}
                </label>
              ))}
            </div>
          )}
        </Field>
        <Field label="Latitude" hint="Copiez le point depuis Google Maps.">
          {({ id }) => (
            <input
              id={id}
              className="input"
              type="number"
              step="any"
              value={form.lat}
              onChange={(e) => set("lat", e.target.value)}
            />
          )}
        </Field>
        <Field label="Longitude">
          {({ id }) => (
            <input
              id={id}
              className="input"
              type="number"
              step="any"
              value={form.lng}
              onChange={(e) => set("lng", e.target.value)}
            />
          )}
        </Field>
        <Field label="Description" style={{ gridColumn: "1/-1" }}>
          {({ id }) => (
            <textarea
              id={id}
              className="input"
              style={{ borderRadius: 20 }}
              value={form.description}
              placeholder="Ce que l'on y trouve, les jours d'affluence, comment s'y rendre."
              onChange={(e) => set("description", e.target.value)}
            />
          )}
        </Field>
        <div style={{ gridColumn: "1/-1" }}>
          <ImageUpload
            prefix="markets"
            label="Photo de couverture"
            hint="Large : affichée en bannière. Optimisée sur votre appareil avant l'envoi, enregistrée quand vous validez."
            value={form.coverKey}
            onUploaded={(coverKey) => set("coverKey", coverKey)}
            // A 2400px-wide banner is the one place the default cap is too small.
            options={{ maxDimension: 2400, quality: 0.82 }}
          />
        </div>
      </div>

      {!coordsValid && (form.lat.trim() !== "" || form.lng.trim() !== "") && (
        <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>
          Coordonnées invalides — latitude entre −90 et 90, longitude entre −180 et 180.
        </p>
      )}
      {save.isError && (
        <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>
          {(save.error as Error).message}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn btn-primary" disabled={!ready || !dirty || save.isPending}>
          {save.isPending ? "…" : submitLabel}
        </button>
        {dirty && !save.isPending && (
          <span style={{ fontSize: 12, opacity: 0.65 }}>Modifications non enregistrées</span>
        )}
      </div>
    </form>
  );
}
