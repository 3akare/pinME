/** Burn helpers (Req 13.5, 13.9, 13.11): pure over a minimal storage interface. */
import { holdNotice, type NoticeStorage } from "./notices";
import { PinSchema } from "../shared/protocol";

export const BURNED_KEY = "meta:burned";

export interface BurnStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  deleteAll(): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export async function isBurned(storage: Pick<BurnStorage, "get">): Promise<boolean> {
  return (await storage.get<boolean>(BURNED_KEY)) === true;
}

/** Deletes every stored key (env, rcpt, notice, presence, rl, meta:pin...), cancels alarms, keeps only the tombstone. */
export async function wipeMailbox(storage: BurnStorage): Promise<void> {
  await storage.deleteAll();
  await storage.deleteAlarm();
  await storage.put(BURNED_KEY, true);
}

/** Holds a contactBurned notice for the next authentication; false for an invalid PIN. */
export async function holdContactBurned(storage: NoticeStorage, pin: string, now: number, id: string): Promise<boolean> {
  if (!PinSchema.safeParse(pin).success) return false;
  await holdNotice(storage, { type: "contactBurned", pin }, now, id);
  return true;
}
