import { useEffect, useState } from "react";
import { Button, useToast } from "@bt/shared/ui";
import { getExistingSubscription, subscribeToPush, unsubscribeFromPush } from "./pwa/push";

type Status = "unsupported" | "denied" | "default" | "granted";
type Language = "pt" | "en" | "fr";

const TRANSLATIONS: Record<Language, Record<string, string>> = {
  pt: {
    title: "Notificacoes",
    active_title: "Notificacoes ativas",
    enable_label: "Ativar notificacoes",
    disable_label: "Desativar notificacoes",
    permission_denied: "Permissao negada.",
    active_message: "Vais receber atualizacoes importantes.",
    enable_failed: "Falha ao ativar.",
    disable_message: "Notificacoes desativadas.",
    disable_failed: "Falha ao desativar.",
  },
  en: {
    title: "Notifications",
    active_title: "Notifications enabled",
    enable_label: "Enable notifications",
    disable_label: "Disable notifications",
    permission_denied: "Permission denied.",
    active_message: "You'll receive important updates.",
    enable_failed: "Failed to enable.",
    disable_message: "Notifications disabled.",
    disable_failed: "Failed to disable.",
  },
  fr: {
    title: "Notifications",
    active_title: "Notifications actives",
    enable_label: "Activer les notifications",
    disable_label: "Desactiver les notifications",
    permission_denied: "Permission refusee.",
    active_message: "Vous recevrez des mises a jour importantes.",
    enable_failed: "Echec de l'activation.",
    disable_message: "Notifications desactivees.",
    disable_failed: "Echec de la desactivation.",
  },
};

export function PwaNotifications({ language }: { language: Language }) {
  const { push } = useToast();
  const [status, setStatus] = useState<Status>("default");
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const t = TRANSLATIONS[language];

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
        push({ title: t.title, message: t.permission_denied });
        return;
      }
      await subscribeToPush();
      setSubscribed(true);
      push({ title: t.active_title, message: t.active_message });
    } catch (e) {
      push({ title: t.title, message: e instanceof Error ? e.message : t.enable_failed });
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      setSubscribed(false);
      push({ title: t.title, message: t.disable_message });
    } catch (e) {
      push({ title: t.title, message: e instanceof Error ? e.message : t.disable_failed });
    } finally {
      setBusy(false);
    }
  }

  if (subscribed) {
    return (
      <Button variant="ghost" onClick={onDisable} disabled={busy}>
        {t.disable_label}
      </Button>
    );
  }

  return (
    <Button variant="ghost" onClick={onEnable} disabled={busy}>
      {t.enable_label}
    </Button>
  );
}
