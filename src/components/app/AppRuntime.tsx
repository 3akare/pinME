import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { bootstrapApp } from "../../client/app/bootstrap";
import { useIdentityStore } from "../../client/state/identity";
import { InvitePrompt } from "../invites/InvitePrompt";
import { Toasts } from "./Toasts";

/**
 * App-wide client runtime: keeps the sockets of every active PIN running on any route,
 * and surfaces incoming invites and acceptances wherever the user is.
 */
export function AppRuntime() {
  const identity = useIdentityStore((s) => s.identity);
  // Contacts lists pending invites inline with the same actions, so no dialog there.
  const onContacts = useRouterState({ select: (s) => s.location.pathname === "/" });

  useEffect(() => {
    void bootstrapApp();
  }, []);

  if (!identity) return null;
  return (
    <>
      {onContacts ? null : <InvitePrompt />}
      <Toasts />
    </>
  );
}
