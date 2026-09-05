import { useId } from "react";

/**
 * The design system's `.field` puts the label and the control side by side as
 * siblings, which leaves them unassociated — a screen reader announces an
 * unlabelled input, and clicking the label does nothing.
 *
 * This wires `htmlFor`/`id` with a generated id so the markup stays exactly as
 * the design specifies while actually being usable.
 */
export function Field({
  label,
  hint,
  children,
  style,
}: {
  label: string;
  hint?: string;
  children: (props: { id: string }) => React.ReactNode;
  style?: React.CSSProperties;
}) {
  const id = useId();
  return (
    <div className="field" style={style}>
      <label htmlFor={id}>{label}</label>
      {children({ id })}
      {hint && (
        <p style={{ fontSize: 11, opacity: 0.6, margin: "4px 0 0" }}>{hint}</p>
      )}
    </div>
  );
}
