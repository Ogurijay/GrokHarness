# Grok Bot 接入评估

核查日期：2026-10-01。范围为官方公开文档、产品入口和 xai-org 公开仓库；没有登录 Bot、安装客户端或调用未公开接口。

## 结论

Grok Bot 已提供 Windows、macOS、Linux 桌面应用以及手机应用，围绕持久云端电脑运行。官方入门流程通过应用和 Cursor 账户登录。它与 Harness 当前接入的 Grok Build 是两个产品。[Bot 概览](https://docs.x.ai/grok-bot/overview)、[安装与登录](https://docs.x.ai/grok-bot/get-started)

截至本次核查，未找到官方公开的 **Grok Bot CLI、ACP、SDK、Bot 控制 API 或完整网页嵌入入口**。官方文档目录包含 Bot 使用、电脑、协作、技能和企业管理，但没有 Bot 开发接口章节。这是公开资料检索的结论，不能据此断言内部或合作方接口不存在。[官方文档目录](https://docs.x.ai/llms.txt)、[Bot FAQ](https://docs.x.ai/grok-bot/faq)

## 不同接入渠道

| 产品／渠道 | 已核实的能力 | 对 Harness 的意义 |
| --- | --- | --- |
| Grok Build | CLI、无界面脚本模式；`grok agent stdio` 提供 ACP | 可直接维持现有本地代理接入 |
| xAI 模型 API | REST 模型推理、工具及媒体能力 | 可自行构建代理，但不会自动获得官方 Bot 的聊天、记忆和云电脑 |
| Grok Bot 应用 | 持久云电脑、Bot 对话、多人协作、例行任务 | 目前没有核实可供 Harness 驱动这些功能的公开接口 |
| Bot 模板链接 | 网页预览配置，再由官方应用添加副本 | 可作为配置分享入口，不能嵌入现有 Bot 对话和电脑 |
| Bot Connectors | 在官方 Bot 内安装连接器，访问外部应用 | 文档描述的是 Bot 调用外部工具，不是外部应用控制 Bot 的入口 |

来源：[Build 无界面模式与 ACP](https://docs.x.ai/build/cli/headless-scripting)、[模型 API](https://docs.x.ai/overview)、[Bot 协作](https://docs.x.ai/grok-bot/chat-and-collaboration)、[Bot 分享](https://docs.x.ai/grok-bot/bots)、[Bot 连接器](https://docs.x.ai/grok-bot/computer-and-apps)。

## 可实施方案

1. **应用之间交接任务**：Harness 可以整理任务描述和结果文件，提供复制、导出和打开官方产品入口的操作。这属于两个应用之间的交接。带任务参数的深链接尚未核实，不能假设打开应用即可自动发送任务。
2. **继续通过 Build 扩展本地能力**：沿用 ACP，结合已有的技能、MCP 和本地工具。可以实现部分相似工作流，但产品和状态属于 Harness／Build，不能称为官方 Bot 接入。
3. **完整接入 Bot**：需要官方支持的认证和传输接口，至少覆盖 Bot／会话发现、发送和流式事件、任务取消、权限审批、结果文件、云电脑状态。现有公开资料不足以实现并验证这一方案。

建议当前优先完善 Build／ACP 的桌面体验。若后续要做 Bot 交接，可先实现任务包导出；完整接入应以官方提供可验证的接口为前提。本次只完成评估，没有加入未经验证的 Bot 入口。
