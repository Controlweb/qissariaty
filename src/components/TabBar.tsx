import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useSession } from "../App";

/** Single source of truth for the mobile breakpoint, shared by JS and CSS. */
export const MOBILE_QUERY = "(max-width: 900px)";

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", on);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isMobile;
}

/**
 * The mobile artboard's bottom tab bar. Its five destinations change with the
 * signed-in role — a deliverer has no use for a seller tab, and vice versa.
 */
export function TabBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data } = useSession();
  const role = data?.user?.role;

  // Works signed out too now that carts are guest-capable.
  const cart = useQuery({ queryKey: ["cart"], queryFn: api.cart, retry: false });
  const cartCount = cart.data?.lines.reduce((n, l) => n + l.qty, 0) ?? 0;

  const tabs = [
    { to: "/", label: "Accueil" },
    { to: "/carte", label: "Carte" },
    { to: "/recherche", label: "Chercher" },
    { to: "/panier", label: cartCount ? `Panier ${cartCount}` : "Panier" },
    role === "DELIVERER"
      ? { to: "/livraisons", label: "Courses" }
      : role === "ADMIN"
        ? { to: "/admin", label: "Admin" }
        : role === "STORE_OWNER"
          ? { to: "/vendeur", label: "Boutique" }
          : { to: "/compte", label: "Compte" },
  ];

  return (
    <nav
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 700,
        display: "flex",
        padding: "4px 6px 10px",
        background: "var(--color-bg)",
        boxShadow: "0 -1px 0 var(--color-divider)",
      }}
    >
      {tabs.map((t) => {
        // "/" would otherwise prefix-match every route.
        const active = t.to === "/" ? pathname === "/" : pathname.startsWith(t.to);
        return (
          <button
            key={t.to}
            className="tabbtn"
            onClick={() => navigate(t.to)}
            style={{ color: active ? "var(--color-accent-700)" : "var(--color-text)" }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: active ? "var(--color-accent)" : "transparent",
              }}
            />
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
