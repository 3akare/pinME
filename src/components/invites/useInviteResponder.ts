import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { buildInviteFlow } from "../../client/app/bootstrap";
import type { FlowResult } from "../../client/invites/flow";
import { usePinsStore } from "../../client/state/pins";
import type { InviteRecord } from "../../client/storage";

/** Accepts or declines an invite for the PIN it was sent to; an accept opens the new chat. */
export function useInviteResponder(): (invite: InviteRecord, accept: boolean) => Promise<FlowResult> {
  const navigate = useNavigate();
  return useCallback(
    async (invite, accept) => {
      const flow = await buildInviteFlow((to) => {
        usePinsStore.getState().setActivePin(to.ownPin);
        void navigate({ to: "/chat/$pin", params: { pin: to.pin } });
      });
      return flow.respondInvite(invite.ownPin, invite.inviteId, accept);
    },
    [navigate],
  );
}
