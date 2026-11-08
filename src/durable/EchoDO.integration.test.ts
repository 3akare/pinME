import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

// Validates: Requirements 18.15
it("echoes a text frame back over /ws-echo", async () => {
  const res = await exports.default.fetch("https://example.com/ws-echo", {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();

  const reply = new Promise<string>((resolve) => {
    ws.addEventListener("message", (e) => resolve(e.data as string));
  });
  ws.send("hello pinme");
  expect(await reply).toBe("hello pinme");
  ws.close(1000);
});
