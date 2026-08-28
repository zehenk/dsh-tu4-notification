# DSH Plugin Mechanism / DSH 插件机制

> How this plugin plugs into DSH's approval pipeline, and the non-obvious facts that make it work.
> 本插件如何接入 DSH 审批管线，以及让它跑起来的关键（非显而易见）事实。

## Event flow / 事件流

**English.** When any agent operation requires approval, DSH dispatches an `approval/request` **waterfall** event. Answerers (Web GUI / ACP) are chained via `next()`. This plugin registers a listener at the **head** of the chain:

```
approval/request dispatched
  → dsh-tu4-notification listener (prepend):
        send Windows notification (fire-and-forget)
        return next()
  → host answerer (Web GUI):
        create the pending entry, wait for the user's decision
  → user approves / denies in the GUI
```

**中文.** 任何 agent 操作需要审批时，DSH 派发 `approval/request` **waterfall 事件**，各 answerer（Web GUI / ACP）通过 `next()` 串联。本插件注册在链条**链头**：

```
approval/request 派发
  → dsh-tu4-notification listener（prepend）：
        发送 Windows 通知（fire-and-forget）
        return next()
  → 宿主 answerer（Web GUI）：
        创建 pending 条目，等待用户应答
  → 用户在 GUI 批准 / 拒绝
```

## Why `prepend: true` is required / 为什么必须 `prepend: true`

**English.** This is the single most important detail. The host answerer (the Web GUI) returns a **blocking Promise** for the duration of the pending approval and **does not call `next()`** — the waterfall is not a fire-and-forget broadcast, it is a request/answer chain that terminates once an answerer handles the request. A listener registered *after* the host answerer would never run while the approval is pending. Registering with `{ prepend: true }` puts this listener first, so the notification fires the instant the approval becomes pending.

**中文.** 这是最关键的一点。宿主 answerer（Web GUI）在审批 pending 期间返回一个**阻塞 Promise** 且**不调用 `next()`**——waterfall 不是"广播"，而是"请求/应答链"，一旦有 answerer 处理了请求就终止。注册在宿主 answerer **之后**的 listener 在审批 pending 期间永远不会执行。用 `{ prepend: true }` 把本 listener 放到链头，通知才能在审批进入 pending 的瞬间触发。

## Non-interference guarantees / 不干扰审批的保证

**English.**

1. **Never blocks the approval flow.** The listener sends the notification and immediately returns `next()`; the notification commands (`powershell.exe`, `msg.exe`) are spawned asynchronously with `windowsHide: true`.
2. **Error isolation.** If a notification command fails (e.g. `msg.exe` missing, sandbox `spawn EPERM`), the failure is logged and swallowed. `next()` is always called and its return value (the host answerer's Promise) is passed through unchanged.
3. **No injected services.** The plugin only uses `ctx.on()`, a base `Context` method — it does not `inject` any service and adds zero host runtime dependencies. `@deepseek-ai/cordis` appears only as a `peerDependency` declaring the compatible host version.
4. **Auto-cleanup.** Listeners registered via `ctx.on()` are removed automatically when the plugin is unloaded.

**中文.**

1. **绝不阻塞审批流程**：listener 发完通知立即 `return next()`；通知命令（`powershell.exe`、`msg.exe`）都是异步 spawn（`windowsHide: true`）。
2. **错误隔离**：通知命令失败（如 `msg.exe` 缺失、沙箱 `spawn EPERM`）只记日志不抛出；`next()` 一定被调用，其返回值（宿主 answerer 的 Promise）原样透传。
3. **不注入任何 service**：只用 `ctx.on()`（`Context` 基础方法），零宿主运行时依赖；`@deepseek-ai/cordis` 仅作 `peerDependency` 声明兼容宿主版本。
4. **自动清理**：`ctx.on()` 注册的 listener 在插件卸载时自动移除。

## Approval policy interaction / 与审批策略的关系

**English.** If a session's approval policy is `never`, DSH refuses the request without dispatching the waterfall — no pending entry is created in the GUI and **no notification is sent** either (by design: there is nothing for the user to answer). With policy `ask`, the notification fires on every pending approval.

**中文.** 会话审批策略为 `never` 时，DSH 直接拒绝、不派发 waterfall——GUI 不创建 pending 条目，**也不发通知**（设计如此：没有需要用户应答的东西）。策略为 `ask` 时，每次审批 pending 都会触发通知。

## Plugin contract / 插件契约

**English.**

- The module exports a **namespace** with `name` (string) and `apply(ctx)` (function).
- `cordis.patch.yml` declares the bundle registration:
  ```yaml
  - insert:
      - id: tu4-notification
        name: dsh-tu4-notification
  ```
- `package.json` carries `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`.
- Host plugins load **at DSH startup only** — there is no hot reload. Any change requires re-pack + reinstall + DSH restart.

**中文.**

- 模块以**命名空间**导出 `name`（字符串）和 `apply(ctx)`（函数）。
- `cordis.patch.yml` 声明 bundle 注册（见上方 YAML）。
- `package.json` 携带 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。
- 宿主插件**仅在 DSH 启动时加载**，无热加载：任何改动 = 重打包 + 重装 + 重启 DSH。

## Event timing facts / 事件时机事实

**English.** (Verified against the deepseek-harness source.)

- `approval/asked` is written to session history **at request dispatch** — i.e. *during* the pending period, not after the decision. (An earlier hypothesis that it was recorded only after the decision was disproven.)
- `approval/decided` is appended after the answerer resolves.
- The entire fiber tree shares the root context's single `EventsService` instance (`Context.extend` uses `Object.create`), so `_hooks` is one shared array — a plugin listener sees approvals from all agents/sessions in the process.

**中文.**（对照 deepseek-harness 源码验证。）

- `approval/asked` 在**请求派发时**写入会话历史——即 pending 期间，而非决定之后。（早期"决定后才记录"的假设已被推翻。）
- `approval/decided` 在 answerer 应答后追加。
- 整棵 fiber 树共享根 context 的同一个 `EventsService` 实例（`Context.extend` 用 `Object.create`），`_hooks` 是单一共享数组——插件 listener 能感知进程内所有 agent/会话的审批。
