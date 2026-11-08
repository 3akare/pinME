/**
 * Search and share metadata. One helper builds a route's title, description, canonical URL,
 * Open Graph tags (Discord, LinkedIn, Facebook, iMessage) and Twitter/X card tags, so every
 * shared link shows the same name, sentence and picture.
 */

export const SITE_URL = "https://pinme.bakaredavid007.workers.dev";
export const SITE_NAME = "PinMe";
export const DEFAULT_TITLE = "PinMe: chat by PIN, not phone number";
export const DEFAULT_DESCRIPTION =
  "Chat with anyone using an 8-character PIN instead of your phone number. End-to-end encrypted in your browser, and burn a PIN anytime to cut off everyone who had it.";
/** 1200x630 preview image (public/og.png). */
export const OG_IMAGE = { path: "/og.png", width: 1200, height: 630, alt: "PinMe: chat by PIN, not phone number. A PIN, 2A4F9C1B, with a ghost." };

export interface SeoInput {
  /** Page title; the site name is added unless it is the home page title. */
  title?: string;
  description?: string;
  /** Path for the canonical URL, e.g. "/". */
  path?: string;
  /** Private screens (chats, PINs, invite links) stay out of search results. */
  noindex?: boolean;
}

type Meta = { title: string } | { name: string; content: string } | { property: string; content: string };

export function seo(input: SeoInput = {}): { meta: Meta[]; links: { rel: string; href: string }[] } {
  const title = input.title ? `${input.title} – ${SITE_NAME}` : DEFAULT_TITLE;
  const description = input.description ?? DEFAULT_DESCRIPTION;
  const image = `${SITE_URL}${OG_IMAGE.path}`;
  const meta: Meta[] = [
    { title },
    { name: "description", content: description },
    { name: "robots", content: input.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "en_US" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: String(OG_IMAGE.width) },
    { property: "og:image:height", content: String(OG_IMAGE.height) },
    { property: "og:image:alt", content: OG_IMAGE.alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: OG_IMAGE.alt },
  ];
  const links: { rel: string; href: string }[] = [];
  if (input.path !== undefined && !input.noindex) {
    const url = `${SITE_URL}${input.path}`;
    meta.push({ property: "og:url", content: url });
    links.push({ rel: "canonical", href: url });
  }
  return { meta, links };
}

/** schema.org description of the app for search engines (JSON-LD). Facts only. */
export const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: DEFAULT_DESCRIPTION,
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Any (web browser)",
  browserRequirements: "Requires JavaScript and IndexedDB",
  isAccessibleForFree: true,
  image: `${SITE_URL}${OG_IMAGE.path}`,
  featureList: [
    "Chat by 8-character PIN instead of phone number or email",
    "End-to-end encryption in the browser with forward secrecy",
    "Several labelled PINs per person",
    "Burn a PIN to cut off everyone who had it",
    "Delivered and read markers, PING, typing indicator",
    "Group chats and broadcasts",
  ],
};
