import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { connectSocket, type ReconnectingSocket } from "../client/net/socket";
import { seo } from "../shared/seo";

export const Route = createFileRoute("/echo")({
  head: () => seo({ title: "Echo", noindex: true }),
  component: Echo,
});

function Echo() {
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [connected, setConnected] = useState(false);
  const sock = useRef<ReconnectingSocket | null>(null);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const s = connectSocket({
      url: `${proto}://${location.host}/ws-echo`,
      onOpen: () => {
        setConnected(true);
        s.resetBackoff();
      },
      onClose: () => setConnected(false),
      onMessage: (d) => setReply(d),
    });
    sock.current = s;
    return () => s.close();
  }, []);

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold text-accent">Echo</h1>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (sock.current?.send(text)) setText("");
        }}
      >
        <label className="sr-only" htmlFor="echo-input">
          Message
        </label>
        <input
          id="echo-input"
          className="flex-1 rounded border border-muted bg-transparent px-3 py-2"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          disabled={!connected}
          className="rounded bg-accent px-4 py-2 font-semibold text-on-accent disabled:opacity-50"
        >
          Send
        </button>
      </form>
      <p className="mt-4 text-muted" aria-live="polite">
        Reply: <span data-testid="echo-reply">{reply}</span>
      </p>
    </main>
  );
}
