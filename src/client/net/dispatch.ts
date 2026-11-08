import { parseFrame, type ServerMsg } from "../../shared/protocol";

type Type = ServerMsg["type"];
export type Handler<T extends Type> = (msg: Extract<ServerMsg, { type: T }>) => void;
export type HandlerRegistry = { [T in Type]?: Handler<T> };

export interface Dispatcher {
  /** Replace the handler for one frame type. Returns an unregister function. */
  register<T extends Type>(type: T, handler: Handler<T>): () => void;
  /**
   * Add an additional listener for a frame type without replacing the registered handler.
   * Any number of listeners may coexist. Returns an unsubscribe function.
   */
  listen<T extends Type>(type: T, listener: Handler<T>): () => void;
  /**
   * Validate a raw frame with the shared schema and route it to its handler.
   * Invalid frames are discarded and logged with only type and field name.
   * Returns the validated frame, or null if it was discarded.
   */
  dispatch(raw: string): ServerMsg | null;
}

export function createDispatcher(
  initial: HandlerRegistry = {},
  log: (event: string, info: { type?: string; field?: string }) => void = (event, info) =>
    console.warn(JSON.stringify({ event, ...info })),
): Dispatcher {
  const registry: Record<string, ((m: never) => void) | undefined> = { ...initial };
  const listeners = new Map<string, Set<(m: never) => void>>();
  return {
    listen(type, listener) {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      set.add(listener as (m: never) => void);
      return () => {
        set.delete(listener as (m: never) => void);
      };
    },
    register(type, handler) {
      registry[type] = handler as (m: never) => void;
      return () => {
        if (registry[type] === (handler as unknown)) delete registry[type];
      };
    },
    dispatch(raw) {
      const res = parseFrame(raw, "server");
      if (!res.ok) {
        log("frame_discarded", res.reason === "validation_failed" ? { type: res.type, field: res.field } : { type: res.reason });
        return null;
      }
      const msg = res.value;
      try {
        registry[msg.type]?.(msg as never);
      } catch {
        log("handler_failed", { type: msg.type });
      }
      for (const l of [...(listeners.get(msg.type) ?? [])]) {
        try {
          l(msg as never);
        } catch {
          log("handler_failed", { type: msg.type });
        }
      }
      return msg;
    },
  };
}
