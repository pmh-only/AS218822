---
name: AS218822 Network Console
description: Carbon-based public and operator telemetry
colors:
  background: "#161616"
  layer: "#262626"
  border: "#525252"
  text: "#f4f4f4"
  secondary-text: "#c6c6c6"
  link: "#78a9ff"
  outbound: "#3ddbd9"
  established: "#42be65"
  down: "#fa4d56"
  missing: "#6f6f6f"
  observed: "#a56eff"
  focus: "#ffffff"
typography:
  page:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "2.625rem"
    fontWeight: 300
    lineHeight: 1.2
  section:
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.3
  panel:
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontSize: "0.75rem"
rounded:
  panel: "0px"
spacing:
  grid-gap: "1rem"
  panel-padding: "1.25rem"
  heading-gap: "1.5rem"
  section-gap: "3.5rem"
components:
  panel:
    backgroundColor: "{colors.layer}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel-padding}"
---

# Design System: AS218822 Console

## Overview

The console inherits Carbon g100 rather than introducing a separate visual
identity. It is an operational surface: dense, precise, restrained, and built
around reading measurements. Carbon supplies controls, typography, tables, tags,
and charts. Custom styling supplies composition and responsive behavior.

## Colors

Neutral layers separate the document, panels, and table headers. Blue identifies
links and inbound traffic; teal identifies outbound traffic. Green/red identify
measured up/down states, with text labels alongside them. Gray means unknown,
missing, or stale rather than healthy. Purple remains part of the inherited
topology/chart palette and identifies authenticated operator access.

Use the runtime `--cds-*` tokens for UI chrome so Carbon's layer context remains
authoritative. Explicit chart colors are semantic series mappings, not decorative
panel accents.

## Typography

Use the inherited IBM Plex Sans stack. The hierarchy steps from a light page
heading to regular section headings, medium panel headings, compact body text,
and labels. Tabular numerals apply throughout telemetry. Prose descriptions stay
within 75 characters where practical; tables retain operational density.

At the mobile breakpoint, page and section headings become 2rem and 1.5rem. Data
and field labels do not scale fluidly with the viewport. Monospace is reserved for
literal values such as the registered origin prefix.

## Layout

The page has a maximum width of 112rem and a twelve-column panel grid with fixed
gaps. A fixed Carbon header sits above sticky section navigation and refresh/time
controls. Related measurements share a panel; section headings introduce larger
changes of task. Wide tables scroll within a keyboard-focusable region, never by
widening the page.

At 82rem, navigation and controls occupy separate rows and summaries use three
columns. At 66rem, chart panels stack. At 42rem, summaries use two columns,
controls reflow, and history labels move above their tracks. Narrow viewports
retain the same information and access boundaries as desktop.

## Elevation & Depth

Panels are flat tonal layers with square corners. The inherited topology nodes
use a soft offset shadow inside their canvas. Do not extend topology shadows to
ordinary metrics or tables. Sticky controls use a solid background, not blur.

## Shapes

Panels, controls, charts, and tables use Carbon's rectilinear forms. Carbon tags
retain their pill shape for categorical state. Small square history cells encode
sampled states; they are data, not a decorative texture.

## Components

- Carbon buttons, select fields, switches, and search inputs retain their native
  interaction and focus behavior. Disabled refresh indicates an active request.
- Metric strips use a compact label, a tabular reading, and a measurement qualifier.
- Panels use a semantic heading and a short description before a visualization.
- Charts disable animation, format units consistently, leave missing samples as
  gaps, and provide an expandable, searchable data table.
- History tracks have a text legend, accessible row summaries, and inspectable
  timestamped samples. Their colors never replace the data-table alternative.
- Tables provide sorting, search where useful, pagination, and local horizontal
  scrolling. Resource detail disclosures reveal lower-priority fields inline.
- State tags distinguish unavailable/stale data from a measured negative result.
- Reduced-motion preferences disable dashboard transitions and animation.

## Do's and Don'ts

- Do preserve Carbon's component grammar and the existing network terminology.
- Do show measurement units, time windows, data freshness, and coverage limits.
- Do use semantic HTML, visible focus, and table alternatives to graphs.
- Do keep private and public content visually coherent while labeling access.
- Don't show an absent measurement as zero or a stale measurement as live.
- Don't add decorative motion, invented reliability claims, or a new brand system.
