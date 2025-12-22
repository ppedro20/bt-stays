import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import { trackPwaEvent } from "./pwa/analytics";

type UpdateState = {
  needRefresh: boolean;
  offlineReady: boolean;
};

export function PwaUpdatePrompt() {
  const [state, setState] = useState<UpdateState>({ needRefresh: false, offlineReady: false });
  const [updateFn, setUpdateFn] = useState<null | ((reloadPage?: boolean) => Promise<void>)>(null);

  useEffect(() => {
    const update = registerSW({
      onNeedRefresh() {
        setState((s) => ({ ...s, needRefresh: true }));
        trackPwaEvent({ event_type: "pwa_update_available" });
      },
      onOfflineReady() {
        setState((s) => ({ ...s, offlineReady: true }));
        trackPwaEvent({ event_type: "pwa_offline_ready" });
      },
    });
    setUpdateFn(() => update);
  }, []);

  if (!state.needRefresh && !state.offlineReady) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 9999,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: "100%",
          background: "#0F3D2E",
          color: "#F5F3EE",
          borderRadius: 12,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          boxShadow: "0 8px 24px rgba(15, 61, 46, 0.25)",
        }}
      >
        <div style={{ fontSize: 14, lineHeight: 1.4 }}>
          {state.needRefresh ? "Nova versao disponivel." : "App pronta para uso offline."}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {state.needRefresh ? (
            <button
              type="button"
              onClick={() => {
                trackPwaEvent({ event_type: "pwa_update_applied" });
                updateFn?.(true);
              }}
              style={{
                background: "#D9A441",
                color: "#0F3D2E",
                border: "none",
                borderRadius: 8,
                padding: "6px 10px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Atualizar
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setState({ needRefresh: false, offlineReady: false })}
            style={{
              background: "transparent",
              color: "#F5F3EE",
              border: "1px solid rgba(245, 243, 238, 0.35)",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
