import { useEffect } from "react";
import { bootstrapApp } from "../../client/app/bootstrap";
import { registerAppWorker, syncPush } from "../../client/app/push";
import { usePinsStore } from "../../client/state/pins";
import { useInstallStore } from "../../client/state/install";
import { useIdentityStore } from "../../client/state/identity";
import { Toasts } from "./Toasts";

/**
 * App-wide client runtime: keeps the sockets of every active PIN running on any route,
 * and surfaces requests, acceptances and new messages wherever the user is.
 */
export function AppRuntime() {
  const identity = useIdentityStore((s) => s.identity);
  useEffect(() => {
    void registerAppWorker();
    void bootstrapApp().then((ok) => {
      if (ok) void syncPush(usePinsStore.getState().pins).catch(() => {});
    });
    // Chrome and Edge offer installing; keep the event so the menu can ask at the right moment.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      useInstallStore.getState().setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => useInstallStore.getState().setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return identity ? <Toasts /> : null;
}
