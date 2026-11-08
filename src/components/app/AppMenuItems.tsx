import { useEffect, useState } from "react";
import { disablePush, enablePush, pushState, type PushState } from "../../client/app/push";
import { useInstallStore } from "../../client/state/install";
import { usePinsStore } from "../../client/state/pins";
import { Icon } from "../ui/Icon";

const ITEM =
  "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-ink hover:bg-paper-3 focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55";

/** Turns wake-up notifications on or off; the label always says what is true now. */
export function NotificationsItem() {
  const pins = usePinsStore((s) => s.pins);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void pushState(pins).then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [pins]);

  if (state === null || state === "unsupported" || state === "unconfigured") return null;

  async function toggle() {
    setBusy(true);
    try {
      if (state === "on") {
        await disablePush(pins);
        setState(await pushState(pins));
      } else {
        setState(await enablePush(pins));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={ITEM} disabled={busy || state === "blocked"} onClick={() => void toggle()}>
      <Icon name="bell" />
      <span className="flex flex-col">
        <span>{state === "on" ? "Notifications on" : "Turn on notifications"}</span>
        <span className="text-xs text-muted">
          {state === "blocked"
            ? "Blocked in your browser settings"
            : state === "on"
              ? "Tap to turn off"
              : "A buzz when something arrives"}
        </span>
      </span>
    </button>
  );
}

/** Offers installing PinMe as an app where the browser allows it. */
export function InstallItem() {
  const prompt = useInstallStore((s) => s.prompt);
  if (!prompt) return null;
  return (
    <button
      type="button"
      className={ITEM}
      onClick={() => {
        void prompt.prompt();
        void prompt.userChoice.finally(() => useInstallStore.getState().setPrompt(null));
      }}
    >
      <Icon name="install" /> Install PinMe
    </button>
  );
}
