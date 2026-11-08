import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { parseInvite } from "../shared/scan";
import { seo } from "../shared/seo";

export const Route = createFileRoute("/add")({
  head: () => seo({ title: "Add a contact", noindex: true }),
  // Older links: `/add?pin=XXXXXXXX` now goes through the connect link.
  validateSearch: (search: Record<string, unknown>): { pin?: string } =>
    typeof search.pin === "string" ? { pin: search.pin.slice(0, 16) } : {},
  component: Add,
});

/** Adding a contact is the scanner sheet on the chat list. */
function Add() {
  const { pin } = Route.useSearch();
  const navigate = useNavigate();
  useEffect(() => {
    const target = pin ? parseInvite(pin.toUpperCase()) : null;
    if (target) void navigate({ to: "/i/$pin", params: { pin: target.pin }, replace: true });
    else void navigate({ to: "/", search: { sheet: "scan" }, replace: true });
  }, [pin, navigate]);
  return null;
}
