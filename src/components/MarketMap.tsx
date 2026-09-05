import { useEffect, useRef } from "react";
import L from "leaflet";
import type { MapBounds, MarketCard } from "../lib/api";

const CASABLANCA: [number, number] = [33.5731, -7.5898];

/**
 * Leaflet map, matching the design's `<div ref="{{ mapRef }}">` slot.
 *
 * The map owns the viewport; the parent owns the data. Every `moveend` hands
 * the new bounds upward and the parent refetches only what is on screen — this
 * is what stops a nationwide catalogue being downloaded at low zoom.
 */
export function MarketMap({
  markets,
  selectedId,
  onBoundsChange,
  onSelect,
  compact = false,
}: {
  markets: MarketCard[];
  selectedId?: string | null;
  onBoundsChange: (b: MapBounds) => void;
  onSelect: (id: string) => void;
  /** Phone layout: drop the zoom buttons, which collide with the overlay card. */
  compact?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  // Keep the latest callbacks without re-running the map-init effect.
  const notify = useRef(onBoundsChange);
  notify.current = onBoundsChange;
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!container.current || map.current) return;

    const m = L.map(container.current, { zoomControl: !compact }).setView(CASABLANCA, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(m);

    layer.current = L.layerGroup().addTo(m);
    map.current = m;

    const emit = () => {
      const b = m.getBounds();
      notify.current({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    };
    emit();
    m.on("moveend", emit);

    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    // Rebuild pins wholesale — a viewport holds at most 200 of them.
    g.clearLayers();
    for (const market of markets) {
      const active = market.id === selectedId;
      // A divIcon rather than Leaflet's default PNG: it takes the design's
      // accent tokens directly and avoids the bundler icon-path problem.
      const icon = L.divIcon({
        className: "",
        html: `<span style="
          display:block;width:${active ? 20 : 14}px;height:${active ? 20 : 14}px;
          border-radius:999px;
          background:var(${active ? "--color-accent-700" : "--color-accent"});
          box-shadow:0 0 0 3px var(--color-bg), var(--shadow-sm);
        "></span>`,
        iconSize: [active ? 20 : 14, active ? 20 : 14],
        iconAnchor: [active ? 10 : 7, active ? 10 : 7],
      });
      L.marker([market.lat, market.lng], { icon, title: market.name })
        .on("click", () => select.current(market.id))
        .addTo(g);
    }
  }, [markets, selectedId]);

  return <div ref={container} style={{ position: "absolute", inset: 0 }} />;
}
