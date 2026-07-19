# Changelog

## 2026-07-18 — Mobile-friendly week view: swipeable single-day layout

**The goal:** the same live site (no separate app) should adapt to phone
width the way most responsive sites do — the desktop Week view crams 5 day
columns + a time gutter into one row, which is unreadable on a phone.

Before: the unmodified desktop layout on an actual phone, via the live site.

![Full page on a phone: header stats and load chart cut off on the right edge](docs/screenshots/Mobile%20responsive/05-mobile-before-1.jpg)
![5-day week grid squeezed onto a phone screen, illegible](docs/screenshots/Mobile%20responsive/06-mobile-before-2.jpg)
![Add-task form fields cut off on the right edge of the phone screen](docs/screenshots/Mobile%20responsive/07-mobile-before-3.jpg)

**The fix:** below a phone-width breakpoint, the Week view's 5-day grid
becomes a single day at a time, using CSS scroll-snap so it swipes like a
native carousel, with the time-of-day gutter pinned to the left edge
(`position: sticky`) so the hours stay visible no matter which day is in
view. New `‹ Day` / `Day ›` buttons step through days for anyone not
swiping. Getting there took a few rounds:

1. The sticky gutter visually covers the first 42px of the viewport, but
   `element.offsetLeft` — used to restore/target a day's scroll position —
   measures relative to the nearest *positioned* ancestor, and nothing
   between the grid and `<body>` had `position` set. It was climbing the
   whole tree and picking up unrelated ancestor padding, so "Monday" landed
   partly hidden behind the gutter.

   ![Monday's label partly hidden behind the sticky time gutter, reads "lay Jul 20"](docs/screenshots/Mobile%20responsive/08-mobile-gutter-overlap.png)

2. Switching the math to `getBoundingClientRect()` (immune to ancestor
   positioning) fixed the resting position, but CSS `scroll-snap-align` was
   still fighting it — snap alignment has no built-in awareness of a sticky
   overlay, so it kept re-snapping columns back to the hidden position.
   `scroll-padding-left` was the actual fix: it tells the snap machinery
   the scrollport's effective edge is 42px in, not 0.

   ![Cutoff persists after a partial fix, with a sliver of Tuesday visible on the right](docs/screenshots/Mobile%20responsive/09-mobile-snap-misalign.png)

3. Separately, each day column was sized to a full `100%`, *plus* the 42px
   gutter alongside it — 42px wider than the screen on every day. Fixed by
   sizing columns to `calc(100% - 42px)` instead.

4. Once the Week view itself was solid, shrinking the browser below ~570px
   revealed a different, page-wide bug: several rows (nav buttons + week
   label, backlog rows, today's checklist) were missing `flex-wrap`, and —
   the real culprit — `.panel` had no `min-width: 0`. Flex/grid items
   default to `min-width: auto` ("never shrink below your content's natural
   size"), so one wide-enough child anywhere inside a panel stopped that
   whole panel, and the page along with it, from shrinking any further.

   ![Add-task form's "People" field cut off at a hard width floor](docs/screenshots/Mobile%20responsive/10-mobile-panel-blowout.png)

5. The Month view had the exact same `min-width: auto` blowout as #4, just
   on a `display: grid` track instead of a flex item — CSS grid's `1fr`
   tracks default to the same "never shrink below content" behavior. The
   task chips use `white-space: nowrap` (needed for their `text-overflow:
   ellipsis` truncation to work at all), so their *full, untruncated* text
   width became each column's minimum — 5 columns wide enough for "Work
   Area - MER / Inspection 1Y" is far wider than a phone screen. Same fix:
   `min-width: 0` on the grid item (`.month-cell`, `.month-head-cell`). The
   day-of-week headers ("Wednesday") also got a mobile-only abbreviation to
   "Wed", since a single unbreakable word that long is still cramped once
   the column is actually allowed to shrink to 1/5 of a phone's width.

   ![Month view overflowing the screen, cut off on both edges](docs/screenshots/Mobile%20responsive/12-month-view-overflow.png)

After all five fixes, verified on both a real phone and Safari's Responsive
Design Mode across several device widths:

![Clean single-day Week view on a phone, Friday's tasks fully visible, nothing cut off](docs/screenshots/Mobile%20responsive/11-mobile-fixed.png)
![Clean Month view on a phone, abbreviated day headers, all 5 columns fitting the screen](docs/screenshots/Mobile%20responsive/13-month-view-fixed.png)

## 2026-07-18 — Week view: fixed overlapping time labels and scroll trapping

**The bug:** on the Schedule tab's Week view, Monday's hour labels (8:00 AM,
9:00 AM, ...) were rendered inside the same column as the "+ Flex" buttons,
so free hours showed both texts jumbled on top of each other.

![Time labels overlapping "+ Flex" text on Monday](docs/screenshots/Calendar%20overlap/01-overlap-bug.png)

**The fix:** moved the hour labels out of Monday's column into a single
shared time gutter on the left edge of the week grid, so no day column ever
renders label text again — it's just start times and task/flex blocks.

That surfaced two follow-on issues while testing:

1. The week grid started capturing vertical scroll (scrolling over it
   scrolled *inside* the grid instead of the page). Cause: `.week-grid` had
   `overflow-x: auto` with no `overflow-y` set, and per the CSS spec a
   scrollable x-axis silently forces the y-axis to `auto` too — a few
   pixels of label overflow past the bottom edge was enough to trigger it.

   ![Gutter fix applied, but "5:00 PM" barely visible, clipped at the bottom edge](docs/screenshots/Calendar%20overlap/02-gutter-fix-overflow.png)

2. Fixing that with `overflow-y: hidden` correctly stopped the scroll
   trapping, but also clipped the "5:00 PM" label, which had been
   positioned to hang past the bottom boundary.

   ![Week view with "5:00 PM" label missing entirely](docs/screenshots/Calendar%20overlap/03-label-clipped.png)

Re-anchoring that last label to the *bottom* of the box (`bottom: 0`)
instead of a top offset past the boundary fixed it for good — it now
renders fully inside the grid, no overflow, no scroll trapping.

![Final result: clean time gutter, "5:00 PM" fully visible, no overlap](docs/screenshots/Calendar%20overlap/04-fixed.png)
