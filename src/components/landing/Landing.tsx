import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Ghost } from "../ui/Ghost";
import { Icon } from "../ui/Icon";
import { BurnDemo } from "./BurnDemo";
import { ChatDemo } from "./ChatDemo";

const PINS = [
  { label: "Friends", pin: "7C1E04A9", use: "People you would text anyway" },
  { label: "Marketplace", pin: "2A4F9C1B", use: "Sellers and dispatch riders" },
  { label: "Hackathon", pin: "5D90B3E2", use: "One weekend, then burn it" },
];

const SERVER: { what: string; sees: boolean }[] = [
  { what: "What your messages say", sees: false },
  { what: "Your private keys", sees: false },
  { what: "A phone number or email", sees: false },
  { what: "Display names and public keys", sees: true },
  { what: "Which PINs exist, and which are burned", sees: true },
  { what: "Who is connected to whom", sees: true },
  { what: "Message sizes and timing", sees: true },
];

const QUESTIONS = [
  {
    q: "Is there forward secrecy?",
    a: "No. Messages use long-lived keys per PIN, so someone who later steals a key could read messages they captured earlier.",
  },
  {
    q: "What if I lose my device?",
    a: "Your keys and chats live only in this browser. Clearing its data or losing the device loses them; there is no backup yet.",
  },
  {
    q: "Does burning delete what they already have?",
    a: "No. A contact keeps whatever reached their device before the burn. Burning stops anything new.",
  },
];

/** Bar that slides away while reading down and returns on the way up. */
function useRetracted(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > 120 && y > last);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return hidden;
}

/** The public page for anyone without a PinMe identity on this device. */
export function Landing() {
  const retracted = useRetracted();
  return (
    <div data-landing className="bg-paper text-ink">
      <header
        data-retracted={retracted || undefined}
        className="sticky top-0 z-[300] bg-paper/95 backdrop-blur transition-transform duration-[var(--dur-short)] ease-[var(--ease-out)] data-[retracted]:-translate-y-full"
      >
        <p className="border-b border-rule py-2 text-center text-sm text-ink-2">
          BBM-style PINs, brought back for Kiroween.
        </p>
        <nav aria-label="Main" className="container flex h-16 items-center gap-6">
          <Link to="/" className="font-display text-2xl text-ink no-underline">
            PinMe
          </Link>
          <a href="#burn" className="link ml-auto hidden text-sm no-underline hover:underline sm:inline">
            How burning works
          </a>
          <a href="#server" className="link hidden text-sm no-underline hover:underline sm:inline">
            What we can see
          </a>
          <Link to="/onboarding" className="btn btn--quiet btn--sm ml-auto sm:ml-0">
            Get your PIN
          </Link>
        </nav>
      </header>

      <main>
        <section
          aria-labelledby="hero-title"
          className="container grid min-h-[calc(100dvh-6.5rem)] grid-cols-1 items-center gap-y-10 py-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-x-[var(--space-3xl)]"
        >
          <div className="flex flex-col gap-6">
            <h1 id="hero-title">Chat by PIN, not phone number.</h1>
            <p className="lead text-ink-2">Burn a PIN anytime and everyone who had it is ghosted.</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/onboarding" className="btn btn--primary">
                Get your PIN
              </Link>
              <a href="#burn" className="btn btn--quiet">
                How burning works
              </a>
            </div>
          </div>
          <BurnDemo />
        </section>

        <section aria-labelledby="number-title" className="container grid grid-cols-1 gap-x-[var(--gap-columns)] gap-y-8 py-[var(--section-gap-s)] lg:grid-cols-12">
          <h2 id="number-title" className="lg:col-span-5">
            Your number is tied to everything.
          </h2>
          <dl className="border-t border-rule lg:col-span-7">
            <div className="grid grid-cols-1 gap-2 border-b border-rule py-6 sm:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
              <dt className="font-display text-[length:var(--text-title)]">Your phone number</dt>
              <dd className="text-ink-2">Linked to your NIN, your BVN, bank OTPs and mobile money. Every stranger who has it holds a key to all of that.</dd>
            </div>
            <div className="grid grid-cols-1 gap-2 border-b border-rule py-6 sm:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
              <dt className="font-display text-[length:var(--text-title)]">A PinMe PIN</dt>
              <dd className="text-ink-2">Eight characters, linked to nothing else. Hold up to twenty, one for each part of your life.</dd>
            </div>
            <div className="grid grid-cols-1 gap-2 border-b border-rule py-6 sm:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
              <dt className="font-display text-[length:var(--text-title)]">Your email</dt>
              <dd className="text-ink-2">Not needed either. A name is all PinMe asks for.</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="chat-title" className="container grid grid-cols-1 items-center gap-x-[var(--space-3xl)] gap-y-10 py-[var(--section-gap-s)] md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <ChatDemo />
          <div className="flex flex-col gap-6 md:order-first md:col-start-2 md:row-start-1">
            <h2 id="chat-title">The parts BBM got right.</h2>
            <ul className="flex flex-col border-t border-rule">
              <li className="border-b border-rule py-4 text-ink-2">
                <span className="text-ink">D</span> when it lands, <span className="text-accent">R</span> when it is read.
              </li>
              <li className="border-b border-rule py-4 text-ink-2">PING shakes their screen, once every ten seconds at most.</li>
              <li className="border-b border-rule py-4 text-ink-2">You see when they are writing a message.</li>
              <li className="border-b border-rule py-4 text-ink-2">Encrypted in your browser. The server only relays ciphertext.</li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="pins-title" className="container py-[var(--section-gap-s)]">
          <h2 id="pins-title" className="mb-8">
            One you, a PIN for each place.
          </h2>
          <table className="w-full border-collapse text-left">
            <caption className="visually-hidden">Example PINs and what each one is for</caption>
            <thead>
              <tr className="border-b border-rule text-sm text-muted">
                <th scope="col" className="py-3 font-medium">
                  Label
                </th>
                <th scope="col" className="py-3 font-medium">
                  PIN
                </th>
                <th scope="col" className="hidden py-3 font-medium sm:table-cell">
                  Shared with
                </th>
              </tr>
            </thead>
            <tbody>
              {PINS.map((p) => (
                <tr key={p.pin} className="border-b border-rule">
                  <th scope="row" className="py-5 font-normal">
                    <span className="block font-display text-[length:var(--text-title)]">{p.label}</span>
                    <span className="mt-1 block text-sm text-muted sm:hidden">{p.use}</span>
                  </th>
                  <td className="py-5 font-display text-[length:var(--text-title)] text-ink-2 [font-variant-numeric:lining-nums_tabular-nums]">
                    {p.pin}
                  </td>
                  <td className="hidden py-5 text-ink-2 sm:table-cell">{p.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section
          id="burn"
          aria-labelledby="burn-title"
          className="container grid grid-cols-1 items-center gap-x-[var(--space-3xl)] gap-y-10 py-[var(--section-gap)] md:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]"
        >
          <div className="flex flex-col gap-8">
            <h2 id="burn-title">Burn a PIN and it is gone for good.</h2>
            <dl className="border-t border-rule">
              {[
                ["Its chats", "Close on both sides"],
                ["Everyone who only had it", "Loses you, and never learns who you are"],
                ["The PIN itself", "Is never issued again"],
                ["What they already saved", "Stays on their phone. Burning stops anything new"],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-1 gap-1 border-b border-rule py-4 sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] sm:gap-4">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <figure className="grained m-0 flex min-h-[440px] flex-col justify-between gap-6 rounded-card bg-paper-2 p-8 [container-type:inline-size] sm:p-10">
            <figcaption className="relative z-[2] text-ink-2">Hackathon PIN, after the weekend</figcaption>
            <div className="relative z-[2] flex items-center gap-[6cqw]">
              <p
                aria-label="PIN 5D90B3E2, burned"
                className="font-display text-[19cqw] leading-[0.86] text-muted line-through decoration-[0.06em] [font-variant-numeric:lining-nums_tabular-nums]"
              >
                <span className="block">5D90</span>
                <span className="block">B3E2</span>
              </p>
              <Ghost className="w-[20cqw] shrink-0 text-ink" />
            </div>
            <p className="relative z-[2] border-t border-rule pt-4 text-sm text-ink-2">Burned. Nobody who had it can reach you.</p>
          </figure>
        </section>

        <section id="server" aria-labelledby="server-title" className="grained bg-paper-2 py-[var(--section-gap-s)]">
          <div className="container relative z-[2] flex flex-col gap-12">
            <h2 id="server-title">What the server can see.</h2>
            <div className="grid grid-cols-1 gap-x-[var(--gap-columns)] gap-y-12 md:grid-cols-2">
              {[
                { figure: "Never", rows: SERVER.filter((x) => !x.sees), ink: "text-ink" },
                { figure: "Yes", rows: SERVER.filter((x) => x.sees), ink: "text-ink-2" },
              ].map((col) => (
                <div key={col.figure}>
                  <p className="font-display text-[length:var(--text-display)] leading-none">{col.figure}</p>
                  <ul className="mt-6 border-t border-rule">
                    {col.rows.map((x) => (
                      <li key={x.what} className={`border-b border-rule py-4 ${col.ink}`}>
                        {x.what}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-title" className="container grid grid-cols-1 gap-x-[var(--gap-columns)] gap-y-8 py-[var(--section-gap-s)] lg:grid-cols-12">
          <h2 id="faq-title" className="lg:col-span-5">
            Where the encryption stops.
          </h2>
          <div className="border-t border-rule lg:col-span-7">
            {QUESTIONS.map((x) => (
              <details key={x.q} className="group border-b border-rule">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-display text-[length:var(--text-title)] transition-colors duration-[var(--dur-micro)] hover:text-accent-2 focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
                  {x.q}
                  <span aria-hidden="true" className="text-muted transition-transform duration-[var(--dur-short)] group-open:rotate-45">
                    <Icon name="close" className="h-5 w-5 rotate-45" />
                  </span>
                </summary>
                <p className="pb-6 text-ink-2">{x.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="container flex flex-col gap-10 py-[var(--space-3xl)]">
          <p className="max-w-[20ch] font-display text-[length:var(--text-section)] leading-[1.05]">
            Give out a PIN. Keep your number.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link to="/onboarding" className="btn btn--primary">
              Get your PIN
            </Link>
            <a href="#burn" className="link text-sm">
              How burning works
            </a>
            <a href="#server" className="link text-sm">
              What we can see
            </a>
            <a href="https://github.com/3akare/pinME" className="link text-sm">
              Source on GitHub
            </a>
          </div>
          <p className="text-sm text-muted">Inspired by BlackBerry Messenger. Not affiliated with BlackBerry.</p>
        </div>
      </footer>
    </div>
  );
}
