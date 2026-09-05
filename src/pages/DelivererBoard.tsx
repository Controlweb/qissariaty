import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, money } from "../lib/api";
import { ImageUpload } from "../components/ImageUpload";

/**
 * P0 scale: reports the courier's position for the active run, throttled to
 * 1 ping per 15s client-side (the DO also throttles broadcasts to 1/3s
 * server-side). No watch = no battery drain when nothing is active.
 */
function useLocationPing(deliveryId: string | undefined) {
  const lastRef = useRef(0);
  useEffect(() => {
    if (!deliveryId || !("geolocation" in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastRef.current < 15_000) return;
        lastRef.current = now;
        api.pingLocation(deliveryId, pos.coords.latitude, pos.coords.longitude).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 15_000, timeout: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [deliveryId]);
}

const STATUS_LABEL: Record<string, string> = {
  UNASSIGNED: "Disponible",
  ASSIGNED: "Acceptée",
  PICKED_UP: "Colis récupéré",
  DELIVERED: "Livrée",
  FAILED: "Échec",
};

/** A finished run is not a success — it must not wear the success pill. */
const statusTag = (status: string) =>
  status === "FAILED" ? "tag tag-neutral" : status === "DELIVERED" ? "tag tag-accent" : "tag tag-accent-2";

/** Straight-line km between pickup and drop-off — enough to judge a job by. */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

/** Hands the phone's own maps app the destination, rather than faking a map. */
const directionsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

/** Pickup or drop-off, with the one-tap actions a courier actually needs. */
function Leg({
  kind,
  title,
  lines,
  phone,
  lat,
  lng,
}: {
  kind: string;
  title: string;
  lines: (string | null)[];
  phone?: string | null;
  lat: number | null;
  lng: number | null;
}) {
  return (
    <div style={{ paddingTop: 12 }}>
      <p className="card-kicker" style={{ margin: 0 }}>
        {kind}
      </p>
      <p style={{ margin: "2px 0 0", fontSize: 15, fontFamily: "var(--font-heading)" }}>{title}</p>
      {lines.filter(Boolean).map((l) => (
        <p key={l} style={{ margin: "2px 0 0", fontSize: 13, opacity: 0.75 }}>
          {l}
        </p>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        {phone && (
          <a className="btn btn-secondary" style={{ fontSize: 13 }} href={`tel:${phone}`}>
            Appeler {phone}
          </a>
        )}
        {lat != null && lng != null && (
          <a
            className="btn btn-secondary"
            style={{ fontSize: 13 }}
            href={directionsUrl(lat, lng)}
            target="_blank"
            rel="noreferrer"
          >
            Itinéraire
          </a>
        )}
      </div>
    </div>
  );
}

export function DelivererBoard() {
  const qc = useQueryClient();
  // P1 scale: filter the shared job board by city so couriers don't all poll
  // the same global 50 runs.
  const [city, setCity] = useState("");

  const available = useQuery({
    queryKey: ["deliveries", "available", city || "all"],
    queryFn: () => api.availableDeliveries(city || undefined),
    // The job board is a competition — poll it rather than waiting for a reload.
    refetchInterval: 15_000,
  });
  const mine = useQuery({ queryKey: ["deliveries", "mine"], queryFn: api.myDeliveries });
  const activeId = mine.data?.deliveries.find((d) => d.status === "ASSIGNED" || d.status === "PICKED_UP")?.id;
  useLocationPing(activeId);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["deliveries"] });
  };
  const accept = useMutation({ mutationFn: api.acceptDelivery, onSuccess: refresh });
  const pickup = useMutation({ mutationFn: api.markPickedUp, onSuccess: refresh });
  // Which delivery is currently being closed out, and the proof photo for it.
  const [closing, setClosing] = useState<string | null>(null);
  const [proofKey, setProofKey] = useState<string | null>(null);

  const deliver = useMutation({
    mutationFn: ({ id, proof }: { id: string; proof: string | null }) =>
      api.markDelivered(id, proof),
    onSuccess: () => {
      setClosing(null);
      setProofKey(null);
      refresh();
    },
  });

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "44px 40px 96px" }}>
      <h1 style={{ margin: "0 0 26px", fontSize: 40 }}>Livraisons</h1>

      <div data-cols style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}>
        <section>
          <h3 style={{ margin: "0 0 14px" }}>Courses disponibles</h3>
          <input
            className="input"
            placeholder="Filtrer par ville…"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            style={{ marginBottom: 12, maxWidth: 280 }}
          />
          {accept.isError && (
            <p style={{ color: "var(--color-accent-700)", fontSize: 14 }}>{accept.error.message}</p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {available.data?.deliveries.map((d) => (
              <div
                key={d.id}
                className="card"
                data-row
                style={{ flexDirection: "row", alignItems: "center", gap: 16, padding: "18px 22px" }}
              >
                <div style={{ flex: 1 }}>
                  <p className="card-kicker" style={{ margin: 0 }}>
                    Retrait · {d.marketName}, {d.city}
                  </p>
                  <p className="card-title" style={{ margin: "2px 0 0", fontSize: 17 }}>
                    {d.storeName}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 13 }}>
                    Livraison à {d.dropCity ?? "adresse à confirmer"}
                    {d.dropLat != null && d.dropLng != null
                      ? ` · ${distanceKm(d.lat, d.lng, d.dropLat, d.dropLng).toFixed(1)} km`
                      : ""}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.65 }}>
                    {d.orderRef} · panier {money(d.totalMinor)}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p className="card-kicker" style={{ margin: 0 }}>
                    Votre rémunération
                  </p>
                  <p style={{ margin: "2px 0 10px", fontFamily: "var(--font-heading)", fontSize: 20 }}>
                    {money(d.feeMinor)}
                  </p>
                  <button
                    className="btn btn-primary"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate(d.id)}
                  >
                    Accepter
                  </button>
                </div>
              </div>
            ))}
          </div>

          {available.data && !available.data.deliveries.length && (
            <p className="text-muted">Aucune course pour le moment.</p>
          )}
        </section>

        <section>
          <h3 style={{ margin: "0 0 14px" }}>Mes courses</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mine.data?.deliveries.map((d) => (
              <div key={d.id} className="card" style={{ padding: "18px 22px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className={statusTag(d.status)}>{STATUS_LABEL[d.status] ?? d.status}</span>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>
                    {d.orderRef} · {money(d.feeMinor)} ·{" "}
                    {new Date(d.createdAt * 1000).toLocaleDateString("fr-MA")}
                  </span>
                </div>

                <Leg
                  kind="Retrait"
                  title={d.storeName}
                  lines={[d.marketName]}
                  phone={d.storePhone}
                  lat={d.lat}
                  lng={d.lng}
                />
                <Leg
                  kind="Livraison"
                  title={d.customerName}
                  lines={[
                    d.dropLine1,
                    d.dropCity,
                    d.dropNotes && `Consigne : ${d.dropNotes}`,
                  ]}
                  phone={d.customerPhone}
                  lat={d.dropLat}
                  lng={d.dropLng}
                />

                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  {d.status === "ASSIGNED" && (
                    <button
                      className="btn btn-secondary"
                      disabled={pickup.isPending}
                      onClick={() => pickup.mutate(d.id)}
                    >
                      Colis récupéré
                    </button>
                  )}
                  {d.status === "PICKED_UP" && closing !== d.id && (
                    <button className="btn btn-primary" onClick={() => setClosing(d.id)}>
                      Marquer comme livrée
                    </button>
                  )}
                </div>

                {closing === d.id && (
                  <div style={{ marginTop: 12 }}>
                    <ImageUpload
                      prefix="delivery-proofs"
                      label="Preuve de livraison (facultative)"
                      hint="Photo du colis remis. Optimisée sur votre téléphone avant l'envoi."
                      value={proofKey}
                      onUploaded={setProofKey}
                      // A proof shot is evidence, not artwork: a smaller cap
                      // keeps it quick to upload on mobile data.
                      options={{ maxDimension: 1280, quality: 0.75 }}
                    />
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <button
                        className="btn btn-primary"
                        disabled={deliver.isPending}
                        onClick={() => deliver.mutate({ id: d.id, proof: proofKey })}
                      >
                        Confirmer la livraison
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          setClosing(null);
                          setProofKey(null);
                        }}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}

                {d.status === "DELIVERED" && d.proofKey && (
                  <img
                    src={`/api/media/${d.proofKey}`}
                    alt="Preuve de livraison"
                    className="washed"
                    style={{
                      marginTop: 10,
                      width: "100%",
                      maxHeight: 160,
                      objectFit: "cover",
                      borderRadius: "var(--radius-md)",
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {mine.data && !mine.data.deliveries.length && (
            <p className="text-muted">Vous n'avez accepté aucune course.</p>
          )}
        </section>
      </div>
    </main>
  );
}
