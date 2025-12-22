import { getDeviceId } from "./device";

type PwaEvent = {
  event_type: string;
  payload?: Record<string, unknown>;
};

function getDisplayMode(): string {
  if (window.matchMedia("(display-mode: standalone)").matches) return "standalone";
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return "standalone";
  return "browser";
}

export async function trackPwaEvent(event: PwaEvent) {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) return;

  const body = {
    event_type: event.event_type,
    payload: {
      ...event.payload,
      display_mode: getDisplayMode(),
    },
    device_id: getDeviceId(),
    url: window.location.href,
    referrer: document.referrer || null,
    user_agent: navigator.userAgent,
  };

  try {
    await fetch(`${url}/functions/v1/pwa_event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // background sync will retry when available
  }
}
