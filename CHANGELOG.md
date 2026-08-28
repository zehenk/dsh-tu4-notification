# Changelog

All notable changes to this project are documented in this file.

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
