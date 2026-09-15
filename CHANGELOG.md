# Changelog

All notable changes to this project are documented in this file.

## 0.5.1

### Changed
- **Card display duration: 15 s → 10 s** (`TOAST_SECONDS` constant in `index.js`). The claim window derives from it, so the ignored-approval GUI fallback moves from ≈18 s to ≈13 s (10 s + 3 s grace). The card still closes before the claim window expires, so the buttons remain live for the entire visible lifetime of the card.
- Fine-tuning knobs (unchanged): `TOAST_SECONDS` (display + fallback together) or `DSH_NOTIFY_CLAIM_MS` (fallback only, no reinstall).

## 0.5.0

### Added
- **Action buttons on the approval card**: 「拒绝」(outline capsule) and 「允许一次」(light primary capsule), right-aligned like the DSH GUI approval panel, styled with the DSH dark-theme tokens (primary fill `#F9FAFB` / text `#0F1115`; reject hover shows the danger tint, exactly like the GUI reject button)
- **In-place approval answering (claim-with-timeout)**: clicking a card button writes the outcome to `%TEMP%\dsh-tu4-notify-<token>.txt`; the host process polls the file and **claims** the `approval/request` waterfall with the same outcome vocabulary as the GUI buttons — `允许一次` → `allowed-once`, `拒绝` → `rejected`. The tool call proceeds / is denied identically to clicking the same buttons in the Web GUI.
- `notify.ps1` parameters: `-Token`, `-BtnReject`, `-BtnAllow` (button labels arrive via the UTF-16 command line — the script stays pure ASCII)

### Changed
- The listener is no longer fire-and-forget: it returns a Promise that resolves either with the card's outcome (claim) or, when the card is **ignored** (claim window = `TOAST_SECONDS` + 3 s grace) or the card **fails to launch** (immediate, with the `msg` fallback), with `next()`'s result — delegating to the host answerer. The approval flow can never hang.
- **Behavior note**: while the card is up (≈18 s), the Web GUI shows no pending approval entry; if the card is ignored the entry appears afterwards, exactly as in v0.4. Clicking the circular × still only dismisses the card (the GUI fallback takes over).
- Card height: 96 → 124 design px to fit the button row; body text shifts up slightly

### Technical Details
- Result IPC is a temp file polled every 150 ms (sandbox-friendly, no ports/pipes); stale files are cleaned up 2 s after the window settles; each approval gets a `crypto.randomUUID()` token
- Launch failure is detected via `execFile` spawn-level error codes (`EPERM`/`ENOENT`/`EACCES`) and delegates immediately
- `DSH_NOTIFY_CLAIM_MS` environment variable overrides the claim window (used by the smoke test)
- Smoke test extended: card-answer claim (both outcomes), claim-window timeout → delegate, launch failure → immediate delegate + msg fallback, non-Windows / aborted → delegate, end-to-end listener passthrough

## 0.4.0

### Added
- **Close button**: GDI+-drawn circular close button (25x25 pixels) in the top-right corner — gray circle with white X cross icon, hand cursor, click to dismiss immediately
- **Configurable display duration**: `TOAST_SECONDS` constant in `index.js` (default: 15 seconds)

### Changed
- Default display duration: 10s → 15s

### Technical Details
- Close button rendered via GDI+ Paint event (no text, no external image files, pure ASCII compatible)
- Gray circle background (#646468) with white X cross lines, anti-aliased
- `notify.ps1` height remains 96px, close button overlays at top-right

## 0.3.0

- **Renamed** from `dsh-approval-notify` to `dsh-tu4-notification` (open-source release; the plugin is functionally unchanged).
- Added DSH black whale logo to the notification card (white rounded-square plate, vector-rendered from the official DSH SVG path; no external image files).
- Card width increased to make room for the icon; title/body shift right accordingly.
- Added `-PreviewOut` parameter to `notify.ps1` for rendering the card to a PNG (used for the README preview and visual self-checks).
- Card layout finalized: 55px icon, vertically centered.

## 0.2.0

- Replaced the classic `msg` dialog with a dark WinForms toast card matching the DSH dark theme (`#151517` background, `#679EFE` brand-blue accent bar).
- Card shows for ~10 seconds, fades out over the last 800 ms, plays the system exclamation sound, and never steals focus (`WS_EX_NOACTIVATE` + foreground-window restore).
- DPI-aware via `SetProcessDPIAware()` / `GetDpiForSystem()`.
- Body text is truncated to 2 lines with an ellipsis.
- `msg.exe` dialog kept as an automatic fallback when the WinForms path fails.

## 0.1.0

- Initial release: `msg` system dialog + system sound when an agent operation awaits approval.
- Listens on the `approval/request` waterfall with `{ prepend: true }`; never blocks or alters the approval flow.
- Zero host dependencies; fire-and-forget error isolation.
