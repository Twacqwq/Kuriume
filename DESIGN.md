---
name: Kuriume
description: Existing dark 栗梅 app and settings design.
colors:
  primary: "#904840"
  primary-foreground: "#fff8f6"
  primary-readable: "#d4938c"
  destructive: "#b44e4e"
  destructive-readable: "#ee8585"
  background: "#0d0d0f"
  foreground: "#f2efef"
  card: "#151416"
  secondary: "#242124"
  muted-foreground: "#9c9698"
  accent: "#292427"
  border: "#312d30"
  sidebar: "#111012"
typography:
  headline:
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "2.25rem"
    letterSpacing: "-0.025em"
  title:
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: "1.75rem"
    letterSpacing: "-0.025em"
  body:
    fontFamily: 'Manrope, "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: "1.25rem"
rounded:
  sm: "0.5rem"
  md: "0.625rem"
  lg: "0.75rem"
  xl: "1rem"
  2xl: "1rem"
spacing:
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "6": "1.5rem"
  "8": "2rem"
  "10": "2.5rem"
  "12": "3rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "36px"
  settings-navigation:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.xl}"
---

# Design System: Kuriume

## Overview

Kuriume uses a dark neutral palette with the confirmed 栗梅 accent, bundled Manrope and Chinese fallback fonts, and shadcn/ui components styled with Tailwind. Settings use compact groups, bold headings and actions, and minimal explanatory text. Desktop and mobile share colors, controls, and interaction states.

This is an extraction of the existing implementation, not a new visual direction. Sources: `src/main.css`, `src/fonts.css`, `src/components/ui/`, `src/components/sidebar.tsx`, `src/components/mobile-navigation.tsx`, and the two settings routes. Diagnostics behavior below is local to `/settings/logs`.

**Key Characteristics:**

- Dark tonal surfaces with the 栗梅 accent.
- Bundled Manrope and Noto Sans SC; bold headings and actions.
- Compact settings rows and concise bilingual labels.
- Shared controls and active navigation across desktop and mobile.

## Colors

### Primary

`primary` is the 栗梅 fill for primary actions and tinted active navigation. `primary-foreground` supplies text on that fill; `primary-readable` supplies lighter accent text, icons, and focus rings. Destructive controls use `destructive`; readable error text uses `destructive-readable`.

### Neutral

`background` is the app canvas, `card` groups settings rows, and `sidebar` separates navigation. `foreground` is the main text; `muted-foreground` carries supporting text and inactive icons. `secondary` is a neutral control fill, `accent` supplies hover surfaces, and `border` supplies dividers and field outlines. These are semantic roles from the stylesheet, not additional brand accents.

## Typography

The body font stack is shared throughout. Manrope and Noto Sans SC are bundled variable fonts; no runtime font download is needed. Headings and buttons use bold weight (700); setting labels use medium weight (500). The headline role describes desktop settings headings, the title role the mobile top bar, and the body/label roles compact interface text. Supporting metadata uses 12px/16px text; navigation has smaller labels where space requires them.

The logs heading is locally 24px/32px on mobile and uses the headline role from the medium breakpoint. Diagnostic text lines use the existing Tailwind monospace stack at 14px/24px and tabular numbers; timestamps are secondary and severity is bold.

## Layout

Settings centers a container capped at 768px; the diagnostic text stream uses a local 1024px cap to make error messages readable. Both include horizontal padding: 16px initially, 24px from 768px, and 40px from 1024px. Settings groups are separated by 32px. Settings rows have an 80px minimum height, 16px horizontal and 12px vertical padding, and 12px gaps. Controls can wrap or stack when the available width requires it.

The app uses a mobile top bar and four-item bottom navigation below 768px; at 768px the sidebar is 80px wide, expanding to 224px with horizontal labels at 1024px. Mobile chrome respects safe-area insets. Settings controls and diagnostics actions use 48px targets; the shared Button primitive retains its smaller size variants. Coarse-pointer rules expand button/select targets to at least 48px.

## Elevation & Depth

Settings groups use tonal separation and subtle dividers without card shadows. The app canvas has an existing faint accent radial wash. Inputs and outline buttons retain the small library shadow; alert dialogs use a larger shadow over a black overlay at 65% opacity. Exact shadow values are recorded in the sidecar.

## Shapes

The base radius is 12px. Shared controls use the derived medium radius, while settings groups use the 16px radius. Dividers use the border color at 60% opacity. The mobile active-navigation icon sits in a pill; these shapes already belong to the app shell.

## Components

### Buttons and fields

Reuse the existing `Button` variants and `Input`. Buttons have bold labels, 8px icon gaps, and 16px icons; default padding narrows horizontally when a direct SVG is present. Primary and secondary fills soften on hover; ghost actions gain an accent surface. Disabled controls reduce opacity to 50%. Buttons and inputs expose a 3px readable-accent focus ring; invalid fields use the readable destructive token. Existing state transitions use the Tailwind default timing.

### Settings groups and navigation

Settings groups place muted section labels above rounded card surfaces. Settings exposes display language and diagnostics only; low-use playback defaults are omitted while in-player controls and saved playback behavior remain unchanged. Labels and controls share a row. Active sidebar navigation uses a primary tint with a readable-accent icon; mobile navigation uses the same accent in its icon pill and label. Settings remains active on its child routes.

### Logs & diagnostics — local behavior

`/settings/logs` uses a chronological, selectable text stream of at most 50 entries per page. Each line shows a timestamp, `[INFO]`/`[WARN]`/`[ERROR]`, event/action, operation ID, safe error message and diagnostic fields without an expansion step. Long lines wrap on narrow screens. Refresh, pause/live updates, copy-page, clear, and All/Warnings & errors filters use existing buttons. Clear requires the existing alert-dialog confirmation; clipboard failure exposes selectable report text in a viewport-bounded dialog.

Loading skeletons, retryable errors, and empty/filter-empty states occupy the stream surface. Polling replaces the latest page without hiding existing content; scrolling upward stops automatic bottom-follow, and text selection, older pages or dialogs suspend polling. Status and severity have text labels as well as color. Loading animations honor reduced motion. Retention explanations and per-page instruction copy are omitted; counts, capacity and build metadata remain compact diagnostic context.

### Browse navigation — local behavior

Home and calendar use their existing skeletons only when no cached content is available. App startup prefetches both in the saved language; switching between warm tabs renders their cached data immediately. Expired data refreshes in the background without replacing posters or the schedule with a skeleton. Settings reuse the same process-local settings query. Chinese catalog titles use the bundled ID-based dictionary consistently across browsing, search and details, with the existing Japanese-first fallback for missing translations.

## Do's and Don'ts

### Do:

- Do reuse the existing semantic colors, bundled fonts, and shadcn/ui controls.
- Do keep explanatory text brief and preserve Chinese and English labels.
- Do retain visible focus, disabled, loading, error, and empty states where applicable.
- Do preserve the shared settings width, responsive padding, and 48px settings actions.

### Don't:

- Don't replace the confirmed dark 栗梅 palette or bundled font stack during a settings extension.
- Don't turn diagnostics pagination, retention copy, or detail layout into global app rules.
