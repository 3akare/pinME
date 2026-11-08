import { useState } from "react";
import { useShakeStore } from "../../client/net/handlers/ping";
import { ChatView } from "../chat/ChatView";
import { ChatList } from "../contacts/ChatList";
import { Ghost } from "../ui/Ghost";
import { MyCodeSheet, ScanSheet } from "./Sheets";

export type SheetName = "code" | "scan";

export interface AppShellProps {
  /** Contact PIN of the open chat; without one the list fills the phone screen. */
  chatPin?: string;
  initialSheet?: SheetName;
}

/** The messenger: chat list beside the open conversation on wide screens, one at a time on a phone. */
export function AppShell({ chatPin, initialSheet }: AppShellProps) {
  const [sheet, setSheet] = useState<SheetName | null>(initialSheet ?? null);
  const shaking = useShakeStore((s) => s.shaking);
  const chatOpen = !!chatPin;

  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
      <aside
        aria-label="Chats"
        className={`${chatOpen ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-rule md:w-[380px] md:border-r`}
      >
        <ChatList selected={chatPin} onScan={() => setSheet("scan")} onMyCode={() => setSheet("code")} />
      </aside>
      <main className={`${chatOpen ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-paper${shaking && chatOpen ? " pinme-shake" : ""}`}>
        {chatPin ? (
          <ChatView key={chatPin} pin={chatPin} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <Ghost className="w-14 text-paper-3" />
            <p className="max-w-[32ch] font-display text-2xl text-ink-2">Pick a chat, or scan a code to start one.</p>
          </div>
        )}
      </main>
      {sheet === "code" ? <MyCodeSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "scan" ? <ScanSheet onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
