import * as fs from 'fs';
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

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');

export class ConfigManager {
  private config: Config;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): Config {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error);
    }

    return { rules: [] };
  }

  saveConfig(): void {
    const dataDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
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
