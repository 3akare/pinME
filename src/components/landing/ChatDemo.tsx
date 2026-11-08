import { MessageBubble } from "../chat/MessageBubble";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";

/** The product built at full size: one marketplace chat with D and R markers, typing and PING. */
export function ChatDemo() {
  return (
    <figure className="m-0 flex min-h-[520px] flex-col overflow-hidden rounded-card bg-paper-2">
      <div className="flex items-center gap-3 border-b border-rule px-5 py-3">
        <Avatar name="Ada" size={40} />
        <div className="flex flex-col">
          <span className="font-display text-xl leading-tight">Ada</span>
          <span className="text-sm text-accent">Ada is writing a message…</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1.5 px-5 py-5">
        <MessageBubble direction="in" text="Is the blue one still available?" timeText="18:02" />
        <MessageBubble direction="out" text="It is. Pickup at the gate, 7pm." timeText="18:03" marker="R" />
        <MessageBubble direction="in" text="Great, see you then" timeText="18:04" />
        <MessageBubble direction="out" text="I'm outside" timeText="19:00" marker="D" />
      </div>
      <div className="flex items-center gap-2 border-t border-rule px-5 py-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-pill bg-paper-3 text-accent">
          <Icon name="bolt" />
        </span>
        <span className="flex-1 rounded-pill bg-paper-3 px-4 py-2.5 text-muted">Message</span>
      </div>
      <figcaption className="visually-hidden">A PinMe chat with read and delivered markers and a typing indicator.</figcaption>
    </figure>
  );
}
