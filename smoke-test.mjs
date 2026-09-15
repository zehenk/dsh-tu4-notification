/**
 * 冒烟测试：模块契约 + 纯 ASCII + prepend + v0.5 claim/委托 语义。
 * 运行：node smoke-test.mjs
 *
 * v0.5 语义（claim-with-timeout）：
 * - 卡片按钮应答（结果文件出现 'allowed-once'/'rejected'）→ claim 请求，
 *   不调用 next()，outcome 与 Web GUI 同名按钮一致；
 * - claim 窗口到期 / 卡片启动失败 / 非 Windows / 请求已中止 → next() 委托宿主。
 *
 * 注意：在 DSH 沙箱内运行时，真实 execFile 会 spawn EPERM——
 * 集成用例里这正好验证"启动失败立即委托"（错误隔离，绝不挂起审批流程）。
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// 命名空间导入——与 cordis loader 导入插件包时拿到的模块形式一致
import * as plugin from './index.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const req = { toolName: 'write', reason: '冒烟测试，可忽略' }
const noFx = { playSound: () => {}, sendMsg: () => {} }

// 1. 模块契约：name + apply 导出
assert.equal(typeof plugin.name, 'string', 'plugin.name 应为字符串')
assert.equal(plugin.name, 'dsh-tu4-notification', 'plugin.name 应为 dsh-tu4-notification')
assert.equal(typeof plugin.apply, 'function', 'plugin.apply 应为函数')
console.log('✅ 模块契约: name + apply 导出正确')

// 2. 通知脚本就位且为纯 ASCII
//    （PowerShell 5.1 把无 BOM 的 .ps1 当 ANSI 读——文件内出现中文会乱码，
//      所有展示文本必须走命令行参数传入）
const ps1Path = path.join(dir, 'notify.ps1')
assert.ok(existsSync(ps1Path), 'notify.ps1 应存在于插件目录')
const ps1Source = readFileSync(ps1Path, 'utf8')
assert.ok(
  [...ps1Source].every((ch) => ch.charCodeAt(0) < 128),
  'notify.ps1 必须保持纯 ASCII（防止 PS 5.1 ANSI 读取导致中文乱码）',
)
console.log('✅ notify.ps1: 存在且纯 ASCII')

// 3. apply 注册 listener（approval/request + prepend）
const registrations = []
const mockCtx = {
  on(name, listener, options) {
    registrations.push({ name, listener, options })
    return () => { registrations.pop() }
  },
}
plugin.apply(mockCtx)
assert.equal(registrations.length, 1, '应注册恰好 1 个 listener')
assert.equal(registrations[0].name, 'approval/request', '应监听 approval/request 事件')
assert.equal(registrations[0].options?.prepend, true, '必须使用 prepend: true（否则排在宿主 answerer 之后永不触发）')
console.log('✅ listener 注册: approval/request + prepend:true')

// 4. 卡片应答 allowed-once → claim 请求（next 不被调用）
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'dsh-notify-'))
  const file = path.join(tmp, 'result.txt')
  writeFileSync(file, 'allowed-once')
  let nextCalled = false
  const outcome = await plugin.decide(req, () => { nextCalled = true; return Promise.resolve('delegated') }, {
    ...noFx,
    platform: 'win32',
    resultFile: file,
    launch: () => {},
    claimMs: 5000,
    pollMs: 10,
  })
  assert.equal(outcome, 'allowed-once', '应 resolve 为 allowed-once')
  assert.equal(nextCalled, false, '卡片应答必须 claim 请求（next 不被调用）')
  rmSync(tmp, { recursive: true, force: true })
  console.log('✅ decide(): 卡片应答 allowed-once → claim（next 未调用）')
}

// 5. 卡片应答 rejected → claim 请求
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'dsh-notify-'))
  const file = path.join(tmp, 'result.txt')
  writeFileSync(file, 'rejected')
  let nextCalled = false
  const outcome = await plugin.decide(req, () => { nextCalled = true; return Promise.resolve('delegated') }, {
    ...noFx,
    platform: 'win32',
    resultFile: file,
    launch: () => {},
    claimMs: 5000,
    pollMs: 10,
  })
  assert.equal(outcome, 'rejected', '应 resolve 为 rejected')
  assert.equal(nextCalled, false, '卡片应答必须 claim 请求（next 不被调用）')
  rmSync(tmp, { recursive: true, force: true })
  console.log('✅ decide(): 卡片应答 rejected → claim（next 未调用）')
}

// 6. claim 窗口到期无应答 → 委托宿主（next 被调用，结果透传）
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'dsh-notify-'))
  let nextCalled = false
  const outcome = await plugin.decide(req, () => { nextCalled = true; return Promise.resolve('delegated') }, {
    ...noFx,
    platform: 'win32',
    resultFile: path.join(tmp, 'never-written.txt'),
    launch: () => {},
    claimMs: 30,
    pollMs: 10,
  })
  assert.equal(outcome, 'delegated', '窗口到期应透传 next() 的结果')
  assert.equal(nextCalled, true, '窗口到期必须调用 next() 委托宿主')
  rmSync(tmp, { recursive: true, force: true })
  console.log('✅ decide(): claim 窗口到期 → next() 委托宿主')
}

// 7. 卡片启动失败 → 立即委托（不等 claim 窗口）+ 回退音效/弹窗
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'dsh-notify-'))
  let nextCalled = false
  let fallbackFx = 0
  const t0 = Date.now()
  const outcome = await plugin.decide(req, () => { nextCalled = true; return Promise.resolve('delegated') }, {
    playSound: () => { fallbackFx += 1 },
    sendMsg: () => { fallbackFx += 1 },
    platform: 'win32',
    resultFile: path.join(tmp, 'never-written.txt'),
    launch: (_body, _token, hooks) => { hooks.onSpawnFailed() },
    claimMs: 60000,   // 故意设长：启动失败必须立即委托而不是等窗口
    pollMs: 10,
  })
  assert.equal(outcome, 'delegated')
  assert.equal(nextCalled, true, '启动失败必须调用 next()')
  assert.equal(fallbackFx, 2, '启动失败应触发 msg 回退（音效 + 弹窗）')
  assert.ok(Date.now() - t0 < 2000, '启动失败应立即委托，不能等待 claim 窗口')
  rmSync(tmp, { recursive: true, force: true })
  console.log('✅ decide(): 卡片启动失败 → 立即 next() + msg 回退')
}

// 8. 非 Windows / 已中止请求 → 直接委托
{
  let nextCalled = 0
  const o1 = await plugin.decide(req, () => { nextCalled += 1; return Promise.resolve('delegated') }, { ...noFx, platform: 'linux' })
  assert.equal(o1, 'delegated')
  const o2 = await plugin.decide({ ...req, signal: { aborted: true } }, () => { nextCalled += 1; return Promise.resolve('delegated') }, { ...noFx, platform: 'win32' })
  assert.equal(o2, 'delegated')
  assert.equal(nextCalled, 2, '非 Windows 与已中止请求必须直接 next()')
  console.log('✅ decide(): 非 Windows / 已中止 → 直接 next()')
}

// 8b. claim 窗口期间请求被中止 → settle 'cancelled'（不调 next，避免 GUI 闪现）
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'dsh-notify-'))
  let nextCalled = false
  const signal = { aborted: false, addEventListener(_t, fn) { this._fn = fn }, removeEventListener() {} }
  const p = plugin.decide({ ...req, signal }, () => { nextCalled = true; return Promise.resolve('delegated') }, {
    ...noFx,
    platform: 'win32',
    resultFile: path.join(tmp, 'never-written.txt'),
    launch: () => {},
    claimMs: 60000,   // 故意设长：abort 必须立即 settle 而不是等窗口
    pollMs: 10,
  })
  signal._fn()   // 模拟回合中止
  const outcome = await Promise.race([
    p,
    new Promise((r) => setTimeout(() => r('timeout'), 2000)),
  ])
  assert.equal(outcome, 'cancelled', 'abort 后应 settle 为 cancelled')
  assert.equal(nextCalled, false, 'abort 后不得调用 next()（避免 GUI 闪现 pending 条目）')
  rmSync(tmp, { recursive: true, force: true })
  console.log('✅ decide(): claim 期间 abort → settle cancelled（next 未调用）')
}

// 9. 集成：apply 注册的 listener 端到端。
//    沙箱内：真实 execFile spawn EPERM → 启动失败路径 → 立即 next() 委托；
//    真实 Windows：卡片闪现后 claim 窗口（80ms）到期 → next() 委托。
//    两种环境都快速收敛且结果透传宿主 answerer。
{
  process.env.DSH_NOTIFY_CLAIM_MS = '80'
  const reg = registrations[0]
  let nextCalled = false
  const nextResult = Promise.resolve('allowed-once')
  const result = reg.listener(req, () => { nextCalled = true; return nextResult })
  const outcome = await Promise.race([
    Promise.resolve(result),
    new Promise((r) => setTimeout(() => { throw new Error('listener 未 settle') }, 5000)),
  ])
  delete process.env.DSH_NOTIFY_CLAIM_MS
  assert.equal(outcome, 'allowed-once', '应透传宿主 answerer 的结果（委托路径）')
  assert.equal(nextCalled, true, '委托路径 next() 必须被调用')
  console.log('✅ 集成: listener 端到端 → next() 委托 + 结果透传')
}

console.log('\n冒烟测试全部通过 🎉')
process.exit(0)
