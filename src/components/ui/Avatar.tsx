import { useEffect, useState } from "react";

/** Picture when there is one, otherwise the initial in the display face on a lifted disc (original artwork). */
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
      style={{ ...style, fontSize: size * 0.42 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-paper-3 font-display text-ink"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
