import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button";

export type ToastItem = {
  id: string;
  title: string;
  message?: string;
};

type ToastApi = {
  push: (toast: Omit<ToastItem, "id">) => void;
  clear: (id: string) => void;
  clearAll: () => void;
  items: ToastItem[];
};

const ToastContext = createContext<ToastApi | null>(null);

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((toast: Omit<ToastItem, "id">) => {
    const item: ToastItem = { id: makeId(), ...toast };
    setItems((prev) => [item, ...prev].slice(0, 3));
  }, []);

  const clear = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  const api = useMemo(() => ({ items, push, clear, clearAll }), [items, push, clear, clearAll]);
  return <ToastContext.Provider value={api}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastViewport() {
  const { items, clear } = useToast();
  if (items.length === 0) return null;
  return (
    <div className="bt-toast-viewport" aria-live="polite" aria-relevant="additions text">
      {items.map((t) => (
        <div key={t.id} className="bt-toast" role="status">
          <div className="bt-toast-title">
            <span>{t.title}</span>
            <Button variant="ghost" onClick={() => clear(t.id)}>
              OK
            </Button>
          </div>
          {t.message ? <div className="bt-toast-body">{t.message}</div> : null}
        </div>
      ))}
    </div>
  );
}
