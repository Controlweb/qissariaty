import { Suspense, lazy } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type SessionUser } from "./lib/api";
import { Header } from "./components/Header";
import { TabBar, useIsMobile } from "./components/TabBar";
import { Home } from "./pages/Home";
import { MarketDetail } from "./pages/MarketDetail";
import { StoreDetail } from "./pages/StoreDetail";
import { Cart } from "./pages/Cart";
import { Checkout } from "./pages/Checkout";
import { Orders } from "./pages/Orders";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { ResetPassword } from "./pages/ResetPassword";
import { ForgotPassword } from "./pages/ForgotPassword";
import { Search } from "./pages/Search";
import { ProductDetail } from "./pages/ProductDetail";

// P2 scale: Leaflet + dashboards are heavy and rarely visited on first load.
// Split them so the core funnel (home/cart/checkout) stays lean.
const MapSplit = lazy(() => import("./pages/MapSplit").then((m) => ({ default: m.MapSplit })));
const Admin = lazy(() => import("./pages/Admin").then((m) => ({ default: m.Admin })));
const StoreDashboard = lazy(() =>
  import("./pages/StoreDashboard").then((m) => ({ default: m.StoreDashboard })),
);
const DelivererBoard = lazy(() =>
  import("./pages/DelivererBoard").then((m) => ({ default: m.DelivererBoard })),
);

export function useSession() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });
}

/** Route guard. Renders nothing until the session is known, so the login page never flashes. */
function Requires({ role, children }: { role?: SessionUser["role"][]; children: React.ReactNode }) {
  const { data, isPending } = useSession();
  if (isPending) return null;
  if (!data?.user) return <Navigate to="/connexion" replace />;
  if (role && !role.includes(data.user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  // The split map fills the viewport under a 66px header and scrolls its own
  // panel, so it must not sit inside the page's normal scroll container.
  const path = useLocation().pathname;
  const isMap = path === "/carte";
  const isMobile = useIsMobile();

  return (
    // Column flex so a full-height page (the map) can claim the space left by
    // the sticky header without hard-coding its height — which changes between
    // desktop (one row) and mobile (two).
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: isMap && !isMobile ? "hidden" : undefined,
      }}
    >
      <Header />
      <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/carte" element={<MapSplit />} />
        <Route path="/marches/:id" element={<MarketDetail />} />
        <Route path="/boutiques/:id" element={<StoreDetail />} />
        <Route path="/connexion" element={<Login />} />
        {/* One entry point; the role chosen here decides which flow renders. */}
        <Route path="/inscription" element={<Signup />} />
        <Route path="/mot-de-passe-oublie" element={<ForgotPassword />} />
        <Route path="/reinitialiser" element={<ResetPassword />} />
        <Route path="/recherche" element={<Search />} />
        <Route path="/produits/:id" element={<ProductDetail />} />
        <Route path="/devenir-livreur" element={<Navigate to="/inscription?role=DELIVERER" replace />} />
        <Route path="/devenir-vendeur" element={<Navigate to="/inscription?role=STORE_OWNER" replace />} />
        <Route
          path="/admin"
          element={
            <Requires role={["ADMIN"]}>
              <Admin />
            </Requires>
          }
        />
        {/* Cart and checkout are open: an account is created at the end of a
            first purchase, not demanded before one. */}
        <Route path="/panier" element={<Cart />} />
        <Route path="/commande" element={<Checkout />} />
        <Route
          path="/compte"
          element={
            <Requires>
              <Orders />
            </Requires>
          }
        />
        <Route
          path="/vendeur"
          element={
            <Requires role={["STORE_OWNER", "ADMIN"]}>
              <StoreDashboard />
            </Requires>
          }
        />
        <Route
          path="/livraisons"
          element={
            <Requires role={["DELIVERER", "ADMIN"]}>
              <DelivererBoard />
            </Requires>
          }
        />
        <Route
          path="*"
          element={
            <main style={{ maxWidth: 1280, margin: "0 auto", padding: "72px 40px" }}>
              <h1>Page introuvable</h1>
              <p className="text-muted">Cette page n'existe pas ou a été déplacée.</p>
              <p style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <a className="btn btn-primary" href="/">
                  Retour à l'accueil
                </a>
                <a className="btn btn-secondary" href="/carte">
                  Explorer la carte
                </a>
              </p>
            </main>
          }
        />
      </Routes>
      </Suspense>
      {isMobile && <TabBar />}
    </div>
  );
}
