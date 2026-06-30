import * as http from 'http';
import httpProxy from 'http-proxy';
import { ConfigManager, ProxyRule, SubRule } from './config-manager';
import { Logger } from './logger';

export class ProxyServer {
  private servers: Map<number, http.Server> = new Map();
  private configManager: ConfigManager;
  private logger: Logger;

  constructor(configManager: ConfigManager, logger: Logger) {
    this.configManager = configManager;
    this.logger = logger;
  }

  startProxies(): void {
    const rules = this.configManager.getRules().filter(r => r.enabled);
    for (const rule of rules) {
      this.startProxy(rule);
    }
  }

  private matchSubRule(subRules: SubRule[], path: string): SubRule | null {
    for (const subRule of subRules) {
      if (!subRule.enabled) continue;
      
      if (subRule.type === 'prefix') {
        if (path.startsWith(subRule.pattern)) {
          return subRule;
        }
      } else if (subRule.type === 'regex') {
        try {
          const regex = new RegExp(subRule.pattern);
          if (regex.test(path)) {
            return subRule;
          }
        } catch (e) {
          console.error(`Invalid regex pattern: ${subRule.pattern}`);
        }
      }
    }
    return null;
  }

  private startProxy(rule: ProxyRule): void {
    if (this.servers.has(rule.localPort)) {
      this.stopProxy(rule.localPort);
    }

    const enabledSubRules = (rule.subRules || []).filter(sr => sr.enabled);

    const server = http.createServer((req, res) => {
      const startTime = Date.now();
      const path = req.url || '/';

      // 匹配子规则
      const matchedSubRule = enabledSubRules.length > 0 
        ? this.matchSubRule(enabledSubRules, path) 
        : null;
      
      // 确定目标地址
      const targetUrl = matchedSubRule ? matchedSubRule.targetUrl : rule.targetUrl;

      const proxy = httpProxy.createProxyServer({
        target: targetUrl,
        timeout: rule.timeout || 30000,
        changeOrigin: true,
        secure: false,
        followRedirects: true,
        autoRewrite: true,
      });

      // 处理 CORS
      if (rule.cors?.enabled) {
        const origins = rule.cors.origins || ['*'];
        const origin = req.headers.origin || '*';
        
        if (origins.includes('*') || origins.includes(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, *');
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
      }

      // 处理 OPTIONS 请求
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 代理请求
      let retryCount = 0;
      const maxRetries = rule.retries || 0;

      const handleRequest = () => {
        proxy.web(req, res);
      };

      // 错误处理
      proxy.on('error', (error: Error) => {
        const duration = Date.now() - startTime;

        if (retryCount < maxRetries) {
          retryCount++;
          console.log(`Retry ${retryCount}/${maxRetries} for ${rule.localPort}`);
          handleRequest();
          return;
        }

        console.error(`[${rule.localPort}] Proxy error:`, error.message);
        console.error(`[${rule.localPort}] Request: ${req.method} ${path}`);
        console.error(`[${rule.localPort}] Target: ${targetUrl}`);

        this.logger.addLog({
          timestamp: Date.now(),
          localPort: rule.localPort,
          method: req.method || 'GET',
          path,
          duration,
          targetUrl: targetUrl,
          error: error.message,
        });

        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Bad Gateway',
            message: error.message,
            target: targetUrl,
            path,
          }));
        }
      });

      // 监听代理响应
      proxy.once('proxyRes', (proxyRes: http.IncomingMessage) => {
        const duration = Date.now() - startTime;

        this.logger.addLog({
          timestamp: Date.now(),
          localPort: rule.localPort,
          method: req.method || 'GET',
          path,
          statusCode: proxyRes.statusCode,
          duration,
          targetUrl: targetUrl,
        });
      });

      handleRequest();
    });

    try {
      server.listen(rule.localPort, () => {
        const subRuleCount = enabledSubRules.length;
        const subInfo = subRuleCount > 0 ? ` (${subRuleCount} sub-rules)` : '';
        console.log(`✓ Proxy running: localhost:${rule.localPort} -> ${rule.targetUrl}${subInfo}`);
      });

      server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`✗ Port ${rule.localPort} is already in use`);
        } else {
          console.error(`✗ Error on port ${rule.localPort}:`, error.message);
        }
      });

      this.servers.set(rule.localPort, server);
    } catch (error) {
      console.error(`Failed to start proxy on port ${rule.localPort}:`, error);
    }
  }

  stopProxy(port: number): void {
    const server = this.servers.get(port);
    if (server) {
      server.close();
      this.servers.delete(port);
      console.log(`✓ Proxy stopped on port ${port}`);
    }
  }

  stopAllProxies(): void {
    for (const port of this.servers.keys()) {
      this.stopProxy(port);
    }
  }

  updateProxies(): void {
    this.stopAllProxies();
    this.startProxies();
  }

  getRunningPorts(): number[] {
    return Array.from(this.servers.keys());
  }
}
