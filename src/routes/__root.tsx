/// <reference types="vite/client" />
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { AppRuntime } from "../components/app/AppRuntime";
import appCss from "../styles.css?url";

/** Runs before hydration: returning devices skip the flash of the landing page while their chats load. */
const RETURNING_HINT = `try{if(localStorage.getItem("pinme:returning"))document.documentElement.dataset.returning="1"}catch(e){}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0f0a06" },
      { title: "PinMe: chat by PIN, not phone number" },
      {
        name: "description",
        content: "A web messenger where you chat by PIN instead of phone number, and can burn a PIN to cut off everyone who had it.",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Young+Serif&family=Instrument+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
    scripts: [{ children: RETURNING_HINT }],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function NotFoundComponent() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display">Nothing here.</h1>
      <p className="text-ink-2">The page or chat you asked for does not exist.</p>
      <Link to="/" className="btn btn--primary">
        Back to PinMe
      </Link>
    </main>
  );
}

function RootComponent() {
  return (
    <html lang="en" className="overflow-x-clip" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh overflow-x-clip bg-paper text-ink">
        <Outlet />
        <AppRuntime />
        <Scripts />
      </body>
    </html>
  );
}
