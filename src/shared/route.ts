export type Route =
  | { kind: "mailbox"; pin: string }
  | { kind: "echo" }
  | { kind: "app" };

const MAILBOX_PATH = /^\/ws\/([0-9A-F]{8})$/;

/** Pure routing decision for an incoming request path. */
export function routeFor(path: string): Route {
  const match = MAILBOX_PATH.exec(path);
  if (match) return { kind: "mailbox", pin: match[1] };
  if (path === "/ws-echo") return { kind: "echo" };
  return { kind: "app" };
}
