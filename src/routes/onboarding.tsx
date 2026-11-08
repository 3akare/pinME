import { Link, createFileRoute } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { PinShareCard } from "../components/pins/PinShareCard";
import { bootstrapApp, getLocalStore } from "../client/app/bootstrap";
import { generatePinKeys, randomBytes, ready } from "../client/crypto";
import { completeOnboarding } from "../client/onboarding/complete";
import { validateDisplayName, validatePicture } from "../client/onboarding/form";
import { useIdentityStore } from "../client/state/identity";
import { usePinsStore } from "../client/state/pins";
import { registerPinFn } from "../server/functions/pins";

export const Route = createFileRoute("/onboarding")({
  component: Onboarding,
});

function Onboarding() {
  const [displayName, setDisplayName] = useState("");
  const [picture, setPicture] = useState<File | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [pictureError, setPictureError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const identity = useIdentityStore((s) => s.identity);
  const pins = usePinsStore((s) => s.pins);
  const firstPin = pins.filter((p) => p.status === "active").sort((a, b) => a.createdAt - b.createdAt)[0];

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
      const [store] = await Promise.all([getLocalStore(), ready()]);
      const result = await completeOnboarding(
        {
          randomBytes,
          generatePinKeys,
          registerPin: (body) => registerPinFn({ data: body }),
          saveIdentityAndPin: (id, pin) =>
            store.transaction(["identity", "pins"], async (repos) => {
              await repos.identityRepo.put(id);
              await repos.pinRepo.put(pin);
            }),
        },
        { displayName, picture },
      );
      if (result.ok) {
        useIdentityStore.getState().setIdentity(result.identity);
        usePinsStore.getState().addPin(result.pin);
        // Connect right away so invites sent to the new PIN prompt on this screen.
        void bootstrapApp(true);
      } else if (result.kind === "validation") {
        setNameError(result.errors.displayName);
        setPictureError(result.errors.picture);
      } else {
        setFormError(result.message);
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // The identity and first PIN come from bootstrapApp (run by AppRuntime) when onboarding was already done.
  if (identity && firstPin) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center gap-4 p-6">
        <h1 className="text-2xl font-bold text-accent">You are set, {identity.displayName}</h1>
        <p className="text-center text-muted">
          Your {firstPin.label} PIN is <strong className="font-mono text-text">{firstPin.pin}</strong>. Show this code to
          someone you want to chat with. You can stay on this screen while they add you.
        </p>
        <PinShareCard pin={firstPin.pin} label={firstPin.label} />
        <Link
          to="/"
          className="rounded-xl bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Continue to contacts
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold text-accent">Welcome to PinMe</h1>
      <p className="mt-2 text-muted">Pick a name to get your first PIN. No phone or email needed.</p>
      <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label htmlFor="displayName" className="font-medium">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="nickname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-invalid={nameError ? true : undefined}
            aria-describedby="displayName-error"
            className="rounded-xl border border-border bg-surface px-3 py-2 text-text focus-visible:outline-2 focus-visible:outline-accent"
          />
          <p id="displayName-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-300">
            {nameError}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="picture" className="font-medium">
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
            className="text-sm text-muted file:mr-3 file:rounded-xl file:border-0 file:bg-surface file:px-3 file:py-2 file:text-text"
          />
          <p id="picture-hint" className="text-sm text-muted">
            Image files only, up to 256 KB.
          </p>
          <p id="picture-error" role="alert" aria-live="assertive" className="min-h-5 text-sm text-red-300">
            {pictureError}
          </p>
        </div>

        <p role="alert" aria-live="assertive" className="text-sm text-red-300">
          {formError}
        </p>

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-accent px-4 py-2 font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {busy ? "Creating..." : "Create my PIN"}
        </button>
      </form>
    </main>
  );
}
