import startHandler from "@tanstack/react-start/server-entry";
import { routeFor } from "./shared/route";

export { PinMailbox } from "./durable/PinMailbox";
export { EchoDO } from "./durable/EchoDO";

export default {
  async fetch(request, env) {
    const route = routeFor(new URL(request.url).pathname);
    switch (route.kind) {
      case "mailbox":
        return env.PIN_MAILBOX.get(env.PIN_MAILBOX.idFromName(route.pin)).fetch(request);
      case "echo":
        return env.ECHO_DO.get(env.ECHO_DO.idFromName("echo")).fetch(request);
      default:
        return startHandler.fetch(request);
    }
  },
} satisfies ExportedHandler<Env>;
