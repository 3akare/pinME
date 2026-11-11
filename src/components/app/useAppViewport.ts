import { useEffect } from "react";

/** The visible area is this much shorter than the window: an on-screen keyboard is up. */
const KEYBOARD_MIN_PX = 120;

/**
 * Fits the messenger frame to what is actually visible, so the header stays on screen and the
 * composer sits right above the on-screen keyboard.
 *
 * Chrome and Firefox on Android resize the layout themselves (`interactive-widget=resizes-content` in
 * the viewport meta). iOS Safari does not, in a tab or installed: the keyboard only shrinks the visual
 * viewport and Safari pans the page to reveal the field. There the frame follows `visualViewport`:
 * `--vv-height` and `--vv-top` size and place it over exactly what is visible.
 *
 * While mounted the document itself never scrolls (`html.app-locked`); only the panes inside do.
 */
export function useAppViewport(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("app-locked");
    const vv = window.visualViewport;
    let frame = 0;

    const clear = () => {
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-top");
      root.removeAttribute("data-keyboard");
    };

    const apply = () => {
      frame = 0;
      // Pinch zoom also shrinks the visual viewport: the frame must not follow that.
      if (!vv || Math.abs(vv.scale - 1) > 0.01) return clear();
      root.style.setProperty("--vv-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--vv-top", `${Math.max(0, Math.round(vv.offsetTop))}px`);
      root.toggleAttribute("data-keyboard", window.innerHeight - vv.height > KEYBOARD_MIN_PX);
      // iOS may still scroll the (locked) document to reveal the field; undo it.
      if (window.scrollY !== 0 && vv.offsetTop === 0) window.scrollTo(0, 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      root.classList.remove("app-locked");
      clear();
    };
  }, []);
}
