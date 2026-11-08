import { receiveMessage, type ReceiveDeps } from "../../chat/receive";
import type { Dispatcher, Handler } from "../dispatch";

export type MessageHandlerDeps = ReceiveDeps & { ownPin: string };

export function createMessageHandler(deps: MessageHandlerDeps): Handler<"message"> {
  return (msg) => {
    void receiveMessage(deps, deps.ownPin, msg).catch(() => {});
  };
}

/** Registers only the `message` handler; other frame types are untouched. */
export function registerMessageHandlers(dispatcher: Dispatcher, deps: MessageHandlerDeps): () => void {
  return dispatcher.register("message", createMessageHandler(deps));
}
