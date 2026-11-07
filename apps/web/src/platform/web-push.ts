import { pushSubscriptionSchema, type WebPushSubscription } from "@split/shared";

export interface BrowserPush {
  subscribe(publicKey: string): Promise<WebPushSubscription>;
}
export const browserPush: BrowserPush = {
  async subscribe(publicKey) {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    )
      throw new Error("Push unavailable");
    if ((await Notification.requestPermission()) !== "granted")
      throw new Error("Push permission denied");
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );
    await navigator.serviceWorker.register("/push-sw.js");
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    const existing = subscription?.options.applicationServerKey;
    if (
      subscription &&
      (!existing ||
        !new Uint8Array(existing).every((byte, index) => byte === key[index]) ||
        existing.byteLength !== key.length)
    ) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    return pushSubscriptionSchema.parse(subscription.toJSON());
  },
};
