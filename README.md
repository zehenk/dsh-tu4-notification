# dsh-tu4-notification

> A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin that pings you on Windows the instant an agent operation awaits approval — and lets you approve or deny right from the notification card.
>
> DSH（DeepSeek Harness）插件：agent 操作需要审批的瞬间，在 Windows 上弹出带 DSH 黑鲸鱼 logo 的深色通知卡片，卡片上可直接点击「拒绝」/「允许一次」应答审批（与 Web GUI 同名按钮效果一致）。
>
> 📦 [github.com/zehenk/dsh-tu4-notification](https://github.com/zehenk/dsh-tu4-notification) ｜ [Issues](https://github.com/zehenk/dsh-tu4-notification/issues) ｜ [Changelog](CHANGELOG.md) ｜ [MIT](LICENSE)

When any agent operation requires approval (sandbox escalation, file access, …), DSH parks the request **pending** until you answer it in the Web GUI. If you've switched to another app, you miss it. This plugin fires a native Windows card the moment the approval becomes pending — and the card now carries **「拒绝」/「允许一次」buttons that answer the approval in place**, exactly like the same buttons in the Web GUI. Ignore the card (or let it fade) and the request falls back to the Web GUI, as before.

当任何 agent 操作需要审批（沙箱权限提升、文件访问等），DSH 会把请求挂起（**pending**），等你在 Web GUI 里应答。如果你切到了别的软件，就会错过。本插件在审批进入 pending 的瞬间弹出 Windows 原生深色卡片——卡片上带 **「拒绝」/「允许一次」按钮，可直接当场应答审批**，效果与 Web GUI 里的同名按钮完全一致。忽略卡片（或等它淡出），请求会回退到 Web GUI 处理，和以前一样。

## Preview / 预览

![Notification card preview](assets/card-preview.png)

Dark card, bottom-right of the primary monitor: brand-blue accent bar, white rounded-square plate with the official **DSH black whale** logo, title + truncated body, a right-aligned **拒绝 / 允许一次** button row (styled like the DSH GUI approval panel), and a circular close button in the top-right corner. Plays a sound, fades out after 15 s, **never steals focus**.

深色卡片，主屏右下角：品牌蓝强调条、白底圆角方块内嵌官方 **DSH 黑鲸鱼** logo、标题 + 截断正文、右对齐的 **拒绝 / 允许一次** 按钮行（样式与 DSH GUI 审批面板一致）、右上角圆形关闭按钮。带提示音，15 秒后淡出，**绝不抢焦点**。

## Features / 特性

- **Action buttons** — right-aligned **拒绝** (outline) + **允许一次** (primary) capsules, styled with the DSH dark-theme tokens; clicking one answers the approval in place with the same outcome as the GUI buttons (`rejected` / `allowed-once`)
- **Close button** — GDI+-drawn circular icon (25x25 px, gray circle + white X cross) in the top-right corner, click to dismiss immediately
- **Configurable display duration**: Adjust `TOAST_SECONDS` constant in `index.js` (default: 15 seconds)
- **Dark toast card** matching the DSH dark theme (`#151517` + brand-blue `#679EFE` accent), rendered with WinForms — no third-party dependencies
- **DSH black whale logo** drawn as vector graphics (official SVG path embedded in the script — crisp at any DPI, no image file)
- **Sound** on show (`SystemSounds.Exclamation`)
- **No focus steal** (double-protected: `WS_EX_NOACTIVATE` + foreground-window restore)
- **Auto-dismiss** after configurable duration with an 800 ms fade; if ignored, the request falls back to the Web GUI
- **DPI-aware** (crisp at 200%+)
- **`msg.exe` fallback** if the WinForms path fails — the notification never silently dies
- **Never blocks**: the approval flow always settles — via the card, or by delegation to the host answerer; failures are logged and swallowed

- **操作按钮** — 右对齐的 **拒绝**（描边胶囊）+ **允许一次**（主色胶囊），采用 DSH 暗色主题令牌配色；点击即当场应答审批，outcome 与 GUI 按钮一致（`rejected` / `allowed-once`）
- **右上角圆形关闭按钮**（GDI+ 绘制 25×25 灰色圆底 + 白色 X 交叉线），点击立即关闭
- **可配置的显示时长**：在 `index.js` 中修改 `TOAST_SECONDS` 常量（默认：15秒）
- **深色 toast 卡片**，匹配 DSH 暗色主题（`#151517` + 品牌蓝 `#679EFE` 强调条），WinForms 自绘——零第三方依赖
- **DSH 黑鲸鱼 logo** 以矢量绘制（官方 SVG path 内嵌在脚本里——任意 DPI 清晰，无需图片文件）
- **提示音**（`SystemSounds.Exclamation`）
- **不抢焦点**（双保险：`WS_EX_NOACTIVATE` + 前台窗口恢复）
- **15 秒自动消失**，0.8 秒淡出；若被忽略，请求回退到 Web GUI 处理
- **DPI 感知**（200%+ 依然清晰）
- **`msg.exe` 回退**：WinForms 路径失败时自动退回，通知永不静默失效
- **绝不阻塞**：审批流程必然收敛——要么由卡片应答，要么委托宿主 answerer；失败只记日志、不抛出

## Requirements / 环境要求

| Item / 项目 | Requirement / 要求 |
|---|---|
| OS / 系统 | Windows 10 / 11 (non-Windows: terminal log only / 非 Windows 仅输出终端日志) |
| PowerShell | 5.1+ (built into Windows / Windows 自带) |
| DSH | A build with plugin support (`dsh plugin` available) / 支持插件的 DSH 版本 |
| Node.js | >= 18 (host runtime / 宿主运行时) |
| Session | DSH must run as the interactive user for the card to appear / DSH 须以当前交互用户身份运行 |

## Installation / 安装

```powershell
# From the packed tarball / 从 tarball 安装
dsh plugin --profile web add .\dsh-tu4-notification-0.5.0.tgz

# Or from this directory / 或从本目录
dsh plugin --profile web add .\
```

Then **restart DSH** — host plugins load at startup only, there is no hot reload.
安装后**重启 DSH**——宿主插件仅在启动时加载，无热加载。

> **Note / 注意:** if you previously installed the pre-rename `dsh-approval-notify`, remove it first so both don't fire at once:
> 如果你之前装过改名前的 `dsh-approval-notify`，先卸载它，避免两个插件同时弹通知：
> ```powershell
> dsh plugin --profile web remove dsh-approval-notify
> ```

### Uninstall / 卸载

```powershell
dsh plugin --profile web remove dsh-tu4-notification
```

Then restart DSH. 然后重启 DSH。

## How it works / 工作原理

DSH dispatches an `approval/request` **waterfall** when an operation needs approval. This plugin registers a listener at the **head** of that chain (`prepend: true` — required, because the host answerer returns a blocking Promise and never calls `next()`):

```
approval/request
  → dsh-tu4-notification (prepend): show card with buttons
      ├─ user clicks 允许一次 / 拒绝 on the card
      │     → card writes the outcome to %TEMP%\dsh-tu4-notify-<token>.txt
      │     → plugin claims the request: allowed-once / rejected  (same as GUI buttons)
      └─ card ignored (≈18 s) or launch fails
            → plugin calls next() → host answerer (Web GUI) answers it
```

The listener returns a Promise that settles exactly once: with the card's outcome (claim), or with `next()`'s result (delegation). It can never hang the approval flow. Full details: [docs/plugin-mechanism.md](docs/plugin-mechanism.md).

DSH 在操作需要审批时派发 `approval/request` **waterfall 事件**。本插件注册在该链条**链头**（`prepend: true`——必需，因为宿主 answerer 返回阻塞 Promise 且从不调用 `next()`）。listener 返回的 Promise 必然只 settle 一次：要么以卡片按钮的 outcome（claim 请求，与 GUI 按钮同词汇），要么以 `next()` 的结果（委托宿主）。审批流程绝不会被挂起。详见 [docs/plugin-mechanism.md](docs/plugin-mechanism.md)。

## Notification content / 通知内容

- **Card / 卡片:** title `DSH 审批请求` + body `<tool>: <reason>` (e.g. `write: escalate sandbox to danger-full-access: …`), body truncated to 2 lines
- **Action buttons / 操作按钮:** right-aligned **拒绝** (outline capsule, danger tint on hover) + **允许一次** (light primary capsule); clicking answers the approval in place — `拒绝` → `rejected`, `允许一次` → `allowed-once` (identical to the Web GUI buttons)
- **Close button / 关闭按钮:** GDI+-drawn circular close button (25x25 px) in top-right corner with hand cursor (dismisses the card only; the request then falls back to the Web GUI)
- **Sound / 提示音:** `SystemSounds.Exclamation`
- **Terminal log / 终端日志:** `[dsh-tu4-notification] DSH 审批请求 — <tool>: <reason>` (visible in the DSH startup terminal)

## Approval policy note / 审批策略说明

If a session's approval policy is `never`, DSH refuses without dispatching the event — no pending entry in the GUI and **no notification** (by design). With policy `ask`, every pending approval fires a notification.

会话审批策略为 `never` 时，DSH 直接拒绝、不派发事件——GUI 无 pending 条目，**也不发通知**（设计如此）。策略为 `ask` 时，每次审批 pending 都会触发通知。

## Development / 开发

```powershell
# Smoke test (asserts module contract, pure-ASCII notify.ps1, prepend, claim/delegate semantics)
node smoke-test.mjs

# Pack
pnpm pack   # → dsh-tu4-notification-0.5.0.tgz
```

**Hard constraint / 硬性约束:** `notify.ps1` must stay **pure ASCII** — PowerShell 5.1 reads BOM-less `.ps1` as ANSI (GBK on zh-CN) and any non-ASCII byte mojibakes. All display text arrives via command-line parameters, never as file content. See [docs/windows-gotchas.md](docs/windows-gotchas.md) for the full list of Windows/PowerShell pitfalls.

**硬性约束：** `notify.ps1` 必须保持**纯 ASCII**——PowerShell 5.1 把无 BOM 的 `.ps1` 按 ANSI（zh-CN 即 GBK）读取，任何非 ASCII 字节都会乱码。所有展示文本走命令行参数传入，绝不写入文件。完整的 Windows/PowerShell 踩坑清单见 [docs/windows-gotchas.md](docs/windows-gotchas.md)。

### Configuration / 配置

### Action Button Claim Window / 按钮应答窗口

The plugin **claims** the approval while the card is up; if the card is ignored, the request is delegated to the Web GUI. The claim window is `TOAST_SECONDS + 3 s` (card display + a 3 s grace for launch + reaction), so by default ≈ 18 s. Override it with the `DSH_NOTIFY_CLAIM_MS` environment variable (milliseconds), e.g. in the DSH terminal before starting:

插件在卡片存续期间 **claim**（接管）审批；卡片被忽略时委托给 Web GUI。claim 窗口 = `TOAST_SECONDS + 3s`（卡片显示时长 + 3s 启动/反应余量），默认约 18 秒。可用环境变量 `DSH_NOTIFY_CLAIM_MS`（毫秒）覆盖，例如在 DSH 终端启动前设置：

```powershell
$env:DSH_NOTIFY_CLAIM_MS = '30000'   # claim for 30 s before falling back to the GUI
```

### Display Duration / 显示时长

The notification card display duration can be configured by modifying the `TOAST_SECONDS` constant in `index.js`:

```javascript
// Default: 15 seconds
const TOAST_SECONDS = 15

// Change to 10 seconds
const TOAST_SECONDS = 10

// Change to 20 seconds
const TOAST_SECONDS = 20
```

### Close Button / 关闭按钮

A circular close button is drawn in the top-right corner of the notification card using GDI+ (25x25 pixels, gray circle background with white X cross icon). Users can click it to manually dismiss the notification before the auto-dismiss timer expires. The button uses a hand cursor for better UX.

右上角的圆形关闭按钮通过 GDI+ 绘制（25×25 像素，灰色圆底 + 白色 X 交叉线），用户可点击手动关闭通知卡片。按钮使用手型光标提升交互体验。

### Preview without a real approval / 无需真实审批的预览

`notify.ps1` supports `-PreviewOut <png>`: it renders the card to a PNG and exits (no sound, no timer) — used for the README preview and visual self-checks.

`notify.ps1` 支持 `-PreviewOut <png>`：把卡片渲染成 PNG 后退出（无提示音、无计时器）——用于 README 预览与视觉自检。

```powershell
powershell -NoProfile -File .\notify.ps1 -Title "DSH 审批请求" -Body "write: test" -PreviewOut .\assets\card-preview.png
```

## Troubleshooting / 故障排查

- **No card, but a classic gray `msg` dialog appeared** → the WinForms path failed and the fallback kicked in. Check the DSH startup terminal for `[dsh-tu4-notification] notify.ps1 调用失败`.
- **Clicked a card button but nothing happened** → the card's click handler writes the outcome to `%TEMP%\dsh-tu4-notify-<token>.txt`; the host process must be reading it. If DSH was started as a different user / session, the two may see different `%TEMP%`. Confirm DSH runs as the interactive user.
- **No pending entry in the Web GUI right after the card appears** → by design: the card is claiming the approval for ≈18 s. Click a button to answer, or wait for the fade and the GUI entry appears.
- **Debug the card** → set `$env:DSH_NOTIFY_DEBUG = 1` in the DSH terminal, trigger an approval, then read `%TEMP%\dsh-tu4-notification-debug.txt`.
- **No notification at all** → check the session's approval policy (`never` suppresses by design) and that DSH runs as the interactive user.

- **没看到卡片，只看到灰色 `msg` 对话框** → WinForms 路径失败、走了回退。查 DSH 启动终端的 `[dsh-tu4-notification] notify.ps1 调用失败`。
- **点了卡片按钮没反应** → 卡片点击会把 outcome 写入 `%TEMP%\dsh-tu4-notify-<token>.txt`，需由宿主进程读取。若 DSH 以不同用户/会话启动，两者可能看到不同 `%TEMP%`。确认 DSH 以当前交互用户身份运行。
- **卡片出现后 Web GUI 里暂时没有 pending 条目** → 设计如此：卡片正在 claim 审批（约 18 秒）。点按钮应答，或等淡出后 GUI 条目会出现。
- **调试卡片** → 在 DSH 终端设 `$env:DSH_NOTIFY_DEBUG = 1`，触发一次审批，然后读 `%TEMP%\dsh-tu4-notification-debug.txt`。
- **完全没通知** → 检查会话审批策略（`never` 按设计抑制）以及 DSH 是否以当前交互用户身份运行。

## Documentation / 文档

- [docs/design.md](docs/design.md) — card visual spec, whale logo, no-focus-steal, DPI
- [docs/plugin-mechanism.md](docs/plugin-mechanism.md) — DSH plugin contract, `prepend` requirement, event timing
- [docs/windows-gotchas.md](docs/windows-gotchas.md) — Windows / PowerShell 5.1 pitfalls

## License / 许可证

[MIT](LICENSE)
