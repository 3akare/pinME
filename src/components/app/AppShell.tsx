import { useState } from "react";
import { useShakeStore } from "../../client/net/handlers/ping";
import { ChatView } from "../chat/ChatView";
import { ChatList } from "../contacts/ChatList";
import { Ghost } from "../ui/Ghost";
import { GroupView } from "../chat/GroupView";
import { useAppViewport } from "./useAppViewport";
import { BackupSheet, MyCodeSheet, NewGroupSheet, ScanSheet } from "./Sheets";

export type SheetName = "code" | "scan" | "backup" | "group";

export interface AppShellProps {
  /** Contact PIN of the open chat; without one the list fills the phone screen. */
  chatPin?: string;
  /** Open group conversation, when the route is /g/$groupId. */
  groupId?: string;
  initialSheet?: SheetName;
}

/** The messenger: chat list beside the open conversation on wide screens, one at a time on a phone. */
export function AppShell({ chatPin, groupId, initialSheet }: AppShellProps) {
  const [sheet, setSheet] = useState<SheetName | null>(initialSheet ?? null);
  const shaking = useShakeStore((s) => s.shaking);
  const chatOpen = !!chatPin || !!groupId;
  useAppViewport();

  return (
    <div className="app-frame flex overflow-hidden bg-paper">
      <aside
        aria-label="Chats"
        className={`${chatOpen ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-rule md:w-[380px] md:border-r`}
      >
        <ChatList
          selected={chatPin ?? (groupId ? `g:${groupId}` : undefined)}
          onScan={() => setSheet("scan")}
          onNewGroup={() => setSheet("group")}
          onMyCode={() => setSheet("code")}
          onBackup={() => setSheet("backup")}
        />
      </aside>
      <main className={`${chatOpen ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-paper${shaking && chatOpen ? " pinme-shake" : ""}`}>
        {chatPin ? (
          <ChatView key={chatPin} pin={chatPin} />
        ) : groupId ? (
          <GroupView key={groupId} groupId={groupId} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <Ghost className="w-14 text-paper-3" />
            <p className="max-w-[32ch] font-display text-2xl text-ink-2">Pick a chat, or scan a code to start one.</p>
          </div>
        )}
      </main>
      {sheet === "code" ? <MyCodeSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "scan" ? <ScanSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "backup" ? <BackupSheet onClose={() => setSheet(null)} /> : null}
      {sheet === "group" ? <NewGroupSheet onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
