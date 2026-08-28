# Notification Card Design / 通知卡片设计

> Bilingual: English first, Chinese follows each section.

## Why not a native Windows toast / 为什么不用系统原生 Toast

**English.** A WinRT native toast was evaluated and rejected:

- Unregistered executables (PowerShell) are attributed to a fixed sender name ("Windows PowerShell"), so the user cannot tell the app apart from the attribution line alone.
- The visual style is a fixed system template — it cannot be recolored to match the DSH dark theme.
- Dismissed toasts are archived into the Notification Center, which the plugin cannot control.

The chosen approach is a self-drawn **WinForms card** launched via PowerShell: full control over the appearance (colors taken directly from the DSH design-system tokens), zero third-party dependencies (PowerShell 5.1 + built-in WinForms), at a cost of ~1–2 s of PowerShell startup latency — acceptable because approvals are pending for minutes, not milliseconds.

**中文.** 曾评估 WinRT 原生 Toast 并放弃：未注册的可执行文件署名固定显示 "Windows PowerShell"；样式是系统模板，无法改成 DSH 深色主题；消失后归档进通知中心不可控。最终采用 PowerShell 启动的 WinForms 自绘卡片：外观完全可控（配色直接取 DSH 设计系统 token），零第三方依赖，代价是 1–2 秒 PowerShell 启动延迟（审批 pending 以分钟计，可接受）。

## Visual specification / 视觉规范

**English.** All colors are the DSH dark-theme tokens (from the deepseek-harness `design-platform.css`):

| Element | Value | Token |
|---|---|---|
| Card background | `#151517` | neutral-bluish-950 (dark bg-base) |
| Border | 1px `#2A2A2E` | border-l1 (approx.) |
| Accent bar | 4px left, `#679EFE` | deepseek-400 (brand blue) |
| Icon plate | rounded square 55px, `#F9FAFB` | label-primary (dark) |
| Whale logo | `#000000` (the official DSH black whale) | — |
| Title | `#F9FAFB`, Segoe UI Semibold 11pt | label-primary (dark) |
| Body | `#CFD3D6`, Segoe UI 9.5pt, max 2 lines + ellipsis | label-secondary (dark) |

Layout (96-dpi design units, scaled for DPI):

```
┌────────────────────────────────────────────────────┐
│ ▌ ┌────────┐  DSH 审批请求                         │
│ ▌ │ 🐋     │  write: escalate sandbox to           │
│ ▌ │(whale) │  danger-full-access: …(2 lines max)   │
│ ▌ └────────┘                                       │
└────────────────────────────────────────────────────┘
```

- Size: 428 × 96 px (icon 55px, vertically centered; text starts at x=81)
- Position: bottom-right of the primary monitor work area, 48px from the edges
- Behavior: `TopMost`, no taskbar entry, **never steals focus** (see below), plays `SystemSounds.Exclamation` on show, auto-dismisses after 10 s with an 800 ms fade-out
- Concurrency: later cards overlay earlier ones (all dismiss within 10 s — accepted for v1)

**中文.** 配色全部取 DSH 暗色主题 token（来自 deepseek-harness 的 `design-platform.css`）：卡片背景 `#151517`、边框 1px `#2A2A2E`、左侧 4px 品牌蓝（`#679EFE`）强调条、图标底板 55px 圆角方块（`#F9FAFB` 近白）内嵌黑色鲸鱼（DSH 官方 logo）、标题 `#F9FAFB` Segoe UI Semibold 11pt、正文 `#CFD3D6` 9.5pt 最多 2 行带省略号。尺寸 428×96px（96-dpi 设计单位，按 DPI 缩放），主屏工作区右下角距边 48px。行为：TopMost、不进任务栏、**绝不抢焦点**、显示即播提示音、10 秒后 0.8 秒淡出。并发时后发卡片覆盖先发（10 秒内全部消失，v1 可接受）。

## The whale logo / 鲸鱼 logo

**English.** The DSH (DeepSeek Harness) brand mark is a **black whale** (distinct from the blue whale of DeepSeek's model products). The card renders it as vector graphics: the official SVG path (from the deepseek-harness `FishLogo` primitive, viewBox 23.16×17.04) is embedded in `notify.ps1` and converted to a `System.Drawing.Drawing2D.GraphicsPath` by a small C# parser (absolute/relative M/L/C/Z, implicit command repetition, scientific notation). Advantages: crisp at any DPI, no image file to ship, and the path is pure ASCII so it does not break the `.ps1` encoding constraint (see [windows-gotchas](windows-gotchas.md)).

**中文.** DSH（DeepSeek Harness）品牌标志是**黑色鲸鱼**（区别于 DeepSeek 模型产品的蓝鲸）。卡片以矢量方式绘制：官方 SVG path（来自 deepseek-harness 的 FishLogo 图元，viewBox 23.16×17.04）内嵌于 `notify.ps1`，由一段小 C# 解析器（支持绝对/相对 M/L/C/Z、隐式重复命令、科学计数法）转换为 GDI+ `GraphicsPath`。优点：任意 DPI 清晰、无需打包图片文件、path 是纯 ASCII 不破坏 `.ps1` 编码约束（见 [windows-gotchas](windows-gotchas.md)）。

## No focus steal / 不抢焦点（双保险）

**English.** The card must not interrupt the user's current window:

1. `WS_EX_NOACTIVATE` is set on the form's extended style **before** `Show()`.
2. As a belt-and-braces measure, the foreground window is captured before showing, and if it changed, `SetForegroundWindow` restores it in the `Shown` event.

**中文.** 卡片不能打断用户当前窗口，双保险：① `Show()` 前给窗体扩展样式加 `WS_EX_NOACTIVATE`；② 显示前记录前台窗口，`Shown` 事件中若前台改变则 `SetForegroundWindow` 恢复。

## DPI awareness / DPI 感知

**English.** The process calls `SetProcessDPIAware()` and reads `GetDpiForSystem()`; all 96-dpi design values are scaled by `dpi/96` so the card stays crisp on HiDPI displays (e.g. 200%).

**中文.** 进程调用 `SetProcessDPIAware()` 并读取 `GetDpiForSystem()`，所有 96-dpi 设计值按 `dpi/96` 缩放，HiDPI（如 200%）下依然清晰。
