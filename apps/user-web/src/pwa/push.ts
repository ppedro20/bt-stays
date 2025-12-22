import { getDeviceId } from "./device";
import { trackPwaEvent } from "./analytics";

type PushKeys = { p256dh: string; auth: string };

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function getEnv() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!url || !anonKey || !vapidKey) return null;
  return { url, anonKey, vapidKey };
}

async function postPushSubscription(path: string, subscription: PushSubscription) {
  const env = getEnv();
  if (!env) throw new Error("Missing push configuration");

  const json = subscription.toJSON();
  const keys = json.keys as PushKeys | undefined;
  if (!keys?.p256dh || !keys?.auth) throw new Error("Missing push subscription keys");

  await fetch(`${env.url}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${env.anonKey}`,
      apikey: env.anonKey,
    },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys,
      device_id: getDeviceId(),
      user_agent: navigator.userAgent,
    }),
  });
}

export async function getExistingSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush() {
  const env = getEnv();
  if (!env) throw new Error("Missing push configuration");
  const reg = await navigator.serviceWorker.ready;

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(env.vapidKey),
  });

  await postPushSubscription("push_subscribe", subscription);
  await trackPwaEvent({ event_type: "pwa_push_subscribed" });
  return subscription;
}

export async function unsubscribeFromPush() {
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  await postPushSubscription("push_unsubscribe", subscription);
  await subscription.unsubscribe();
  await trackPwaEvent({ event_type: "pwa_push_unsubscribed" });
}
