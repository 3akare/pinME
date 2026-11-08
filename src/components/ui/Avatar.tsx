import { useEffect, useState } from "react";

/** Stable hue per name so avatars are told apart at a glance. */
const HUES = ["#2b5fd9", "#7c4ddb", "#c2410c", "#0f766e", "#b91c1c", "#4d7c0f", "#a21caf", "#0e7490"];
function hueFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length]!;
}

/** Picture when there is one, otherwise the first letter on a colored disc (original artwork). */
export function Avatar({ name, picture, size = 48 }: { name: string; picture?: Blob; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!picture) return;
    const u = URL.createObjectURL(picture);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [picture]);
  const style = { width: size, height: size };
  if (url) return <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />;
  return (
    <span
      aria-hidden="true"
      data-testid="avatar-placeholder"
      style={{ ...style, backgroundColor: hueFor(name), fontSize: size * 0.4 }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
