/**
 * dsh-tu4-notification — DSH 审批通知插件。
 *
 * 当任何 agent 的操作需要审批时，DSH 会派发 `approval/request` waterfall。
 * 本插件在该 waterfall 的链头（prepend）注册 listener：审批进入 pending 的
 * 瞬间立即发送 Windows 系统通知，然后调用 `next()` 把请求交给原有
 * answerer（Web GUI / ACP）处理。
 *
 * 通知通道（v0.2）：
 * - 首选：WinForms 深色卡片（notify.ps1，匹配 DSH 暗色主题，10 秒淡出，
 *   含提示音，不抢焦点）
 * - 回退：WinForms 启动/执行失败时，退回旧版 msg 弹窗 + 独立提示音
 *
 * 设计要点：
 * 1. `prepend: true` 是必需的——宿主 answerer 返回一个阻塞 Promise 且不调用
 *    `next()`，waterfall 中排在它之后的 listener 永远不会被执行。
 * 2. 通知是 fire-and-forget：失败只记日志，绝不影响审批流程。
 * 3. 不注入任何 service：只用 `ctx.on`，插件随宿主启动即加载。
 */

import { execFile } from 'node:child_process'
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

export function apply(ctx) {
  ctx.on('approval/request', (req, next) => {
    // 已中止的请求（回合被取消）不会在 GUI 显示弹窗，跳过通知避免误报。
    if (req?.signal?.aborted !== true) {
      try {
        notify(req)
      } catch (err) {
        // 通知失败绝不影响审批流程。
        console.error('[dsh-tu4-notification] 通知失败:', err)
      }
    }
    return next()
  }, { prepend: true })

  console.log('[dsh-tu4-notification] 插件已加载：审批 pending 时将发送 Windows 深色卡片通知')
}

/**
 * 组装通知内容并触发通知（WinForms 优先，msg 回退）。
 * @param {object} req - ApprovalRequest（agent, toolName, callId?, reason?, signal?）
 */
function notify(req) {
  const toolName = req?.toolName ?? 'unknown'
  const reason = (req?.reason ?? '').trim()
  const body = reason ? `${toolName}: ${reason}` : `${toolName}: 需要权限`

  // 终端日志（DSH 启动终端可见）
  console.log(`[dsh-tu4-notification] ${NOTIFY_TITLE} — ${body}`)

  // Windows 专属通知
  if (process.platform !== 'win32') return

  sendWinforms(body, (failed) => {
    if (failed) {
      console.warn('[dsh-tu4-notification] WinForms 通知不可用，回退 msg 弹窗')
      playSound()
      sendMsg(body)
    }
  })
}

/**
 * WinForms 深色卡片通知（notify.ps1 内含提示音）。
 * 进程在卡片淡出后自行退出（约 TOAST_SECONDS + 启动开销）。
 * @param {string} body - 审批详情（工具: 原因）
 * @param {(failed: boolean) => void} onResult - 启动失败或进程非零退出时 failed=true
 */
function sendWinforms(body, onResult) {
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
  ]
  try {
    // 卡片存活约 10s + 启动开销；30s 超时足够，超时即视为失败并回退。
    execFile('powershell.exe', args, { windowsHide: true, timeout: 30000 }, (err) => {
      if (err) {
        console.error('[dsh-tu4-notification] notify.ps1 调用失败:', err.message)
        onResult(true)
      }
    })
  } catch (err) {
    console.error('[dsh-tu4-notification] notify.ps1 启动失败:', err.message)
    onResult(true)
  }
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
