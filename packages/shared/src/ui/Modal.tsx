import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button";

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="bt-modal-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="bt-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bt-modal-header">
          <div className="bt-h2">{title}</div>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
