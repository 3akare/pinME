/// <reference types="vite/client" />
import { HeadContent, Link, Outlet, Scripts, createRootRoute, useRouterState } from "@tanstack/react-router";
import { useContactsStore } from "../client/state/contacts";
import { AppRuntime } from "../components/app/AppRuntime";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "PinMe" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

const NAV_LINKS = [
  { to: "/", label: "Contacts" },
  { to: "/add", label: "Add" },
  { to: "/pins", label: "My PINs" },
  { to: "/broadcast", label: "Broadcast" },
] as const;

function AppNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pendingInvites = useContactsStore((s) => s.pendingInvites.length);
  // The chat screen fills the viewport and has its own Back link; onboarding precedes identity.
  if (pathname.startsWith("/chat/") || pathname === "/onboarding") return null;
  return (
    <nav aria-label="Main" className="border-b border-border bg-surface">
      <ul className="mx-auto flex w-full max-w-2xl flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-sm">
        {NAV_LINKS.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              activeOptions={{ exact: true }}
              className="inline-block rounded-lg px-2 py-1 text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
              activeProps={{ className: "text-accent font-semibold", "aria-current": "page" }}
            >
              {l.label}
              {l.to === "/" && pendingInvites > 0 ? (
                <span className="ml-1.5 rounded-full bg-accent px-1.5 text-xs font-bold text-on-accent">
                  {pendingInvites}
                  <span className="sr-only"> pending {pendingInvites === 1 ? "invite" : "invites"}</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NotFoundComponent() {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-2xl font-bold text-accent">404 - Not Found</h1>
      <p className="mt-2 text-muted">The page or resource you requested could not be found.</p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Return to Contacts
      </Link>
    </main>
  );
}

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-text min-h-screen">
        <AppNav />
        <Outlet />
        <AppRuntime />
        <Scripts />
      </body>
    </html>
  );
}

