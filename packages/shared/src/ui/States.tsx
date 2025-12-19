import { StatusBadge } from "./StatusBadge";

export function BlockingLoading({ label }: { label: string }) {
  return (
    <div className="bt-overlay" role="alert" aria-live="assertive" aria-busy="true">
      <div className="bt-loading">
        <div className="bt-spinner" aria-hidden="true" />
        <div>
          <div style={{ fontWeight: 800, fontSize: 13 }}>{label}</div>
          <div className="bt-muted" style={{ margin: 0 }}>
            Estado bloqueante (sem retries).
          </div>
        </div>
      </div>
    </div>
  );
}

export function ErrorState({ title, message }: { title?: string; message: string }) {
  return (
    <div className="bt-card" role="alert">
      <div className="bt-row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 850 }}>{title ?? "Erro"}</div>
        <StatusBadge tone="danger" text="error" />
      </div>
      <div className="bt-toast-body">{message}</div>
    </div>
  );
}

export function EmptyState({ title, message }: { title?: string; message: string }) {
  return (
    <div className="bt-card" role="status">
      <div className="bt-row" style={{ justifyContent: "space-between" }}>
        <div style={{ fontWeight: 850 }}>{title ?? "Sem dados"}</div>
        <StatusBadge tone="neutral" text="empty" />
      </div>
      <div className="bt-toast-body">{message}</div>
    </div>
  );
}
