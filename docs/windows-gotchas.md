# Windows / PowerShell 5.1 Gotchas / 踩坑记录

> Hard-won constraints for `notify.ps1` and the spawn paths. If you touch the notification code, read this first.
> `notify.ps1` 与各 spawn 路径的硬性约束。改动通知代码前先读这篇。

## 1. `notify.ps1` must stay pure ASCII / 必须保持纯 ASCII

**English.** PowerShell 5.1 reads a BOM-less `.ps1` as **ANSI** (on zh-CN systems that means GBK). Any non-ASCII character in the file — a Chinese comment, an emoji — will mojibake or break parsing. All user-facing text (title, body) therefore arrives via **command-line parameters** (UTF-16 safe), never as file content. The whale SVG path is safe to embed because it is pure digits/letters/commas/dots. `smoke-test.mjs` asserts pure-ASCII as a regression guard.

**中文.** PowerShell 5.1 把无 BOM 的 `.ps1` 按 **ANSI**（zh-CN 系统即 GBK）读取。文件里任何非 ASCII 字符（中文注释、emoji）都会乱码或解析失败。因此所有展示文本（标题、正文）都走**命令行参数**传入（UTF-16 安全），绝不写入文件。鲸鱼 SVG path 可以内嵌，因为它纯由数字/字母/逗号/小数点构成。`smoke-test.mjs` 有纯 ASCII 断言做回归兜底。

## 2. `New-Object` cannot bind the multi-arg `Font` constructor / 多参 Font 构造绑定失败

**English.** In PS 5.1, `New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)` fails with "Cannot find an overload" — the (string, float, enum) constructor does not bind. Two-arg, three-arg, four-arg variants all fail; `FontFamily` and `Activator` workarounds also fail. **Fix:** create the fonts from a small embedded C# helper (`Add-Type -ReferencedAssemblies 'System.Drawing'`).

**中文.** PS 5.1 下 `New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)` 报 "Cannot find an overload"——(string, float, enum) 构造无法绑定。2/3/4 参版本、`FontFamily`、`Activator` 绕行全部失败。**解法：** 用内嵌 C# helper 创建字体（`Add-Type -ReferencedAssemblies 'System.Drawing'`）。

## 3. `FontStyle` has no Semibold / 没有 Semibold

**English.** Use `FontStyle.Bold` — WinForms resolves Segoe UI Bold to the Semibold (600) face automatically, which matches the DSH UI.

**中文.** 用 `FontStyle.Bold`——WinForms 会把 Segoe UI Bold 解析为 Semibold(600) 字面，与 DSH UI 一致。

## 4. `Add-Type` treats C# warnings as errors / 警告即错误

**English.** `Add-Type` compiles with warnings-as-errors semantics in practice: an unused variable (CS0219) fails the whole compile. Keep the embedded C# warning-free (delete unused variables). Also: use `-MemberDefinition` (which wraps your methods in a class) — feeding bare methods via `-TypeDefinition` fails with "expected class, delegate, enum, interface or struct".

**中文.** `Add-Type` 实际上按"警告即错误"编译：未使用变量（CS0219）会让整体编译失败。内嵌 C# 必须零警告（删掉未使用变量）。另外：用 `-MemberDefinition`（自动把方法包进类）——用 `-TypeDefinition` 喂裸方法会报"应输入 class、delegate、enum、interface 或 struct"。

## 5. `Start-Process -ArgumentList` does not auto-quote / 不自动加引号

**English.** In PS 5.1, `Start-Process -ArgumentList` does **not** wrap arguments containing spaces in quotes. This only affects ad-hoc test invocations (hand-quote them); the production path uses Node's `execFile` (standard quoting) and is unaffected.

**中文.** PS 5.1 下 `Start-Process -ArgumentList` **不会**自动给含空格参数加引号。只影响临时测试调用（手动包引号）；生产路径走 Node `execFile`（标准引号）不受影响。

## 6. `execFile` can fail two different ways / 两种失败形态

**English.** `execFile` may report failure via the **error callback** *or* by **throwing synchronously** (a sandboxed `spawn EPERM` throws before the callback exists). Both must be caught: `try/catch` around the call **and** an `err` branch in the callback. One failed notification must never take down the listener — fire-and-forget by design.

**中文.** `execFile` 的失败可能走 **error 回调**，也可能**同步 throw**（沙箱内 `spawn EPERM` 在回调建立前就抛）。两种都要兜住：调用处 `try/catch` + 回调里 `err` 分支。一个通知失败绝不能影响 listener——设计上就是 fire-and-forget。

## 7. Sandbox `spawn EPERM` is expected in tests / 沙箱 EPERM 是预期行为

**English.** Inside the DSH agent sandbox, `child_process` is blocked (`spawn EPERM`). In `smoke-test.mjs` this is *expected* — it exercises the "WinForms fails → msg fallback → both fail → still no exception, `next()` still called" isolation chain. Plugins running inside the DSH main process are not sandboxed and spawn freely.

**中文.** DSH agent 沙箱内 `child_process` 被阻止（`spawn EPERM`）。在 `smoke-test.mjs` 中这是**预期行为**——正好演练"WinForms 失败 → msg 回退 → 都失败 → 仍不抛异常、`next()` 仍被调用"的隔离链。运行在 DSH 主进程内的插件不受沙箱限制，可自由 spawn。

## 8. `msg` command syntax / msg 命令语法

**English.** The syntax is `msg <session> <message>` — a **single** message parameter. Title and body must be merged into one string; passing extra parameters is ambiguous and breaks.

**中文.** 语法是 `msg <session> <message>`——只有**一个** message 参数。标题和正文必须合并成一个字符串；传多余参数会有歧义并出错。

## 9. DPI scaling / DPI 缩放

**English.** Design values are 96-dpi units. Call `SetProcessDPIAware()`, read `GetDpiForSystem()`, and scale every dimension by `dpi/96` (e.g. a 428-wide card becomes 856 physical px at 200%).

**中文.** 设计值是 96-dpi 单位。调用 `SetProcessDPIAware()`、读取 `GetDpiForSystem()`，所有尺寸按 `dpi/96` 缩放（如 200% 时 428 宽卡片变 856 物理像素）。
