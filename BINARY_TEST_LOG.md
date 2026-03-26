# Norma 二元测试执行日志

## 执行记录 | 2026-03-24 16:58

**执行命令**: `npm test`
**测试类型**: 全量测试（含真实链路测试）
**总测试数**: 276
**Pass**: 276 ✅
**Fail**: 0 ❌
**执行时间**: 51.95s

---

## 测试详情

### 真实链路测试（E2E）

| ID | 测试场景 | 结果 | 执行时间 | 关键指标 |
|------|----------|------|----------|----------|
| SCENE-01 | 用户初次使用 - 建立基础互动 | ✅ Pass | 5.8s | 人格创建成功，消息记录正常 |
| SCENE-02 | 用户遇到问题 - 表达不满情绪 | ✅ Pass | 5.7s | State P: 0.202→-0.096（负面情绪影响） |
| SCENE-03 | 正向互动 - 用户感谢和认可 | ✅ Pass | 9.1s | Trust: 0.475→0.495（信任增加） |
| SCENE-04 | 记忆检索 - 测试 Recall 功能 | ✅ Pass | <1s | 找到 5 条相关消息 |
| SCENE-05 | 演化历史 - 验证演化记录 | ✅ Pass | <1s | 4 次 state 演化 |
| SCENE-06 | 叙事生成 - 验证 narrate 功能 | ✅ Pass | <1s | Full: 414 chars, Brief: 21 chars |
| SCENE-07 | 指标统计 - 验证 Metrics 功能 | ✅ Pass | <1s | Messages: 20, Evolutions: 4 |
| SCENE-08 | Embedding 生成 - 测试本地 embedding | ✅ Pass | <1s | 256 dims, norm=1.0000 |
| SCENE-09 | LLM 分析器 - 阿里云 API 真实调用 | ✅ Pass | 4.3s | tone=0.70, sentiment=positive |
| SCENE-10 | 长期演化 - 验证 Trait 变化 | ✅ Pass | 26.3s | **Trait 变化验证成功** |

---

## Trait 变化验证详情

### 初始 vs 最终 Trait 对比

| 维度 | 初始值 | 最终值 | 变化量 | 说明 |
|------|--------|--------|--------|------|
| Openness (O) | 0.500 | 0.504 | +0.0039 | 好奇心略有增加 |
| Conscientiousness (C) | 0.500 | 0.500 | +0.0004 | 基本不变 |
| Extraversion (E) | 0.500 | 0.526 | +0.0260 | 外向性增加（正向互动） |
| Agreeableness (A) | 0.500 | 0.535 | +0.0352 | 愉悦性增加（正向互动） |
| Neuroticism (N) | 0.500 | 0.466 | -0.0339 | 神经质降低（情绪更稳定） |

### State 演化过程

| 演化次数 | Pleasure | Arousal | Dominance |
|----------|----------|---------|-----------|
| 初始 | 0.200 | 0.000 | 0.000 |
| #1 | 0.319 | 0.062 | 0.012 |
| #2 | 0.388 | 0.065 | 0.012 |
| #3 | 0.449 | 0.083 | 0.018 |
| #4 | 0.502 | 0.099 | 0.020 |
| #5 | 0.549 | 0.112 | 0.023 |
| #6 | 0.592 | 0.082 | 0.003 |

### 关键发现

1. **State 变化快** - 6 次演化后愉悦度从 0.200→0.592（+0.392）
2. **Trait 变化慢** - 6 次演化后最大变化仅 0.035（Agreeableness）
3. **正向互动影响** - Extraversion 和 Agreeableness 增加明显
4. **情绪稳定** - Neuroticism 降低（0.500→0.466），人格更健康

---

## 二元评估标准验证

### LLM 分析器 ✅
- [x] 阿里云 DashScope API 调用成功
- [x] 返回有效 SentimentAnalysis 对象
- [x] userTone ∈ [-1, 1]
- [x] emotionalIntensity ∈ [0, 1]
- [x] topicSentiment 为有效枚举值

### Embedding 生成器 ✅
- [x] 本地 embedding 维度正确（256 维）
- [x] L2 归一化正确（norm=1.0）
- [x] 相同文本生成相同 embedding
- [x] embeddingToBuffer 往返无损

### Persona Engine ✅
- [x] initPersona 成功创建人格
- [x] recordMessage 成功记录
- [x] recall 返回相关消息
- [x] evolve 更新 state
- [x] getHistory 返回演化记录
- [x] narrate 生成完整描述
- [x] **State→Trait 累积机制正常工作**

### 关系模式 ✅
- [x] 支持性互动增加信任（0.475→0.495）
- [x] 负面情绪降低愉悦度（0.202→-0.096）
- [x] 信任值限制在 [0, 1]

---

## 测试资产

### 通过测试
- `test/e2e/real-chain.test.ts` - 10/10 通过
- 其他 22 个测试文件 - 266/266 通过

### 测试日志
```
[SCENE-02] State change: P=0.202→-0.096
[SCENE-02] Relationship tone: -0.300
[SCENE-03] Trust change: 0.475→0.495
[SCENE-04] Recall found 5 relevant messages
[SCENE-05] Found 4 state evolutions, 0 other records
[SCENE-06] Full narration: 414 chars, Brief: 21 chars
[SCENE-07] Messages: 20, Evolutions: 4, DB Size: 1171456 bytes
[SCENE-08] Embedding generated: 256 dims, norm=1.0000
[SCENE-09] LLM analysis: tone=0.70, intensity=0.40, sentiment=positive
[SCENE-10] Initial Traits: O=0.500 C=0.500 E=0.500 A=0.500 N=0.500
[SCENE-10] Evolve #1-6: P 0.319→0.592（持续上升）
[SCENE-10] Final Traits: O=0.504 C=0.500 E=0.526 A=0.535 N=0.466
[SCENE-10] Trait evolutions: 5（5 次 Trait 更新）
```

---

## 结论

✅ **所有二元测试通过**

测试验证了：
1. LLM 分析器能正确调用阿里云 DashScope API 并返回有效结果
2. Embedding 生成器本地实现正确（256 维，L2 归一化）
3. Persona Engine 完整链路工作正常
4. 情感响应符合预期（正向/负向事件影响 State）
5. 关系模式正确更新（正向互动增加信任）
6. 记忆检索、叙事生成、指标统计功能正常
7. **State→Trait 累积机制正常工作**（需要多次同方向 State 变化）

---

## 配置说明

**LLM 配置**:
- Provider: openai (兼容模式)
- Base URL: https://dashscope.aliyuncs.com/compatible-mode/v1
- Model: deepseek-v3.2
- API Key: sk-411647ea38a94f50ae3f8edbb08974ba

**Embedding 配置**:
- Provider: none (本地 n-gram)
- 维度：256
- 算法：字符 3-gram + 词级 unigram 哈希

**Trait 变化配置**:
- 默认 `stateToTraitThreshold: 20` - 需要 20 次同方向 State 变化才触发 Trait 更新
- 默认 `stateToTraitRate: 0.005` - 每次变化率为 0.5%
- 测试配置 `stateToTraitThreshold: 2`、`stateToTraitRate: 0.05` - 加速验证

**数据库**:
- 路径：~/.norma/test-real-chain.sqlite
- 大小：1.17 MB
- 模式：SQLite + FTS5 + WAL

---

## 下次执行建议

- 可增加更多边界条件测试（如超长文本、特殊字符、并发请求）
- 可添加性能基准测试（API 响应时间、检索延迟）
- 可添加长期演化测试（默认配置下需要 80+ 消息才能触发 Trait 变化）
