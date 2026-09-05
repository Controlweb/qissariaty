import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Field } from "./Field";

type Axis = { name: string; values: string };

/**
 * Seller-side variant editor.
 *
 * The seller declares option axes ("Couleur: Rouge, Bleu"); the cartesian
 * product of those is generated here so they only ever fill in price and stock.
 * Existing rows are matched by their option map, so editing an axis keeps the
 * numbers already entered for combinations that survive.
 */
export function VariantEditor({ productId, basePriceMinor }: { productId: string; basePriceMinor: number }) {
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: ["product", productId, "variants"],
    queryFn: () => api.variants(productId),
  });

  const [axes, setAxes] = useState<Axis[]>([]);
  const [rows, setRows] = useState<Record<string, { price: string; stock: string; sku: string }>>({});

  useEffect(() => {
    if (!existing.data) return;
    setAxes(existing.data.options.map((o) => ({ name: o.name, values: o.values.join(", ") })));
    const seeded: typeof rows = {};
    for (const v of existing.data.variants) {
      seeded[keyOf(v.options)] = {
        price: (v.priceMinor / 100).toFixed(2),
        stock: String(v.stock),
        sku: v.sku ?? "",
      };
    }
    setRows(seeded);
  }, [existing.data]);

  const parsed = axes
    .map((a) => ({
      name: a.name.trim(),
      values: a.values.split(",").map((v) => v.trim()).filter(Boolean),
    }))
    .filter((a) => a.name && a.values.length);

  const combos = cartesian(parsed);

  const save = useMutation({
    mutationFn: () =>
      api.saveVariants(productId, {
        options: parsed,
        variants: combos.map((c) => {
          const r = rows[keyOf(c)];
          return {
            options: c,
            sku: r?.sku || undefined,
            priceMinor: Math.round(Number(r?.price || basePriceMinor / 100) * 100),
            stock: Number(r?.stock || 0),
          };
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product", productId] });
      qc.invalidateQueries({ queryKey: ["store"] });
    },
  });

  const setRow = (c: Record<string, string>, field: "price" | "stock" | "sku", value: string) =>
    setRows((r) => ({
      ...r,
      [keyOf(c)]: { price: "", stock: "0", sku: "", ...r[keyOf(c)], [field]: value },
    }));

  return (
    <div className="card" style={{ padding: 22, gap: 16 }}>
      <p className="card-kicker" style={{ margin: 0 }}>
        Options et déclinaisons
      </p>

      {axes.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <Field label="Option" style={{ flex: "0 0 160px" }}>
          {({ id }) => (
            <input
            id={id}
            className="input"
            value={a.name}
            placeholder="Couleur"
            onChange={(e) =>
            setAxes(axes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
            }
            />
          )}
        </Field>
          <Field label="Valeurs (séparées par une virgule)" style={{ flex: 1 }}>
          {({ id }) => (
            <input
            id={id}
            className="input"
            value={a.values}
            placeholder="Rouge, Bleu, Vert"
            onChange={(e) =>
            setAxes(axes.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))
            }
            />
          )}
        </Field>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            onClick={() => setAxes(axes.filter((_, j) => j !== i))}
          >
            Retirer
          </button>
        </div>
      ))}

      {axes.length < 3 && (
        <button
          className="btn btn-secondary"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setAxes([...axes, { name: "", values: "" }])}
        >
          Ajouter une option
        </button>
      )}

      {!!combos.length && (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Déclinaison</th>
                <th>Réf.</th>
                <th>Prix (MAD)</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {combos.map((c) => {
                const r = rows[keyOf(c)];
                return (
                  <tr key={keyOf(c)}>
                    <td>{Object.values(c).join(" · ")}</td>
                    <td>
                      <input
                        className="input"
                        style={{ minHeight: 32 }}
                        value={r?.sku ?? ""}
                        onChange={(e) => setRow(c, "sku", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        style={{ minHeight: 32, width: 110 }}
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder={(basePriceMinor / 100).toFixed(2)}
                        value={r?.price ?? ""}
                        onChange={(e) => setRow(c, "price", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        style={{ minHeight: 32, width: 90 }}
                        type="number"
                        min="0"
                        value={r?.stock ?? "0"}
                        onChange={(e) => setRow(c, "stock", e.target.value)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>
            Le prix affiché sur la fiche produit devient le plus bas des déclinaisons, et le stock
            leur somme.
          </p>
        </>
      )}

      {save.isError && (
        <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>
          {save.error.message}
        </p>
      )}
      {save.isSuccess && (
        <p style={{ color: "var(--color-accent-2-700)", fontSize: 13, margin: 0 }}>
          Déclinaisons enregistrées.
        </p>
      )}

      <button
        className="btn btn-primary"
        style={{ alignSelf: "flex-start" }}
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        Enregistrer les déclinaisons
      </button>
    </div>
  );
}

/** Stable identity for an option map, independent of key order. */
const keyOf = (o: Record<string, string>) =>
  Object.keys(o)
    .sort()
    .map((k) => `${k}=${o[k]}`)
    .join("|");

function cartesian(axes: { name: string; values: string[] }[]): Record<string, string>[] {
  if (!axes.length) return [];
  return axes.reduce<Record<string, string>[]>(
    (acc, axis) => acc.flatMap((row) => axis.values.map((v) => ({ ...row, [axis.name]: v }))),
    [{}],
  );
}
