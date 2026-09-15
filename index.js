/**
 * dsh-tu4-notification — DSH 审批通知插件。
 *
 * 当任何 agent 的操作需要审批时，DSH 会派发 `approval/request` waterfall。
 * 本插件在该 waterfall 的链头（prepend）注册 listener：审批进入 pending 的
 * 瞬间弹出 WinForms 深色卡片（带「拒绝」「允许一次」按钮），用户在卡片上
 * 点击按钮即可当场应答审批（与 Web GUI 的同名按钮产生同一 outcome）；
 * 卡片未被应答时，claim 窗口到期后调用 `next()` 把请求委托给宿主 answerer
 * （Web GUI），行为退回 v0.4 的纯提醒模式。
 *
 * 应答通道（v0.5）：
 * - 卡片按钮点击 → notify.ps1 把 outcome（'allowed-once' / 'rejected'）
 *   写入 %TEMP%\dsh-tu4-notify-<token>.txt → 本进程轮询读取后 claim 请求
 * - 卡片启动失败 → 立即 next() 委托宿主 + msg 弹窗提醒（回退通道）
 *
 * 设计要点：
 * 1. `prepend: true` 是必需的——宿主 answerer 返回一个阻塞 Promise 且不调用
 *    `next()`，waterfall 中排在它之后的 listener 永远不会被执行。
 * 2. claim-with-timeout：listener 返回的 Promise 竞争「卡片按钮应答」与
 *    「claim 窗口到期（委托 next()）」，绝不让审批流程挂起。
 * 3. 不注入任何 service：只用 `ctx.on`，插件随宿主启动即加载。
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-tu4-notification'

/** 通知标题（msg 回退与 WinForms 卡片共用）。 */
const NOTIFY_TITLE = 'DSH 审批请求'

/** WinForms 卡片显示时长（秒）。 */
const TOAST_SECONDS = 10

/** 正文最大长度（超出由 notify.ps1 按 2 行截断，这里是粗粒度上限）。 */
const BODY_MAX = 120

/** 按钮文案（与 Web GUI 审批面板的按钮文案一致）。 */
const BTN_REJECT = '拒绝'
const BTN_ALLOW = '允许一次'

/**
 * claim 窗口在卡片显示时长之外的余量（毫秒）：覆盖卡片 PowerShell 启动
 * 开销（约 1-2s）与用户看到卡片后的反应时间。
 */
const CLAIM_GRACE_MS = 3000

/** 结果文件轮询间隔（毫秒）。 */
const POLL_INTERVAL_MS = 150

/** settle 后延迟清理结果文件的时间（毫秒）：兜底卡片在窗口结束后迟写。 */
const CLEANUP_DELAY_MS = 2000

/** 卡片按钮可写入的全部 outcome（与 DSH ApprovalOutcome 词汇子集一致）。 */
const CARD_OUTCOMES = new Set(['allowed-once', 'rejected'])

export function apply(ctx) {
  ctx.on('approval/request', (req, next) => {
    try {
      return decide(req, next)
    } catch (err) {
      // 决策逻辑自身异常时委托宿主，绝不 fail-closed 掉 GUI 回退。
      console.error('[dsh-tu4-notification] 决策失败，委托宿主 answerer:', err)
      return next()
    }
  }, { prepend: true })

  console.log('[dsh-tu4-notification] 插件已加载：审批 pending 时将发送 Windows 深色卡片通知（支持卡片内应答）')
}

/**
 * claim 窗口时长（毫秒）。可用环境变量 DSH_NOTIFY_CLAIM_MS 覆盖（测试用）。
 * @returns {number}
 */
export function getClaimMs() {
  const env = Number(process.env.DSH_NOTIFY_CLAIM_MS)
  return Number.isFinite(env) && env > 0
    ? env
    : TOAST_SECONDS * 1000 + CLAIM_GRACE_MS
}

/**
 * 审批决策：优先让卡片按钮应答（claim），claim 窗口到期或卡片启动失败时
 * 委托宿主 answerer（next()）。返回的 Promise 一定 settle，绝不 reject。
 *
 * @param {object} req - ApprovalRequest（agent, toolName, callId?, reason?, signal?）
 * @param {() => Promise<string>} next - waterfall 委托（宿主 answerer）
 * @param {object} [deps] - 可注入依赖（测试用）
 * @returns {Promise<string>} ApprovalOutcome
 */
export function decide(req, next, deps = {}) {
  const platform = deps.platform ?? process.platform
  const toolName = req?.toolName ?? 'unknown'
  const reason = (req?.reason ?? '').trim()
  const body = reason ? `${toolName}: ${reason}` : `${toolName}: 需要权限`

  // 终端日志（DSH 启动终端可见）
  console.log(`[dsh-tu4-notification] ${NOTIFY_TITLE} — ${body}`)

  // 已中止的请求（回合被取消）或非 Windows：不弹卡片，直接委托宿主。
  if (req?.signal?.aborted === true || platform !== 'win32') return next()

  const token = deps.randomUUID?.() ?? randomUUID()
  const resultFile = deps.resultFile ?? path.join(os.tmpdir(), `dsh-tu4-notify-${token}.txt`)
  const launch = deps.launch ?? launchCard
  const readResult = deps.readResult ?? readResultFile
  const rmFile = deps.rmFile ?? rmFileSafe
  const playSoundFx = deps.playSound ?? playSound
  const sendMsgFx = deps.sendMsg ?? sendMsg
  const claimMs = deps.claimMs ?? getClaimMs()
  const pollMs = deps.pollMs ?? POLL_INTERVAL_MS

  return new Promise((resolve) => {
    let settled = false
    const timers = []
    const cleanups = []

    const settle = (value) => {
      if (settled) return
      settled = true
      for (const t of timers) clearTimeout(t)
      for (const fn of cleanups) { try { fn() } catch { /* best effort */ } }
      // 延迟清理结果文件：卡片若在窗口结束后才写文件，迟到的写入无意义。
      const cleanup = setTimeout(() => rmFile(resultFile), CLEANUP_DELAY_MS)
      cleanup.unref?.()
      resolve(value)
    }

    // 轮询卡片写回的结果文件。
    const poll = () => {
      if (settled) return
      const outcome = readResult(resultFile)
      if (CARD_OUTCOMES.has(outcome)) {
        rmFile(resultFile)
        console.log(`[dsh-tu4-notification] 卡片应答：${outcome}`)
        settle(outcome)
        return
      }
      timers.push(setTimeout(poll, pollMs))
    }
    timers.push(setTimeout(poll, pollMs))

    // 回合在卡片显示期间被中止：服务侧已 settle 'cancelled' 并丢弃迟到应答——
    // 立即停止轮询并 settle，且不调用 next()（避免 GUI 侧出现闪现的 pending 条目）。
    if (req.signal && typeof req.signal.addEventListener === 'function') {
      const onAbort = () => {
        if (settled) return
        console.log('[dsh-tu4-notification] 审批请求已中止，放弃卡片应答')
        settle('cancelled')
      }
      req.signal.addEventListener('abort', onAbort, { once: true })
      cleanups.push(() => req.signal.removeEventListener('abort', onAbort))
    }

    // 卡片启动：spawn 级失败（EPERM/ENOENT/同步抛出）→ 立即委托 + msg 回退。
    try {
      launch(body, token, {
        onSpawnFailed: () => {
          if (settled) return
          console.warn('[dsh-tu4-notification] WinForms 通知启动失败，回退 msg 弹窗并委托宿主 answerer')
          playSoundFx()
          sendMsgFx(body)
          settle(next())
        },
      })
    } catch (err) {
      console.error('[dsh-tu4-notification] notify.ps1 启动失败:', err.message)
      playSoundFx()
      sendMsgFx(body)
      settle(next())
    }

    // claim 窗口到期 → 委托宿主 answerer（GUI 出现 pending 审批条目）。
    timers.push(setTimeout(() => {
      if (!settled) {
        console.log('[dsh-tu4-notification] 卡片未被应答，委托宿主 answerer')
        settle(next())
      }
    }, claimMs))
  })
}

/**
 * 启动 WinForms 深色卡片（notify.ps1 内含提示音与按钮）。
 * 进程在卡片淡出或被点击后自行退出（约 TOAST_SECONDS + 启动开销）。
 *
 * @param {string} body - 审批详情（工具: 原因）
 * @param {string} token - 本次审批的唯一 token（结果文件名）
 * @param {{ onSpawnFailed: () => void }} hooks - spawn 级失败回调
 */
function launchCard(body, token, hooks) {
  const ps1 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'notify.ps1')
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', ps1,
    '-Title', NOTIFY_TITLE,
    '-Body', body.slice(0, BODY_MAX),
    '-Seconds', String(TOAST_SECONDS),
    '-Token', token,
    '-BtnReject', BTN_REJECT,
    '-BtnAllow', BTN_ALLOW,
  ]
  try {
    // 卡片存活约 10s + 启动开销；30s 超时兜底，超时/正常退出都不再处理
    //（claim 窗口已先于该时刻 settle）。
    execFile('powershell.exe', args, { windowsHide: true, timeout: 30000 }, (err) => {
      if (!err) return
      // 区分 spawn 级失败（code 为错误名字符串）与运行期退出（code 为退出码数字）。
      const spawnFailed = typeof err.code === 'string' && (
        err.code === 'EPERM' || err.code === 'ENOENT' || err.code === 'EACCES'
      )
      if (spawnFailed) {
        console.error('[dsh-tu4-notification] notify.ps1 启动失败:', err.message)
        hooks.onSpawnFailed()
      }
    })
  } catch (err) {
    console.error('[dsh-tu4-notification] notify.ps1 启动失败:', err.message)
    hooks.onSpawnFailed()
  }
}

/**
 * 读取卡片写回的结果文件。
 * @param {string} file
 * @returns {'allowed-once'|'rejected'|undefined}
 */
function readResultFile(file) {
  try {
    if (!fs.existsSync(file)) return undefined
    const content = fs.readFileSync(file, 'utf8').trim()
    return CARD_OUTCOMES.has(content) ? content : undefined
  } catch {
    return undefined
  }
}

/** 删除结果文件（忽略不存在/删除失败）。 @param {string} file */
function rmFileSafe(file) {
  try { fs.rmSync(file, { force: true }) } catch { /* best effort */ }
}

/** 系统提示音（PowerShell SystemSounds，约 1 秒启动开销，fire-and-forget）。仅 msg 回退路径使用。 */
function playSound() {
  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', '[System.Media.SystemSounds]::Exclamation.Play()',
  ], 8000)
}

/**
 * 本地用户会话 msg 弹窗（Windows 7+ 内置命令，语法 `msg <session> <message>`）。
 * 弹窗出现时系统会自动播放通知音。仅 WinForms 失败时的回退通道。
 * @param {string} message - 审批详情（与标题合并为单一 message 参数）
 */
function sendMsg(message) {
  const username = process.env.USERNAME || os.userInfo().username
  const safe = message.replace(/"/g, '').slice(0, 100)
  run('msg.exe', [username, `${NOTIFY_TITLE} ${safe}`], 5000)
}

/**
 * 统一的 execFile 封装：隐藏窗口、限时、错误只记日志。
 * execFile 的失败可能以 error 回调或同步抛出两种形式出现（取决于环境），
 * 两种都兜住，保证一个通知失败不影响其它通知。
 * @param {string} cmd
 * @param {string[]} args
 * @param {number} timeoutMs
 */
function run(cmd, args, timeoutMs) {
  try {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs }, (err) => {
      if (err) console.error(`[dsh-tu4-notification] ${cmd} 调用失败:`, err.message)
    })
  } catch (err) {
    console.error(`[dsh-tu4-notification] ${cmd} 调用失败:`, err.message)
  }
}
