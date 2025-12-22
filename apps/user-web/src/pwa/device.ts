const DEVICE_KEY = "bt_device_id";

export function getDeviceId(): string {
  if (typeof localStorage === "undefined") return "unknown";
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, created);
  return created;
}
