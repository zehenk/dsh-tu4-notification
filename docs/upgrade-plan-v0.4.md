# dsh-tu4-notification v0.4 升级计划

## 1. 升级背景

基于用户需求和社区反馈（GitHub Discussion #5208），当前DSH插件仅提供只读提醒功能，无法在通知卡片内直接操作。用户希望在通知卡片上直接完成审批或回答问题，避免频繁切换窗口。

## 2. 升级目标

### 2.1 核心功能
1. **交互式通知卡片**：在WinForms卡片上添加交互按钮
2. **审批操作支持**：审批场景显示"批准"和"拒绝"按钮
3. **问答操作支持**：`ask_user_question`场景显示选项按钮（A/B/C等）
4. **任务完成/出错通知**：显示"查看详情"按钮（跳转到Web GUI）
5. **后台检测**：DSH Web界面处于前台时不弹出通知

### 2.2 技术要求
- 保持现有WinForms卡片外观（深色主题、品牌蓝强调条、鲸鱼logo）
- 保持fire-and-forget原则，不影响审批流程
- 兼容DSH插件机制（prepend注册、事件总线）
- 支持Windows 7+系统

## 3. 技术方案

### 3.1 事件监听扩展
```javascript
// 当前：仅监听 approval/request
ctx.on('approval/request', (req, next) => { ... }, { prepend: true })

// 升级：监听多个事件
ctx.on('approval/request', (req, next) => { ... }, { prepend: true })
ctx.on('user-interaction/asked', (req, next) => { ... }, { prepend: true })
```

### 3.2 通知卡片参数扩展
```powershell
# 当前参数
param(
    [string]$Title = 'DSH',
    [string]$Body = '',
    [int]$Seconds = 10,
    [string]$PreviewOut = ''
)

# 升级参数
param(
    [string]$Title = 'DSH',
    [string]$Body = '',
    [int]$Seconds = 10,
    [string]$PreviewOut = '',
    [string]$Type = 'approval',  # approval | question | info
    [string]$Options = '',       # JSON格式选项：["选项1","选项2"]
    [string]$CallbackUrl = '',   # 回调URL（用于交互响应）
    [string]$RequestId = ''      # 请求ID（用于关联响应）
)
```

### 3.3 WinForms卡片布局调整
- 卡片高度从96px调整为120px（容纳按钮）
- 按钮区域位于卡片底部
- 按钮样式：圆角、深色背景、白色文字
- 悬停效果：背景色变化

### 3.4 交互流程
1. **审批场景**：
   - 用户点击"批准" → 调用DSH API完成审批
   - 用户点击"拒绝" → 调用DSH API拒绝请求
   - 卡片自动关闭

2. **问答场景**：
   - 用户点击选项按钮 → 调用DSH API提交回答
   - 卡片自动关闭

3. **信息场景**：
   - 用户点击"查看详情" → 打开Web GUI对应页面
   - 卡片自动关闭

## 4. 实现步骤

### 4.1 第一阶段：基础交互框架
1. 修改`index.js`：添加新事件监听
2. 修改`notify.ps1`：添加按钮参数和按钮绘制逻辑
3. 实现按钮点击事件处理

### 4.2 第二阶段：审批功能实现
1. 集成DSH审批API
2. 实现批准/拒绝功能
3. 添加错误处理和回退机制

### 4.3 第三阶段：问答功能实现
1. 解析选项参数
2. 动态生成选项按钮
3. 实现回答提交功能

### 4.4 第四阶段：测试与优化
1. 冒烟测试扩展
2. 生产环境验证
3. 性能优化

## 5. 风险评估

### 5.1 技术风险
- **DSH API兼容性**：需确认DSH是否提供审批/问答的API接口
- **WinForms按钮交互**：PowerShell 5.1下按钮事件处理可能有限制
- **进程间通信**：插件与DSH核心的通信机制

### 5.2 缓解措施
- 优先实现基础交互，复杂功能逐步迭代
- 保持回退机制（按钮失败时仍显示通知）
- 充分测试Windows 7/10/11兼容性

## 6. 版本规划

### v0.4.0（计划版本）
- 基础交互框架
- 审批批准/拒绝按钮
- 问答选项按钮

### v0.5.0（未来版本）
- 任务完成/出错通知的"查看详情"按钮
- 后台检测（DSH前台时不通知）
- 声音开关配置

## 7. 开发资源

### 7.1 参考文档
- [Windows Toast通知内容](https://learn.microsoft.com/zh-cn/windows/apps/develop/notifications/app-notifications/app-notifications-content)
- [DSH插件机制文档](../docs/plugin-mechanism.md)
- [DSH设计规范](../docs/design.md)

### 7.2 测试环境
- Windows 10/11
- PowerShell 5.1
- DSH Web GUI（127.0.0.1:3080）
- 真实审批场景测试

## 8. 预期成果

升级后，DSH插件将从"只读提醒"演进为"可操作通知"，用户可以在通知卡片内直接完成审批或回答问题，大幅提升使用效率，减少窗口切换次数。