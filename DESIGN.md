# Youtube Downloader

## Product and constraints
Local Windows utility for downloading a YouTube video as MP4 or MP3 (128/320 kbps). Portuguese interface. Preserve all existing operations, automatic search, direct folder saving, file list, duration totals and shutdown.

## Design Read
Operate surface, familiar dark desktop utility, Flask templates and plain CSS/JavaScript. Dials V3 M2 D7. Real video metadata and local files supply the content.

## Visual direction
Neutral opaque surfaces, readable secondary text, consistent controls, and literal empty-state copy. Preserve the main column location and the 300px folder panel to its right. Keep their bottom edges aligned. Preserve the close control above the folder panel at the height of the URL bar.

Explicit user exception: pink-to-purple gradients on Search, Download and Close were requested by the user. Retain the shared treatment, darkened for readable light button text. Do not replace it with the skill's default palette. Existing numbered instructions describe real sequential actions and remain above search as requested.

## Tokens
Refinement tokens live in static/refinement.css. The original stylesheet retains layout geometry; the refinement layer owns the updated surfaces and type. No additional UI framework.

```design-tokens
fonts: DM Sans, Manrope
colors: #101114, #18191e, #202127, #f4f2fa, #b3b1bd, #41424d, #d6a8d8, #b71f61, #9827a5, #7030bc
radii: 0, 6px, 8px, 9px, 14px, 15px
```

## Typography and spacing
Retain the font DM Sans for UI and the font Manrope for the title. Controls 12–14px, metadata 11px, section titles 16px, main title 28–44px. Tabular numbers for file sizes and duration. Use the existing panel padding and 22px column separation to preserve placement. Controls, thumbnails and panels have distinct corner radii.

## States and accessibility
Visible keyboard focus, dark-mode contrast, permanent progress track with waiting state, no decorative animations. Reduced-motion preference disables transitions. Disabled controls retain their state. No sample files or invented values.

## Layout constraint
The right-hand panel intentionally remains to the right on narrow viewports, accessible by horizontal scrolling, matching the user's explicit request to preserve panel positions. Do not stack or recenter panels without a subsequent layout request.

## Decision log
2026-10-28: Applied Antiwebslop to legibility and hierarchy, not functionality or layout. Removed ornamental background glow and generic placeholder copy. Kept the user's gradient preference. Retained original files as before-antiwebslop snapshots for visual rollback.

## Reference
User-provided reference and the established app in this conversation. Skill: https://github.com/cesaroeduardo/antiwebslop/tree/main/skills/antiwebslop.

### Verification notes
Browser checks at 1440×900, 768×1024 and 390×844. The folder panel remains right of the main panel and requires horizontal scrolling on smaller windows, as before. Desktop measured panel bottom edges both at 992.484375px; search and close controls both 69px tall. MP3 selection still exposes 128 and 320 kbps; real folder count and duration rendered correctly.
Lint exceptions: numbered instructions represent actual sequential steps, not decorative sections; em dashes in JavaScript are missing-value sentinels, not prose punctuation. Title wrapping is set in refinement.css. No new lint errors.

2026-10-28 layout correction: user requested alignment with the footer. Desktop now centers the combined 832px main column, 22px gap and 300px files column within a 1154px content area. Footer shares its outer edges. The columns remain side by side and the earlier fixed main-column placement constraint is superseded by this request.
