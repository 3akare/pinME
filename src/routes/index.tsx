import { createFileRoute } from "@tanstack/react-router";
import { useIdentityStore } from "../client/state/identity";
import { AppShell, type SheetName } from "../components/app/AppShell";
import { Landing } from "../components/landing/Landing";
import { seo } from "../shared/seo";

export const Route = createFileRoute("/")({
  head: () => seo({ path: "/" }),
  // `?sheet=code` opens My code (after onboarding); `?sheet=scan` opens the scanner.
  validateSearch: (search: Record<string, unknown>): { sheet?: SheetName } =>
    search.sheet === "code" || search.sheet === "scan" || search.sheet === "backup" || search.sheet === "group"
      ? { sheet: search.sheet }
      : {},
  component: Home,
});

/** Visitors without an identity on this device see the landing page; everyone else their chats. */
function Home() {
  const { sheet } = Route.useSearch();
  // AppRuntime boots the app; until it finds an identity (and with scripting off) this is the landing page.
  const identity = useIdentityStore((s) => s.identity);
  return identity ? <AppShell initialSheet={sheet} /> : <Landing />;
}
