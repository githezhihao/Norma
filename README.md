# Norma (诺玛)

> 心理学驱动的 AI 人格记忆引擎，基于 Big Five 特质与 PAD 情绪模型

[![npm version](https://badge.fury.io/js/norma.svg)](https://badge.fury.io/js/norma)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 简介

Norma 是一个 AI 人格记忆引擎，能够让 AI 助手拥有持久的人格特质和情绪状态。它基于心理学双层人格模型：

- **OCEAN 特质层 (Trait)**：开放性、尽责性、外向性、宜人性、神经质
- **PAD 状态层 (State)**：愉悦度、唤醒度、支配度

### 核心特性

- 🧠 **双层人格模型**：稳定的特质 + 动态的情绪状态
- 📊 **自动演化**：基于对话内容自动调整人格状态
- 💾 **持久记忆**：SQLite + 向量存储，支持语义检索
- 🔌 **多模式接入**：MCP 协议 / HTTP API / OpenAI 代理
- 🎭 **LLM 情感分析**：可选的 LLM 增强情感分析
- ⚡ **本地 Embedding**：无需外部 API 的本地向量生成

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                    外部系统                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │ OpenClaw │  │Claude Code│  │ OpenAI 兼容客户端    │   │
│  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘   │
└───────┼─────────────┼───────────────────┼───────────────┘
        │ HTTP        │ MCP               │ HTTP
        ▼             ▼                   ▼
┌─────────────────────────────────────────────────────────┐
│                    Norma Core                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ HTTP Server │  │ MCP Server  │  │ OpenAI Proxy    │  │
│  │  (19820)    │  │  (stdio)    │  │  (19821)        │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
│         └────────────────┼──────────────────┘           │
│                          ▼                              │
│              ┌───────────────────────┐                  │
│              │    PersonaEngine      │                  │
│              │  ┌───────┐ ┌───────┐  │                  │
│              │  │ Trait │ │ State │  │                  │
│              │  │ OCEAN │ │  PAD  │  │                  │
│              │  └───────┘ └───────┘  │                  │
│              └───────────────────────┘                  │
│                          │                              │
│              ┌───────────┴───────────┐                  │
│              ▼                       ▼                  │
│      ┌───────────────┐     ┌─────────────────┐         │
│      │ Memory Store  │     │ LLM Analyzer    │         │
│      │ SQLite + Vec  │     │ (可选)          │         │
│      └───────────────┘     └─────────────────┘         │
└─────────────────────────────────────────────────────────┘
```

## 安装

```bash
npm install norma
```

或从源码安装：

```bash
git clone https://github.com/your-username/norma.git
cd norma
npm install
npm run build
```

## 快速开始

### 1. 作为 MCP 服务器使用

在 Claude Code 或其他 MCP 客户端中配置：

```json
{
  "mcpServers": {
    "norma": {
      "command": "npx",
      "args": ["norma"],
      "env": {
        "NORMA_LLM_PROVIDER": "openai",
        "NORMA_LLM_API_KEY": "your-api-key",
        "NORMA_LLM_MODEL": "gpt-4o-mini"
      }
    }
  }
}
```

### 2. 作为独立 HTTP 服务

```bash
# 启动核心服务
npx norma-core --port 19820

# 或启动 OpenAI 兼容代理
npx norma-proxy --port 19821 --target-url https://api.openai.com/v1 --target-key your-api-key
```

### 3. HTTP API 调用

```bash
# 记录消息
curl -X POST http://localhost:19820/api/record \
  -H "Content-Type: application/json" \
  -d '{"role": "user", "content": "你好！", "platform": "test"}'

# 获取人格状态
curl http://localhost:19820/api/state

# 触发演化
curl -X POST http://localhost:19820/api/evolve \
  -H "Content-Type: application/json" \
  -d '{"messageCount": 5}'

# 语义检索记忆
curl "http://localhost:19820/api/recall?query=你好"
```

## 配置

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `NORMA_LLM_PROVIDER` | LLM 提供商 | `none` |
| `NORMA_LLM_API_KEY` | LLM API Key | - |
| `NORMA_LLM_BASE_URL` | LLM API Base URL | - |
| `NORMA_LLM_MODEL` | LLM 模型 | - |
| `NORMA_EMBEDDING_PROVIDER` | Embedding 提供商 | `none` (本地哈希) |
| `NORMA_EMBEDDING_API_KEY` | Embedding API Key | - |
| `NORMA_EMBEDDING_BASE_URL` | Embedding API URL | - |
| `NORMA_EMBEDDING_MODEL` | Embedding 模型 | - |
| `NORMA_DB_PATH` | 数据库路径 | `~/.norma/db.sqlite` |
| `PERSONA_HTTP_PORT` | HTTP 服务端口 | `19820` |

### LLM 提供商配置示例

**OpenAI:**
```bash
export NORMA_LLM_PROVIDER=openai
export NORMA_LLM_API_KEY=sk-xxx
export NORMA_LLM_MODEL=gpt-4o-mini
```

**阿里云 DashScope:**
```bash
export NORMA_LLM_PROVIDER=openai
export NORMA_LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export NORMA_LLM_API_KEY=sk-xxx
export NORMA_LLM_MODEL=qwen3.5-flash
```

**Ollama:**
```bash
export NORMA_LLM_PROVIDER=ollama
export NORMA_LLM_MODEL=llama3
```

### Embedding 配置示例

**本地哈希 (默认，无需配置):**
- 速度快 (~0.1ms)
- 256 维
- 无需外部依赖

**Ollama:**
```bash
export NORMA_EMBEDDING_PROVIDER=ollama
export NORMA_EMBEDDING_MODEL=nomic-embed-text
```

**OpenAI:**
```bash
export NORMA_EMBEDDING_PROVIDER=openai
export NORMA_EMBEDDING_API_KEY=sk-xxx
```

## MCP 工具

Norma 提供以下 MCP 工具：

| 工具名 | 说明 |
|--------|------|
| `persona_state` | 获取当前人格状态 |
| `persona_init` | 初始化人格特质 |
| `persona_record` | 记录对话消息 |
| `persona_evolve` | 手动触发演化 |
| `persona_recall` | 语义检索记忆 |
| `persona_history` | 查看演化历史 |
| `persona_relationship` | 查看关系模式 |
| `persona_config` | 查看/更新配置 |

## 心理学模型

### Big Five / OCEAN 特质

| 特质 | 范围 | 说明 |
|------|------|------|
| Openness (开放性) | 0-1 | 好奇心、创造力 |
| Conscientiousness (尽责性) | 0-1 | 自律、条理性 |
| Extraversion (外向性) | 0-1 | 社交活跃度 |
| Agreeableness (宜人性) | 0-1 | 合作、同理心 |
| Neuroticism (神经质) | 0-1 | 情绪稳定性 |

### PAD 情绪状态

| 维度 | 范围 | 说明 |
|------|------|------|
| Pleasure (愉悦度) | -1 到 1 | 正负情绪 |
| Arousal (唤醒度) | -1 到 1 | 激活程度 |
| Dominance (支配度) | -1 到 1 | 控制感 |

### 演化机制

1. **消息记录**：每条消息被记录到数据库
2. **情感分析**：通过规则或 LLM 分析情感
3. **状态更新**：PAD 状态根据分析结果调整
4. **特质漂移**：长期状态累积影响特质

## 与 OpenClaw 集成

### 方式一：Hook 集成

在 OpenClaw 配置中添加 hook：

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "persona-hook": {
          "enabled": true
        }
      }
    }
  }
}
```

Hook 文件位于 `src/adapters/openclaw/handler.ts`。

### 方式二：代理集成

配置 OpenClaw 使用 Norma 代理：

```json
{
  "models": {
    "providers": {
      "norma": {
        "baseUrl": "http://127.0.0.1:19821/v1",
        "api": "openai-completions"
      }
    }
  }
}
```

## Dashboard

访问 `http://localhost:19820/dashboard` 可视化查看人格状态和演化趋势。

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 测试
npm test

# 测试监听模式
npm run test:watch
```

## 项目结构

```
src/
├── core/
│   └── persona-engine.ts   # 核心引擎
├── persona/
│   ├── traits.ts           # OCEAN 特质
│   ├── states.ts           # PAD 状态
│   ├── analyzer.ts         # 规则情感分析
│   ├── llm-analyzer.ts     # LLM 情感分析
│   └── narrator.ts         # 状态叙述生成
├── memory/
│   ├── store.ts            # 消息存储
│   ├── retrieval.ts        # 记忆检索
│   └── embedding.ts        # 向量生成
├── db/
│   ├── connection.ts       # 数据库连接
│   └── schema.ts           # 表结构
├── proxy/
│   ├── server.ts           # OpenAI 代理服务
│   ├── injector.ts         # 人格注入
│   └── recorder.ts         # 消息记录
├── adapters/
│   ├── openclaw/           # OpenClaw 适配器
│   └── claude-code/        # Claude Code 适配器
├── server.ts               # MCP 服务器
├── http-server.ts          # HTTP 服务器
├── core-entry.ts           # Core 入口
├── proxy-entry.ts          # Proxy 入口
└── index.ts                # MCP 入口
```

## 许可证

MIT License

## 致谢

- Big Five 人格模型 (OCEAN)
- PAD 情绪模型
- Model Context Protocol (MCP)