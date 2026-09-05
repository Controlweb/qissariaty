import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useSession } from "../App";

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/**
 * Review list and composer for a store or a product. The API only accepts a
 * review from someone whose order was delivered, so the composer is offered to
 * everyone signed in and the server's 403 is surfaced as plain guidance rather
 * than hidden behind a pre-check the client cannot do reliably.
 */
export function Reviews({ storeId, productId }: { storeId?: string; productId?: string }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");

  const key = storeId ? ["store", storeId, "reviews"] : ["product", productId, "reviews"];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => (storeId ? api.storeReviews(storeId) : api.productReviews(productId!)),
  });

  const post = useMutation({
    mutationFn: () => api.postReview({ rating, body: body || undefined, storeId, productId }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <section style={{ marginTop: 44 }}>
      <div
        style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}
      >
        <h3 style={{ margin: 0 }}>Avis clients</h3>
        {!!data?.count && (
          <span style={{ fontSize: 14, opacity: 0.7 }}>
            {data.average.toFixed(1)} / 5 · {data.count} avis
          </span>
        )}
      </div>

      {session?.user && (
        <form
          className="card"
          style={{ padding: 20, marginBottom: 18, gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            post.mutate();
          }}
        >
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`${n} étoile${n > 1 ? "s" : ""}`}
                style={{
                  border: 0,
                  background: "none",
                  padding: 0,
                  fontSize: 22,
                  lineHeight: 1,
                  color: n <= rating ? "var(--color-accent)" : "var(--color-neutral-400)",
                }}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            className="input"
            style={{ borderRadius: 20 }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Votre expérience avec cette boutique…"
          />
          {post.isError && (
            <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>
              {post.error.message === "only delivered orders can be reviewed"
                ? "Vous ne pouvez laisser un avis qu'après avoir reçu une commande."
                : post.error.message === "already reviewed"
                  ? "Vous avez déjà laissé un avis ici."
                  : post.error.message}
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={post.isPending}
            style={{ alignSelf: "flex-start" }}
          >
            Publier mon avis
          </button>
        </form>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {data?.reviews.map((r) => (
          <div key={r.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="card-title" style={{ fontSize: 15 }}>
                {r.author}
              </span>
              <span className="tag tag-accent-2">{stars(r.rating)}</span>
            </div>
            {r.body && <p style={{ fontSize: 14, opacity: 0.8, margin: 0 }}>{r.body}</p>}
            <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>
              {new Date(r.createdAt * 1000).toLocaleDateString("fr-MA")}
            </p>
          </div>
        ))}
      </div>

      {data && !data.reviews.length && (
        <p className="text-muted" style={{ fontSize: 14 }}>
          Aucun avis pour le moment.
        </p>
      )}
    </section>
  );
}
