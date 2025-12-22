import { useEffect, useState } from "react";
import { Button, useToast } from "@bt/shared/ui";
import { getExistingSubscription, subscribeToPush, unsubscribeFromPush } from "./pwa/push";

type Status = "unsupported" | "denied" | "default" | "granted";

export function PwaNotifications() {
  const { push } = useToast();
  const [status, setStatus] = useState<Status>("default");
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    if (!import.meta.env.VITE_VAPID_PUBLIC_KEY) {
      setStatus("unsupported");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    setStatus(Notification.permission);
    getExistingSubscription().then((sub) => setSubscribed(Boolean(sub)));
  }, []);

  if (status === "unsupported" || status === "denied") return null;

  async function onEnable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setStatus(permission);
      if (permission !== "granted") {
        push({ title: "Notificacoes", message: "Permissao negada." });
        return;
      }
      await subscribeToPush();
      setSubscribed(true);
      push({ title: "Notificacoes ativas", message: "Vais receber atualizacoes importantes." });
    } catch (e) {
      push({ title: "Notificacoes", message: e instanceof Error ? e.message : "Falha ao ativar." });
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      setSubscribed(false);
      push({ title: "Notificacoes", message: "Notificacoes desativadas." });
    } catch (e) {
      push({ title: "Notificacoes", message: e instanceof Error ? e.message : "Falha ao desativar." });
    } finally {
      setBusy(false);
    }
  }

  if (subscribed) {
    return (
      <Button variant="ghost" onClick={onDisable} disabled={busy}>
        Desativar notificacoes
      </Button>
    );
  }

  return (
    <Button variant="ghost" onClick={onEnable} disabled={busy}>
      Ativar notificacoes
    </Button>
  );
}
