---
name: norma-hook
description: "Norma（诺玛）AI 人格记忆集成 — 通过 HTTP API 记录对话并同步人格状态"
homepage: https://github.com/hezhihao/norma
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "events": ["message:received", "message:sent"],
        "requires": {},
        "install": [{ "id": "workspace", "kind": "workspace", "label": "Workspace Hook" }],
      },
  }
---

# Norma Hook

自动将所有对话记录到 Norma 系统，实现跨平台 AI 人格演化。

## 功能

- 拦截 `message:received` 和 `message:sent` 事件
- 将消息数据发送到 `http://127.0.0.1:19820/api/record`
- Norma 服务器负责情感分析、人格演化和记忆存储
- 人格状态同步到 SOUL.md，供 AI 代理感知

## 前置条件

- Norma 服务器运行中（提供 MCP 工具和 HTTP API，端口 19820）
- 启动命令: `norma`（或添加到 MCP 配置）

## 配置

无需额外配置。Hook 自动连接 `http://127.0.0.1:19820`。

自定义端口请设置 `PERSONA_HTTP_PORT` 环境变量。
