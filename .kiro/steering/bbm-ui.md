---
inclusion: fileMatch
fileMatchPattern: "src/{routes,components}/**"
---

# BBM-style UI rules

- Dark theme with blue accents via Tailwind tokens. Message and contact text must reach 4.5:1 contrast against its background.
- Contacts render as rounded rows: display picture (default placeholder when missing), display name, status dot, Personal_Message truncated to one line with ellipsis and fixed row height.
- Pending invites show accept and decline actions. Remove the invite within 1 s on success; keep it and show an error on failure.
- Chat bubbles: sent bubbles align right and carry Delivery_Markers (clock, D, R); received bubbles align left with no markers.
- Mobile-first layout usable from 320 px to 1920 px, no horizontal scrolling, all actions reachable.
- No BlackBerry logo and no exact copy of the BBM icon. Use original artwork.
- Respect `prefers-reduced-motion`: the Ghost_Animation and other motion must be disabled or reduced.
- Routes: home, chat by PIN, PIN manager, add contact. An unknown chat PIN shows a not-found panel with a link home.
- Use accessible markup: labels, focus states, and semantic buttons.
