import { useMemo, useState } from "react";
import type { ProductOption, ProductVariant } from "../lib/api";

const chip = (state: "on" | "off" | "dead"): React.CSSProperties => ({
  fontSize: 13,
  padding: "8px 16px",
  ...(state === "on"
    ? { background: "var(--color-accent)", color: "var(--color-bg)" }
    : state === "dead"
      ? {
          border: "1px solid var(--color-divider)",
          opacity: 0.4,
          textDecoration: "line-through",
        }
      : { border: "1px solid var(--color-divider)" }),
});

/**
 * Option chips that resolve to a concrete variant.
 *
 * A value is struck through when picking it could not lead to any in-stock
 * combination *given the other axes already chosen* — the standard
 * marketplace behaviour, and much kinder than letting someone assemble a
 * combination that does not exist and only failing at "add to cart".
 */
export function VariantPicker({
  options,
  variants,
  onChange,
}: {
  options: ProductOption[];
  variants: ProductVariant[];
  onChange: (variant: ProductVariant | null) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});

  const matches = (sel: Record<string, string>) =>
    variants.filter((v) => Object.entries(sel).every(([k, val]) => v.options[k] === val));

  const selected = useMemo(() => {
    if (options.some((o) => !picked[o.name])) return null;
    return matches(picked)[0] ?? null;
  }, [picked, variants, options]);

  // Report upward whenever the resolved variant changes.
  const [reported, setReported] = useState<string | null>(null);
  if ((selected?.id ?? null) !== reported) {
    setReported(selected?.id ?? null);
    onChange(selected);
  }

  const availability = (axis: string, value: string) => {
    // Hold the other axes fixed and ask whether anything in stock remains.
    const trial = { ...picked, [axis]: value };
    const found = matches(trial);
    if (!found.length) return "dead" as const;
    return found.some((v) => v.stock > 0) ? "off" : ("dead" as const);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 22 }}>
      {options.map((o) => (
        <div key={o.id}>
          <p
            style={{
              fontSize: 11,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              opacity: 0.6,
              margin: "0 0 8px",
            }}
          >
            {o.name}
            {picked[o.name] ? ` · ${picked[o.name]}` : ""}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {o.values.map((v) => {
              const state = picked[o.name] === v ? "on" : availability(o.name, v);
              return (
                <button
                  key={v}
                  className="btn"
                  style={chip(state)}
                  onClick={() =>
                    setPicked((p) => (p[o.name] === v ? omit(p, o.name) : { ...p, [o.name]: v }))
                  }
                >
                  {v}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {options.length > 0 && !selected && (
        <p style={{ fontSize: 13, color: "var(--color-accent-700)", margin: 0 }}>
          Choisissez {options.length > 1 ? "toutes les options" : "une option"} pour continuer.
        </p>
      )}
    </div>
  );
}

const omit = (o: Record<string, string>, key: string) => {
  const { [key]: _drop, ...rest } = o;
  return rest;
};
