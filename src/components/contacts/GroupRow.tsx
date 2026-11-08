import { formatListTime } from "../../client/chat/format";
import type { GroupRecord, MessageRecord } from "../../client/storage";
import { Avatar } from "../ui/Avatar";

export interface GroupRowProps {
  group: GroupRecord;
  last?: MessageRecord;
  unread?: number;
  selected?: boolean;
  onOpen: (groupId: string) => void;
}

/** A group in the chat list: who said the last thing, when, and how many are unread. */
export function GroupRow({ group, last, unread = 0, selected, onOpen }: GroupRowProps) {
  const who =
    last?.kind === "system"
      ? ""
      : last?.direction === "out"
        ? "You: "
        : last?.sender
          ? `${group.members.find((m) => m.pin === last.sender)?.displayName ?? "Someone"}: `
          : "";
  const preview = last ? `${who}${last.text}` : `${group.members.length + 1} members`;
  return (
    <button
      type="button"
      onClick={() => onOpen(group.groupId)}
      aria-current={selected ? "true" : undefined}
      className={`flex h-[72px] w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
        selected ? "bg-elevated" : "hover:bg-elevated/60"
      }`}
    >
      <Avatar name={group.name} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-semibold text-text">{group.name}</span>
          {last ? <span className="ml-auto shrink-0 text-xs text-muted">{formatListTime(last.ts)}</span> : null}
        </span>
        <span className="flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate whitespace-nowrap text-sm ${unread > 0 ? "text-text" : "text-muted"}`}>
            {preview}
          </span>
          {unread > 0 ? (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold text-on-accent">
              {unread}
              <span className="sr-only"> unread</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
