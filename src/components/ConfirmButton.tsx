import { useEffect, useRef } from "react";

/**
 * A button that asks before doing something irreversible.
 *
 * Built on the native <dialog> element: showModal() gives focus trapping, an
 * inert background and Escape-to-close for free, which is most of what a
 * hand-rolled modal gets wrong. The design system's .dialog classes style it,
 * and ::backdrop replaces the .dialog-backdrop div.
 *
 * Cancel is focused on open, so Enter dismisses rather than confirms.
 */
export function ConfirmButton({
  label,
  title,
  body,
  confirmLabel,
  onConfirm,
  disabled,
  className = "btn btn-ghost",
  style,
}: {
  label: React.ReactNode;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // Escape fires `cancel`/`close` natively; nothing to clean up but the state
  // the browser already manages. This only guards against unmounting mid-open.
  useEffect(() => () => ref.current?.close(), []);

  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        disabled={disabled}
        onClick={() => ref.current?.showModal()}
      >
        {label}
      </button>

      <dialog
        ref={ref}
        className="dialog"
        style={{ border: 0, padding: "var(--space-4)" }}
        onClick={(e) => {
          // Clicks land on the dialog box itself; one on the backdrop reports
          // the <dialog> as the target because the box does not contain it.
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <p className="dialog-title" style={{ margin: 0 }}>
          {title}
        </p>
        <p className="dialog-body" style={{ margin: 0 }}>
          {body}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" autoFocus onClick={() => ref.current?.close()}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              ref.current?.close();
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
