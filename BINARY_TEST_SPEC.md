# Norma 二元测试标准 (Binary Test Specification)

> 基于 Autoresearch 核心思想：每个测试都有明确的 Pass/Fail 标准，失败时自动触发修复

**版本**: v0.3.0
**最后更新**: 2026-03-24

---

## 测试执行协议

```
┌────────────────────────────────────────────┐
│  Binary Test Execution Protocol            │
├────────────────────────────────────────────┤
│                                            │
│  1. 运行测试套件                           │
│  2. 检查每个测试的 Pass/Fail 状态          │
│  3. 记录结果到 BINARY_TEST_LOG.md         │
│  4. 如有失败：                             │
│     - 生成失败报告                         │
│     - 建议修复方案                         │
│     - (可选) 自动应用修复                  │
│  5. 返回汇总状态                           │
│                                            │
└────────────────────────────────────────────┘
```

---

## Core API 测试清单

### LLM 分析器 (llm-analyzer.test.ts)

| ID | Binary Test | Pass 标准 | Fail 触发 |
|----|-------------|-----------|-----------|
| LLM-01 | Anthropic API 能正确调用并返回解析结果 | 返回有效 SentimentAnalysis 对象 | 抛出异常或返回 null |
| LLM-02 | OpenAI API 能正确调用并返回解析结果 | 返回有效 SentimentAnalysis 对象 | 抛出异常或返回 null |
| LLM-03 | Ollama API 能正确调用并返回解析结果 | 返回有效 SentimentAnalysis 对象 | 抛出异常或返回 null |
| LLM-04 | API 失败时自动降级到 rules 分析 | 返回默认值，不崩溃 | 抛出未捕获异常 |
| LLM-05 | JSON 解析容错处理 markdown code block | 正确提取并解析 JSON | 解析失败崩溃 |
| LLM-06 | 缺失字段使用合理默认值 | 所有字段有有效值 | 字段为 undefined |
| LLM-07 | 超出范围字段自动 clamp | 值在有效范围内 | 值超出范围 |
| LLM-08 | 无效枚举值使用 fallback | 使用默认枚举值 | 使用无效值 |

### Embedding 生成器 (embedding.test.ts)

| ID | Binary Test | Pass 标准 | Fail 触发 |
|----|-------------|-----------|-----------|
| EMB-01 | 无配置时使用本地 embedding | 返回 256 维 Float32Array | 抛出异常或维度错误 |
| EMB-02 | OpenAI API 调用成功 | 返回有效 embedding | API 错误未降级 |
| EMB-03 | OpenAI API 失败时降级 | 返回本地 embedding | 抛出未捕获异常 |
| EMB-04 | Ollama API 调用成功 | 返回有效 embedding | API 错误未降级 |
| EMB-05 | 本地 embedding 维度正确 | length === 256 | 维度不匹配 |
| EMB-06 | 相同文本生成相同 embedding | cosine_similarity = 1.0 | 向量不一致 |
| EMB-07 | 不同文本生成不同 embedding | cosine_similarity < 1.0 | 向量完全相同 |
| EMB-08 | 空文本生成零向量 | 所有元素为 0 | 有非零元素 |
| EMB-09 | embedding 经过 L2 归一化 | L2 norm ∈ [0.99, 1.01] | 未归一化 |
| EMB-10 | embeddingToBuffer 往返正确 | 恢复后向量完全相同 | 数据丢失或损坏 |

### Persona Engine (persona-engine.test.ts)

| ID | Binary Test | Pass 标准 | Fail 触发 |
|----|-------------|-----------|-----------|
| PE-01 | initPersona 成功创建人格 | traits 有有效初始值 | 抛出异常或值为 null |
| PE-02 | recordMessage 成功记录 | getMessageCount +1 | 消息未保存 |
| PE-03 | getRecentMessages 返回正确顺序 | 最旧在前，最新在后 | 顺序颠倒 |
| PE-04 | recall 返回相关消息 | 结果包含查询关键词 | 返回空或无关结果 |
| PE-05 | evolve 更新 state | newState 与 previousState 不同 | state 未变化 |
| PE-06 | decayState 执行基线回归 | state 向基线靠近 | state 不变或远离 |
| PE-07 | getHistory 返回演化记录 | 记录包含 layer/values/timestamp | 返回空或结构错误 |
| PE-08 | recordAndMaybeEvolve 达到阈值触发 | evolveResult 有定义 | 未触发演化 |

### Memory Store (store.test.ts)

| ID | Binary Test | Pass 标准 | Fail 触发 |
|----|-------------|-----------|-----------|
| MS-01 | recordMessage 保存成功 | 返回消息包含 id/content | 抛出异常 |
| MS-02 | getRecentMessages 返回限制数量 | length <= limit | 超过 limit |
| MS-03 | getRecentMessages 按时间排序 | timestamp 递增 | 顺序错误 |
| MS-04 | getRecentUserMessages 过滤 role | 只返回 user 消息 | 包含 assistant 消息 |
| MS-05 | getMessageCount 返回正确计数 | count === 实际记录数 | 计数不匹配 |

### Relationship (relationship.test.ts)

| ID | Binary Test | Pass 标准 | Fail 触发 |
|----|-------------|-----------|-----------|
| REL-01 | getRelationship 返回默认值 | trustLevel = 0.5, totalInteractions = 0 | 默认值错误 |
| REL-02 | updateRelationship 更新 avgTone | 滑动平均计算正确 | 计算错误 |
| REL-03 | 支持性互动增加 trust | trustLevel 上升 | trust 不变或下降 |
| REL-04 | 冲突出动降低 trust | trustLevel 下降 | trust 不变或上升 |
| REL-05 | 信任值限制在 [0, 1] | trustLevel ∈ [0, 1] | 超出范围 |

### Narrator (narrator.test.ts)

| ID | Binary Test | Pass 标准 | Fail 触发 |
|----|-------------|-----------|-----------|
| NAR-01 | narrateFullState 生成完整描述 | 包含所有 4 个章节 | 缺少章节 |
| NAR-02 | narrateBrief 返回简短描述 | length < 100 | 过长或空 |
| NAR-03 | 高开放性生成对应描述 | 包含"好奇心 MAX" | 描述不匹配 |
| NAR-04 | 低开放性生成对应描述 | 包含"务实" | 描述不匹配 |
| NAR-05 | 高愉悦度生成对应描述 | 包含"心情超好" | 描述不匹配 |

### Schema (schema.test.ts)

| ID | Binary Test | Pass 标准 | Fail 触发 |
|----|-------------|-----------|-----------|
| SCH-01 | initSchema 创建所有表 | 表存在于 sqlite_master | 缺少表 |
| SCH-02 | initSchema 创建 FTS5 虚拟表 | conversation_fts 存在 | FTS 表不存在 |
| SCH-03 | initSchema 创建索引 | 索引存在于 sqlite_master | 缺少索引 |
| SCH-04 | 表结构包含必要字段 | PRAGMA 返回预期列 | 缺少列 |
| SCH-05 | 多次调用不报错（幂等性） | 不抛出异常 | 抛出异常 |
| SCH-06 | FTS5 支持全文检索 | MATCH 查询返回结果 | 查询失败或无结果 |

### Mechanisms (mechanisms.test.ts)

| ID | Binary Test | Pass 标准 | Fail 触发 |
|----|-------------|-----------|-----------|
| MEC-01 | applyEmotionalInertia 平滑变化 | delta < 原始变化 | 变化幅度不变 |
| MEC-02 | applyNegativityBias 放大负面 | 负面 delta 被放大 | 未放大 |
| MEC-03 | applyBaselineReversion 回归基线 | state 向基线移动 | 远离基线 |
| MEC-04 | hedonicAdaptation 降低敏感度 | 重复刺激后反应降低 | 反应不变或增强 |
| MEC-05 | clamp 限制范围 | 返回值 ∈ [min, max] | 超出范围 |

---

## 真实链路测试（E2E）

### 完整场景测试 (real-chain.test.ts)

| ID | Binary Test | Pass 标准 | Fail 触发 |
|----|-------------|-----------|-----------|
| E2E-01 | 用户初次使用场景 | 人格创建、消息记录、演化触发 | 任一环节失败 |
| E2E-02 | 用户不满情绪场景 | State 愉悦度下降 | State 未变化或上升 |
| E2E-03 | 正向互动场景 | Relationship 信任度上升 | 信任度下降 |
| E2E-04 | 记忆检索功能 | 返回包含关键词的相关消息 | 返回空或无关结果 |
| E2E-05 | 演化历史记录 | 返回有效的演化记录列表 | 返回空或结构错误 |
| E2E-06 | 叙事生成功能 | 生成完整和简短两种描述 | 描述缺失或过短 |
| E2E-07 | 引擎指标统计 | 返回有效的 Metrics 对象 | 指标缺失或为零 |
| E2E-08 | 本地 Embedding 生成 | 256 维向量，L2 归一化 | 维度错误或未归一化 |
| E2E-09 | LLM 真实 API 调用 | 返回有效 SentimentAnalysis | API 调用失败或返回 null |

---

## 执行结果记录

### BINARY_TEST_LOG.md 格式

```markdown
## 执行记录 | 2026-03-24 16:30

**执行命令**: `npm test`
**总测试数**: 266
**Pass**: 266 ✅
**Fail**: 0 ❌
**执行时间**: 2.0s

### 分类统计

| 模块 | Pass | Fail | 通过率 |
|------|------|------|--------|
| LLM 分析器 | 15 | 0 | 100% |
| Embedding | 19 | 0 | 100% |
| Persona Engine | 28 | 0 | 100% |
| ... | ... | ... | ... |

### 失败详情 (如有)

#### [LLM-04] API 失败时自动降级

**失败原因**: Anthropic API 超时未捕获
**堆栈**: ...
**建议修复**: 添加 try-catch 包裹 callAnthropic 函数
```

---

## 自动修复协议 (可选)

当 Binary Test 失败时，可选择启用自动修复：

1. **分析阶段**: 确定失败类型（代码错误/测试错误/环境错误）
2. **规划阶段**: 生成修复方案（修改代码/修改测试/重试）
3. **执行阶段**: 应用修复
4. **验证阶段**: 重新运行测试，确认修复成功

```bash
# 启用自动修复模式
npm run test:fix  # 伪代码，需实现
```

---

## 配置本地 LLM/Embedding

### 默认配置

**LLM 分析器** 默认使用 Norma 自身的 HTTP API：
- Base URL: `http://localhost:19821/v1`
- API Key: `norma-local`
- Model: `default`

**Embedding** 默认使用本地 n-gram（无需外部 API）：
- Provider: `none`
- 维度：256
- 算法：字符 3-gram + 词级 unigram 哈希

### 环境变量覆盖

```bash
# ~/.norma/test-config.env 或 ~/.zshrc

# LLM 配置
export NORMA_LLM_PROVIDER=openai      # anthropic / openai / ollama
export NORMA_LLM_BASE_URL=http://localhost:19821/v1
export NORMA_LLM_API_KEY=your-api-key
export NORMA_LLM_MODEL=deepseek-v3.2

# Embedding 配置
export NORMA_EMBEDDING_PROVIDER=ollama  # none / ollama / openai
export NORMA_EMBEDDING_BASE_URL=http://localhost:11434
export NORMA_EMBEDDING_MODEL=nomic-embed-text
export NORMA_EMBEDDING_API_KEY=optional
```

### 测试模式配置

```bash
# 测试时临时覆盖
NORMA_LLM_BASE_URL=http://test-server:19821/v1 npm test
```

---

## 持续集成检查点

每次 PR 提交前必须通过以下 Binary Test 子集：

| 子集 | 包含测试 | 执行时间 | 必需 |
|------|----------|----------|------|
| smoke | LLM-04, EMB-01, PE-01, PE-05 | < 5s | ✅ |
| core | LLM-*, EMB-*, PE-* | < 30s | ✅ |
| full | 全部 266 个测试 | < 120s | CI |

```bash
npm run test:smoke   # 快速冒烟测试
npm run test:core    # 核心功能测试
npm test             # 全量测试
```
