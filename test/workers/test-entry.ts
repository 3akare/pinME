import { PinMailbox } from "../../src/durable/PinMailbox";
import type { DirectoryClient } from "../../src/durable/directoryClient";
import { routeFor } from "../../src/shared/route";
import { ACTIVE_PIN, BURNED_PIN, INVITE_TEST_PIN_B, INVITE_TEST_SEED_B, testKeys } from "./keys";

export { EchoDO } from "../../src/durable/EchoDO";

/** In-memory Directory: ACTIVE_PIN is registered, BURNED_PIN is burned, anything else is unknown. */
const fakeDirectory: DirectoryClient = {
  async lookupPin(pin) {
    if (pin === BURNED_PIN) return { state: "burned" };
    if (pin === INVITE_TEST_PIN_B) {
      const { publicKeyB64 } = await testKeys(INVITE_TEST_SEED_B);
      return { state: "active", signPublicKey: publicKeyB64, boxPublicKey: publicKeyB64 };
    }
    if (pin === ACTIVE_PIN) {
      const { publicKeyB64 } = await testKeys(1);
      return { state: "active", signPublicKey: publicKeyB64, boxPublicKey: publicKeyB64 };
    }
    return { state: "unknown" };
  },
  async isContactPair() {
    return false;
  },
  async mayRelay() {
    return false;
  },
};

/** PinMailbox wired to the fake Directory (no Neon). */
export class TestPinMailbox extends PinMailbox {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, { directory: () => fakeDirectory });
  }
}

/** Test-only entry: routes /ws-echo and /ws/:pin without the TanStack Start handler. */
export default {
  async fetch(request, env) {
    const route = routeFor(new URL(request.url).pathname);
    if (route.kind === "echo") {
      return env.ECHO_DO.get(env.ECHO_DO.idFromName("echo")).fetch(request);
    }
    if (route.kind === "mailbox") {
      return env.PIN_MAILBOX.get(env.PIN_MAILBOX.idFromName(route.pin)).fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<{ ECHO_DO: DurableObjectNamespace; PIN_MAILBOX: DurableObjectNamespace }>;
