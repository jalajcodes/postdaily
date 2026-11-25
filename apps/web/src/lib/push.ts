import { api } from "./api";

export function registerServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** iPhone/iPad: push only works after "Add to Home Screen". */
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
export const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;

const keyToBytes = (b64url: string) => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush() {
  const { enabled, publicKey } = await api.push.config();
  if (!enabled || !publicKey) throw new Error("Push isn't set up on the server yet (missing VAPID keys).");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked. Allow them in your browser or phone settings.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  await api.push.subscribe(sub.endpoint);
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.push.unsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
