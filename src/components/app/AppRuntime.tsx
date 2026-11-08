import { useEffect } from "react";
import { bootstrapApp } from "../../client/app/bootstrap";
import { useIdentityStore } from "../../client/state/identity";
import { Toasts } from "./Toasts";

/**
 * App-wide client runtime: keeps the sockets of every active PIN running on any route,
 * and surfaces requests, acceptances and new messages wherever the user is.
 */
export function AppRuntime() {
  const identity = useIdentityStore((s) => s.identity);
  useEffect(() => {
    void bootstrapApp();
  }, []);
  return identity ? <Toasts /> : null;
}
