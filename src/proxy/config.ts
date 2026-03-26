/**
 * Norma Proxy 配置：CLI args + 环境变量解析
 */

export interface ProxyConfig {
  /** 代理监听端口 */
  proxyPort: number;
  /** 上游 LLM API 基础 URL（不含 /chat/completions） */
  targetBaseUrl: string;
  /** 上游 API Key */
  targetApiKey: string;
  /** SQLite 数据库路径 */
  dbPath: string;
  /** 是否启用人格注入 */
  injectionEnabled: boolean;
  /** 是否启用记忆召回注入 */
  memoryRecallEnabled: boolean;
  /** 记忆相关度阈值 (0-1) */
  memoryThreshold: number;
  /** 记忆注入最大 token 粗估上限 */
  memoryMaxTokens: number;
  /** 完整锚点注入间隔（每 N 轮） */
  anchorInterval: number;
}

const DEFAULT_CONFIG: Omit<ProxyConfig, 'targetBaseUrl' | 'targetApiKey'> = {
  proxyPort: 19821,
  dbPath: defaultDbPath(),
  injectionEnabled: true,
  memoryRecallEnabled: true,
  memoryThreshold: 0.3,
  memoryMaxTokens: 800,
  anchorInterval: 20,
};

function defaultDbPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return `${home}/.norma/db.sqlite`;
}

/** 从 CLI args + 环境变量加载配置，CLI 优先 */
export function loadProxyConfig(argv: string[] = process.argv.slice(2)): ProxyConfig {
  const args = parseCliArgs(argv);
  const env = parseEnvVars();

  const targetBaseUrl = args['target-url'] || env.targetBaseUrl;
  const targetApiKey = args['target-key'] || env.targetApiKey;

  if (!targetBaseUrl) {
    throw new Error(
      '缺少上游 API URL。请通过 --target-url 或 NORMA_PROXY_TARGET_URL 指定'
    );
  }
  if (!targetApiKey) {
    throw new Error(
      '缺少上游 API Key。请通过 --target-key 或 NORMA_PROXY_TARGET_KEY 指定'
    );
  }

  return {
    proxyPort: toInt(args['port']) || toInt(env.proxyPort) || DEFAULT_CONFIG.proxyPort,
    targetBaseUrl: targetBaseUrl.replace(/\/+$/, ''),
    targetApiKey,
    dbPath: args['db'] || env.dbPath || DEFAULT_CONFIG.dbPath,
    injectionEnabled:
      args['no-inject'] !== undefined ? false :
      env.injectionEnabled ?? DEFAULT_CONFIG.injectionEnabled,
    memoryRecallEnabled:
      args['no-memory'] !== undefined ? false :
      env.memoryRecallEnabled ?? DEFAULT_CONFIG.memoryRecallEnabled,
    memoryThreshold:
      toFloat(args['memory-threshold']) || toFloat(env.memoryThreshold) || DEFAULT_CONFIG.memoryThreshold,
    memoryMaxTokens:
      toInt(args['memory-max-tokens']) || toInt(env.memoryMaxTokens) || DEFAULT_CONFIG.memoryMaxTokens,
    anchorInterval:
      toInt(args['anchor-interval']) || toInt(env.anchorInterval) || DEFAULT_CONFIG.anchorInterval,
  };
}

function parseCliArgs(argv: string[]): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = '';
      }
    }
  }
  return result;
}

interface EnvConfig {
  targetBaseUrl?: string;
  targetApiKey?: string;
  proxyPort?: string;
  dbPath?: string;
  injectionEnabled?: boolean;
  memoryRecallEnabled?: boolean;
  memoryThreshold?: string;
  memoryMaxTokens?: string;
  anchorInterval?: string;
}

function parseEnvVars(): EnvConfig {
  return {
    targetBaseUrl: process.env.NORMA_PROXY_TARGET_URL,
    targetApiKey: process.env.NORMA_PROXY_TARGET_KEY,
    proxyPort: process.env.NORMA_PROXY_PORT,
    dbPath: process.env.NORMA_DB_PATH,
    injectionEnabled:
      process.env.NORMA_PROXY_INJECTION === undefined
        ? undefined
        : process.env.NORMA_PROXY_INJECTION !== '0',
    memoryRecallEnabled:
      process.env.NORMA_PROXY_MEMORY === undefined
        ? undefined
        : process.env.NORMA_PROXY_MEMORY !== '0',
    memoryThreshold: process.env.NORMA_PROXY_MEMORY_THRESHOLD,
    memoryMaxTokens: process.env.NORMA_PROXY_MEMORY_MAX_TOKENS,
    anchorInterval: process.env.NORMA_PROXY_ANCHOR_INTERVAL,
  };
}

function toInt(v: string | undefined): number | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

function toFloat(v: string | undefined): number | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}
