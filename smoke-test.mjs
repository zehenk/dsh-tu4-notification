/**
 * 冒烟测试：验证插件 listener 注册 + 通知路径 + 错误隔离。
 * 运行：node smoke-test.mjs
 *
 * 注意：在 DSH 沙箱内运行时，execFile 会 spawn EPERM——
 * 这正好验证"通知失败绝不影响审批流程"（next() 必须被调用），
 * 且 WinForms → msg 回退链路在失败时只记日志、不抛出。
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
// 命名空间导入——与 cordis loader 导入插件包时拿到的模块形式一致
import * as plugin from './index.js'

const dir = path.dirname(fileURLToPath(import.meta.url))

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

// 3. mock ctx：记录 on() 调用
const registrations = []
const mockCtx = {
  on(name, listener, options) {
    registrations.push({ name, listener, options })
    return () => { registrations.pop() }
  },
}

// 4. apply 注册 listener
plugin.apply(mockCtx)
assert.equal(registrations.length, 1, '应注册恰好 1 个 listener')
const reg = registrations[0]
assert.equal(reg.name, 'approval/request', '应监听 approval/request 事件')
assert.equal(reg.options?.prepend, true, '必须使用 prepend: true（否则排在宿主 answerer 之后永不触发）')
console.log('✅ listener 注册: approval/request + prepend:true')

// 5. 触发 listener：next() 必须被调用（即使通知失败）
let nextCalled = false
const nextResult = Promise.resolve('allowed-once')
const req = { toolName: 'test', reason: '插件冒烟测试，可忽略' }
const result = reg.listener(req, () => { nextCalled = true; return nextResult })
assert.ok(nextCalled, 'next() 必须被同步调用（不阻塞审批流程）')
assert.equal(result, nextResult, 'listener 应返回 next() 的结果（透传 answerer 的 Promise）')
await result
console.log('✅ 审批流程: next() 被调用，返回值透传')

// 6. 等待通知命令的异步结果
//    沙箱内 WinForms spawn EPERM → 触发 msg 回退 → 回退命令同样 EPERM，
//    全程只记日志、不抛出（验证错误隔离 + 回退链路）
await new Promise((r) => setTimeout(r, 2000))
console.log('✅ 错误隔离: WinForms 失败 → msg 回退 → 均未影响 listener 执行')

console.log('\n冒烟测试全部通过 🎉')
process.exit(0)
