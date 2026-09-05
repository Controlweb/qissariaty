import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MapBounds } from "../lib/api";

/**
 * Local, ephemeral UI state only. Markets, stores, products, cart and orders
 * are server state and belong to TanStack Query — duplicating them here is how
 * a store turns into a stale second copy of the database.
 */
type UiState = {
  /** Last map viewport, so returning to the map does not reset to Casablanca. */
  bounds: MapBounds | null;
  setBounds: (b: MapBounds) => void;

  filters: { q: string; city: string | null; categoryId: string | null };
  setFilter: <K extends keyof UiState["filters"]>(key: K, value: UiState["filters"][K]) => void;
  clearFilters: () => void;

  cartOpen: boolean;
  toggleCart: (open?: boolean) => void;
};

const DEFAULT_FILTERS = { q: "", city: null, categoryId: null };

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      bounds: null,
      setBounds: (bounds) => set({ bounds }),

      filters: DEFAULT_FILTERS,
      setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
      clearFilters: () => set({ filters: DEFAULT_FILTERS }),

      cartOpen: false,
      toggleCart: (open) => set((s) => ({ cartOpen: open ?? !s.cartOpen })),
    }),
    {
      name: "qissariaty-ui",
      // Only the map viewport is worth remembering across reloads.
      partialize: (s) => ({ bounds: s.bounds }),
    },
  ),
);
