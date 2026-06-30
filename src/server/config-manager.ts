import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type SubRuleType = 'prefix' | 'regex';

export interface SubRule {
  id: string;
  type: SubRuleType;
  pattern: string;     // 前缀或正则表达式
  targetUrl: string;
  enabled: boolean;
}

export interface ProxyRule {
  id: string;
  localPort: number;
  targetUrl: string;   // 默认目标地址（兜底）
  subRules?: SubRule[]; // 子规则列表，按顺序匹配
  cors?: {
    enabled: boolean;
    origins?: string[];
  };
  timeout?: number;
  retries?: number;
  enabled: boolean;
}

export interface Config {
  rules: ProxyRule[];
}

export function resolveConfigPath(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir()
): string {
  const pathApi = platform === 'win32' ? path.win32 : path;
  return pathApi.join(homeDir, '.config', 'multiport-proxy', 'config.json');
}

const CONFIG_PATH = resolveConfigPath();
const LEGACY_CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isSubRule(value: unknown): value is SubRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Record<string, unknown>;

  return typeof rule.id === 'string'
    && (rule.type === 'prefix' || rule.type === 'regex')
    && typeof rule.pattern === 'string'
    && typeof rule.targetUrl === 'string'
    && typeof rule.enabled === 'boolean';
}

function isProxyRule(value: unknown): value is ProxyRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Record<string, unknown>;
  const cors = rule.cors as Record<string, unknown> | undefined;

  return typeof rule.id === 'string'
    && Number.isInteger(rule.localPort)
    && Number(rule.localPort) >= 1
    && Number(rule.localPort) <= 65535
    && typeof rule.targetUrl === 'string'
    && rule.targetUrl.length > 0
    && typeof rule.enabled === 'boolean'
    && (rule.subRules === undefined || (Array.isArray(rule.subRules) && rule.subRules.every(isSubRule)))
    && (rule.timeout === undefined || (typeof rule.timeout === 'number' && Number.isFinite(rule.timeout)))
    && (rule.retries === undefined || (typeof rule.retries === 'number' && Number.isFinite(rule.retries)))
    && (cors === undefined || (cors !== null
      && typeof cors === 'object'
      && typeof cors.enabled === 'boolean'
      && (cors.origins === undefined || isStringArray(cors.origins))
    ));
}

function isConfig(value: unknown): value is Config {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  return Array.isArray(config.rules) && config.rules.every(isProxyRule);
}

export class ConfigManager {
  private config: Config;

  constructor() {
    this.config = this.loadConfig();
  }

  private readValidConfig(configPath: string): Config | null {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!isConfig(parsed)) {
        console.warn(`Invalid config structure, ignoring: ${configPath}`);
        return null;
      }
      return parsed;
    } catch (error) {
      console.warn(`Failed to read config, ignoring ${configPath}:`, error);
      return null;
    }
  }

  private loadConfig(): Config {
    if (fs.existsSync(CONFIG_PATH)) {
      return this.readValidConfig(CONFIG_PATH) || { rules: [] };
    }

    if (LEGACY_CONFIG_PATH !== CONFIG_PATH && fs.existsSync(LEGACY_CONFIG_PATH)) {
      const legacyConfig = this.readValidConfig(LEGACY_CONFIG_PATH);
      if (legacyConfig) {
        try {
          this.writeConfig(legacyConfig);
          console.log(`✓ Config migrated: ${LEGACY_CONFIG_PATH} → ${CONFIG_PATH}`);
        } catch (error) {
          console.warn(`Failed to migrate config to ${CONFIG_PATH}; using legacy data for this session:`, error);
        }
        return legacyConfig;
      }
    }

    return { rules: [] };
  }

  private writeConfig(config: Config): void {
    const dataDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  }

  saveConfig(): void {
    this.writeConfig(this.config);
  }

  getConfigPath(): string {
    return CONFIG_PATH;
  }

  getConfig(): Config {
    return this.config;
  }

  getRules(): ProxyRule[] {
    return this.config.rules;
  }

  addRule(rule: ProxyRule): void {
    this.config.rules.push(rule);
    this.saveConfig();
  }

  updateRule(id: string, updates: Partial<ProxyRule>): void {
    const index = this.config.rules.findIndex(r => r.id === id);
    if (index !== -1) {
      this.config.rules[index] = { ...this.config.rules[index], ...updates };
      this.saveConfig();
    }
  }

  deleteRule(id: string): void {
    this.config.rules = this.config.rules.filter(r => r.id !== id);
    this.saveConfig();
  }

  setRules(rules: ProxyRule[]): void {
    this.config.rules = rules;
    this.saveConfig();
  }
}
