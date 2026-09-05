import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type SessionUser } from "../lib/api";
import { useUi } from "../store/ui";
import { useSession } from "../App";
import { useIsMobile } from "./TabBar";

/**
 * Sticky header, ported from the design file's <header> block. Inline styles
 * are kept as-authored so the React build and the canvas artboard stay in step;
 * anything reusable lives in organic.css as a class.
 */
export function Header() {
  const navigate = useNavigate();
  const { filters, setFilter, toggleCart } = useUi();
  const [query, setQuery] = useState(filters.q);

  // Fails with 401 when signed out, which is fine — the badge just shows 0.
  const isMobile = useIsMobile();
  const session = useSession();
  const user = session.data?.user;
  const cart = useQuery({ queryKey: ["cart"], queryFn: api.cart, retry: false });
  const cartCount = cart.data?.lines.reduce((n, l) => n + l.qty, 0) ?? 0;

  // Wipe the cache, not just the session: a stale `me`/`cart`/`orders` entry
  // would hand the next person on a shared phone the last one's data.
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      qc.clear();
      navigate("/");
    },
  });

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFilter("q", query);
    navigate(`/recherche?q=${encodeURIComponent(query)}`);
  };

  // Rendered in two places — row 1 on a phone, inline on desktop — so every
  // role can sign out from every screen. Defined once so the two cannot drift.
  const signOut = user && (
    <button
      className="btn btn-secondary"
      disabled={logout.isPending}
      onClick={() => logout.mutate()}
      style={{ whiteSpace: "nowrap", flex: "none", ...(isMobile ? { fontSize: 12, padding: "6px 14px" } : {}) }}
    >
      Déconnexion
    </button>
  );

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 600,
        background: "var(--color-bg)",
        boxShadow: "0 1px 0 var(--color-divider)",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          flexWrap: isMobile ? "wrap" : "nowrap",
          gap: isMobile ? 10 : 28,
          padding: isMobile ? "10px 20px" : "14px 40px",
        }}
      >
        <button
          onClick={() => navigate("/")}
          style={{
            background: "none",
            border: 0,
            padding: 0,
            fontFamily: "var(--font-heading)",
            fontSize: isMobile ? 20 : 21,
            color: "var(--color-accent-700)",
            // Pushes the cart to the far edge on the phone's first row.
            marginRight: isMobile ? "auto" : undefined,
          }}
        >
          Qissariaty
        </button>

        <nav style={{ display: isMobile ? "none" : "flex", gap: 20, alignItems: "center" }}>
          <button className="qi-link" onClick={() => navigate("/carte")}>
            Carte
          </button>
          <button className="qi-link" onClick={() => navigate("/recherche")}>
            Marchés
          </button>
          <button className="qi-link" onClick={() => navigate("/recherche?type=boutiques")}>
            Boutiques
          </button>
          <button className="qi-link" onClick={() => navigate("/recherche?type=categories")}>
            Catégories
          </button>
        </nav>

        <form
          onSubmit={onSearchSubmit}
          style={
            isMobile
              ? { order: 3, flex: "1 0 100%", minWidth: 0 }
              : // The search is the only elastic item in a row of fixed-width
                // buttons, so it is what yields when a role carries extra ones.
                { flex: "1 1 240px", minWidth: 180, maxWidth: 420, marginLeft: "auto" }
          }
        >
          <input
            className="input"
            placeholder="Rechercher un marché, une boutique, un produit"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>

        <button
          className="btn btn-secondary"
          onClick={() => {
            toggleCart(true);
            navigate("/panier");
          }}
          style={{
            gap: 8,
            whiteSpace: "nowrap",
            flex: "none",
            ...(isMobile ? { fontSize: 12, padding: "6px 14px" } : {}),
          }}
        >
          {isMobile ? `Panier ${cartCount}` : `Panier · ${cartCount}`}
        </button>
        {isMobile && signOut}
        {/* Named for the workspace, not the role. "Admin" sat next to an account
            button showing the first name of a user called Admin — two identical
            pills going to two different places. A destination-shaped label
            cannot collide with somebody's name. */}
        {!isMobile && user?.role === "DELIVERER" && (
          <button
            className="btn btn-secondary"
            onClick={() => navigate("/livraisons")}
            style={{ whiteSpace: "nowrap", flex: "none" }}
          >
            Mes livraisons
          </button>
        )}
        {!isMobile && user?.role === "ADMIN" && (
          <button
            className="btn btn-secondary"
            onClick={() => navigate("/admin")}
            style={{ whiteSpace: "nowrap", flex: "none" }}
          >
            Espace admin
          </button>
        )}
        {!isMobile && (
          <>
            <button
              className="btn btn-secondary"
              onClick={() => navigate(user ? "/compte" : "/connexion")}
              aria-label={user ? `Mon compte — ${user.name}` : "Connexion"}
              style={{ whiteSpace: "nowrap", flex: "none", gap: 8, paddingLeft: user ? 6 : undefined }}
            >
              {user && <Avatar user={user} />}
              {user ? user.name.split(" ")[0] : "Connexion"}
            </button>
            {signOut}
            {/* "Vendre sur Qissariaty" is an acquisition CTA — it belongs in
                front of people who could become merchants, not an admin or a
                courier, who already carry a workspace button and pushed the row
                past 1440px. Both still reach it from /compte. A merchant keeps
                the slot, where it is a destination rather than a pitch. */}
            {(!user || user.role === "CUSTOMER" || user.role === "STORE_OWNER") && (
              <button
                className="btn btn-primary"
                onClick={() =>
                  navigate(user?.role === "STORE_OWNER" ? "/vendeur" : "/inscription?role=STORE_OWNER")
                }
                style={{ whiteSpace: "nowrap", flex: "none" }}
              >
                {user?.role === "STORE_OWNER" ? "Ma boutique" : "Vendre sur Qissariaty"}
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
}

/**
 * The signed-in user's face, or their initial. Gives the account button the one
 * shape nothing else in the header has, so it reads as "you" rather than as a
 * fourth navigation pill — and it is the only place the uploaded avatar is
 * actually shown back to the person who uploaded it.
 */
function Avatar({ user }: { user: SessionUser }) {
  const size = 24;
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 999,
    flex: "none",
    objectFit: "cover",
  };
  if (user.avatarKey) {
    return <img src={`/api/media/${user.avatarKey}`} alt="" style={base} />;
  }
  return (
    <span
      style={{
        ...base,
        display: "grid",
        placeItems: "center",
        background: "var(--color-accent-700)",
        color: "var(--color-bg)",
        fontSize: 12,
        lineHeight: 1,
      }}
    >
      {user.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * The design ships photography as hatched slots that carry their intended
 * dimensions. Rendering a real R2 image in the same box changes no layout.
 */
export function Ph({
  label,
  height,
  src,
  style,
}: {
  label: string;
  height: number | string;
  src?: string | null;
  style?: React.CSSProperties;
}) {
  if (src) {
    return (
      <img
        className="washed"
        src={src}
        alt=""
        style={{ height, width: "100%", objectFit: "cover", ...style }}
      />
    );
  }
  return (
    <div className="ph" style={{ height, ...style }}>
      {label}
    </div>
  );
}
