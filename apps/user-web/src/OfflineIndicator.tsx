import { useEffect, useState } from "react";

export function OfflineIndicator() {
  const [offline, setOffline] = useState<boolean>(!navigator.onLine);

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        top: 16,
        zIndex: 9999,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: "100%",
          background: "#D9A441",
          color: "#0F3D2E",
          borderRadius: 12,
          padding: "10px 14px",
          fontSize: 14,
          lineHeight: 1.4,
          fontWeight: 600,
          boxShadow: "0 8px 24px rgba(15, 61, 46, 0.2)",
        }}
      >
        Sem ligacao. Algumas acoes nao estao disponiveis.
      </div>
    </div>
  );
}
