/// <reference types="@cloudflare/vitest-plugin/types" />
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE } from "../shared/heartbeat";
import { ACTIVE_PIN } from "../../test/workers/keys";

describe("PinMailbox heartbeat", () => {
  it("answers the client keepalive without a protocol error frame", async () => {
    const res = await exports.default.fetch(`https://example.com/ws/${ACTIVE_PIN}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const received: string[] = [];
    let wake: () => void = () => {};
    ws.addEventListener("message", (e) => {
      received.push(e.data as string);
      wake();
    });
    ws.accept();
    const nextMatching = (pred: (d: string) => boolean) =>
      new Promise<string>((resolve) => {
        const check = () => {
          const hit = received.find(pred);
          if (hit) resolve(hit);
        };
        wake = check;
        check();
      });

    await nextMatching((d) => d.includes('"challenge"'));
    ws.send(HEARTBEAT_REQUEST);
    expect(await nextMatching((d) => d === HEARTBEAT_RESPONSE)).toBe(HEARTBEAT_RESPONSE);
    expect(received.some((d) => d.includes('"error"'))).toBe(false);
    ws.close(1000);
  });
});
