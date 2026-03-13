/**
 * Request notification permission and show a browser notification
 * when the page is not focused.
 */
export async function requestNotificationPermission(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
}

export function notifyIfHidden(title: string, body: string): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return; // only notify when hidden
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    // some browsers block in certain contexts
  }
}
