import { advance, type Marker } from "../../../shared/marker";
import type { Repositories } from "../../storage";
import type { Dispatcher, Handler } from "../dispatch";

export interface ReceiptHandlerDeps {
  ownPin: string;
  repos: Pick<Repositories, "messageRepo">;
  store: {
    applyMarker(ownPin: string, contactPin: string, messageId: string, marker: Marker): void;
  };
}

/**
 * Applies a delivered/read receipt to an outgoing message. The marker never
 * moves backward and `read` may jump straight from clock to R. Unknown
 * Message_IDs (and incoming messages) are ignored.
 */
export async function applyReceipt(
  deps: ReceiptHandlerDeps,
  from: string,
  messageId: string,
  incoming: Marker,
): Promise<void> {
  const { ownPin, repos, store } = deps;
  const existing = await repos.messageRepo.get(ownPin, from, messageId);
  if (!existing || existing.direction !== "out") return;
  const current: Marker = existing.marker ?? "clock";
  const next = advance(current, incoming);
  store.applyMarker(ownPin, from, messageId, next);
  if (next !== current) await repos.messageRepo.setMarker(ownPin, from, messageId, next);
}

export function createReceiptHandler(
  deps: ReceiptHandlerDeps,
  incoming: Marker,
  onError: () => void = () => {},
): Handler<"delivered"> & Handler<"read"> {
  return (msg) => {
    void applyReceipt(deps, msg.from, msg.messageId, incoming).catch(onError);
  };
}

/** Registers the `delivered` (-> D) and `read` (-> R) handlers. Returns an unregister function. */
export function registerReceiptHandlers(
  dispatcher: Dispatcher,
  deps: ReceiptHandlerDeps,
): () => void {
  const offs = [
    dispatcher.register("delivered", createReceiptHandler(deps, "D")),
    dispatcher.register("read", createReceiptHandler(deps, "R")),
  ];
  return () => offs.forEach((off) => off());
}
