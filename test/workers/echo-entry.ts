import { routeFor } from "../../src/shared/route";

export { EchoDO } from "../../src/durable/EchoDO";

/** Test-only entry: same routing as src/worker.ts without the TanStack Start handler. */
export default {
  async fetch(request, env) {
    const route = routeFor(new URL(request.url).pathname);
    if (route.kind === "echo") {
      return env.ECHO_DO.get(env.ECHO_DO.idFromName("echo")).fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<{ ECHO_DO: DurableObjectNamespace }>;
