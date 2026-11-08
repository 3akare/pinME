import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createIdentity } from "../client/app/identity";
import { validateDisplayName, validatePicture } from "../client/onboarding/form";
import { useIdentityStore } from "../client/state/identity";

export const Route = createFileRoute("/onboarding")({
  component: Onboarding,
});

/** One screen: a name (and a picture if you like), then straight to your chats with your code open. */
function Onboarding() {
  const navigate = useNavigate();
  const identity = useIdentityStore((s) => s.identity);
  const [displayName, setDisplayName] = useState("");
  const [picture, setPicture] = useState<File | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [pictureError, setPictureError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Already set up on this device: nothing to do here.
  useEffect(() => {
    if (identity && !busy) void navigate({ to: "/", replace: true });
  }, [identity, busy, navigate]);

  function onPictureChange(file: File | null) {
    const error = validatePicture(file);
    setPictureError(error);
    if (error) {
      // Reject the picture but keep the typed display name.
      setPicture(null);
      if (fileRef.current) fileRef.current.value = "";
    } else {
      setPicture(file);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormError(undefined);
    const nErr = validateDisplayName(displayName);
    const pErr = validatePicture(picture);
    setNameError(nErr);
    setPictureError(pErr);
    if (nErr || pErr) return;

    setBusy(true);
    try {
      const result = await createIdentity({ displayName, picture });
      if (result.ok) {
        void navigate({ to: "/", search: { sheet: "code" } });
        return;
      }
      if (result.kind === "validation") {
        setNameError(result.errors.displayName);
        setPictureError(result.errors.picture);
      } else {
        setFormError(result.message);
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-dvh flex-col bg-paper">
      <div className="container flex h-16 items-center">
        <Link to="/" className="font-display text-2xl text-ink no-underline">
          PinMe
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <h1 className="text-[length:var(--text-display-s)]">Pick a name.</h1>
          <p className="lead mt-4 text-ink-2">No phone number, no email. Your first PIN is made on this device.</p>
          <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="displayName" className="text-sm font-medium text-ink-2">
                Display name
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                autoComplete="nickname"
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                aria-invalid={nameError ? true : undefined}
                aria-describedby="displayName-error"
                className="field"
              />
              <p id="displayName-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-error">
                {nameError}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="picture" className="text-sm font-medium text-ink-2">
                Display picture (optional)
              </label>
              <input
                id="picture"
                name="picture"
                type="file"
                accept="image/*"
                ref={fileRef}
                onChange={(e) => onPictureChange(e.target.files?.[0] ?? null)}
                aria-invalid={pictureError ? true : undefined}
                aria-describedby="picture-hint picture-error"
                className="text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-pill file:border-0 file:bg-paper-3 file:px-4 file:py-2 file:text-ink hover:file:bg-rule"
              />
              <p id="picture-hint" className="text-sm text-muted">
                Image files only, up to 256 KB.
              </p>
              <p id="picture-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-error">
                {pictureError}
              </p>
            </div>

            <p role="alert" aria-live="assertive" className="text-sm text-error empty:hidden">
              {formError}
            </p>

            <button type="submit" disabled={busy} aria-busy={busy || undefined} className="btn btn--primary self-start">
              {busy ? "Creating…" : "Create my PIN"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
