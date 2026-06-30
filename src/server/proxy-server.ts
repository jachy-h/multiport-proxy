import * as http from 'http';
import * as net from 'net';
import httpProxy from 'http-proxy';
import { ConfigManager, ProxyRule, SubRule } from './config-manager';
import { Logger } from './logger';

export class ProxyServer {
  private servers: Map<number, {
    server: http.Server;
    sockets: Set<net.Socket>;
    fingerprint: string;
  }> = new Map();
  private configManager: ConfigManager;
  private logger: Logger;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(configManager: ConfigManager, logger: Logger) {
    this.configManager = configManager;
    this.logger = logger;
  }

  async startProxies(): Promise<void> {
    try {
      await this.updateProxies();
    } catch (error) {
      await this.stopAllProxies('startup failed');
      throw error;
    }
  }

  private ruleFingerprint(rule: ProxyRule): string {
    return JSON.stringify(rule);
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

  private startProxy(rule: ProxyRule): Promise<void> {
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
    const sockets = new Set<net.Socket>();
    server.on('connection', socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });

    return new Promise((resolve, reject) => {
      const onStartupError = (error: NodeJS.ErrnoException) => {
        this.servers.delete(rule.localPort);
        if (error.code === 'EADDRINUSE') {
          console.error(`✗ Proxy failed to start: port ${rule.localPort} is already in use`);
        } else {
          console.error(`✗ Proxy failed to start on port ${rule.localPort}: ${error.message}`);
        }
        reject(error);
      };

      server.once('error', onStartupError);
      server.listen(rule.localPort, () => {
        server.off('error', onStartupError);
        server.on('error', (error: NodeJS.ErrnoException) => {
          console.error(`✗ Proxy error on port ${rule.localPort}: ${error.message}`);
        });
        const subRuleCount = enabledSubRules.length;
        const subInfo = subRuleCount > 0 ? ` (${subRuleCount} sub-rules)` : '';
        console.log(`✓ Proxy port opened: localhost:${rule.localPort} -> ${rule.targetUrl}${subInfo}`);
        resolve();
      });
      this.servers.set(rule.localPort, {
        server,
        sockets,
        fingerprint: this.ruleFingerprint(rule),
      });
    });
  }

  stopProxy(port: number, reason: string = 'requested'): Promise<void> {
    const runningProxy = this.servers.get(port);
    if (!runningProxy) {
      return Promise.resolve();
    }

    this.servers.delete(port);
    return new Promise(resolve => {
      runningProxy.server.close(error => {
        if (error) {
          console.error(`✗ Proxy port ${port} close failed (${reason}): ${error.message}`);
        } else {
          console.log(`✓ Proxy port closed: ${port} (${reason})`);
        }
        resolve();
      });

      // Node.js 18+ can proactively release idle keep-alive connections.
      runningProxy.server.closeIdleConnections?.();
      // Also work on Node.js 16 and ensure a retired port cannot be held by active sockets.
      for (const socket of runningProxy.sockets) {
        socket.destroy();
      }
    });
  }

  async stopAllProxies(reason: string = 'application shutdown'): Promise<void> {
    const ports = Array.from(this.servers.keys());
    if (ports.length === 0) {
      console.log('✓ No proxy ports need to be closed');
      return;
    }

    console.log(`🛑 Closing ${ports.length} proxy port(s): ${ports.join(', ')}`);
    await Promise.all(ports.map(port => this.stopProxy(port, reason)));
  }

  updateProxies(): Promise<void> {
    const update = async () => {
      const desiredRules = new Map<number, ProxyRule>();
      for (const rule of this.configManager.getRules()) {
        if (!rule.enabled) continue;
        if (desiredRules.has(rule.localPort)) {
          console.error(`✗ Duplicate enabled proxy port ${rule.localPort}; ignoring rule ${rule.id}`);
          continue;
        }
        desiredRules.set(rule.localPort, rule);
      }

      for (const [port, runningProxy] of Array.from(this.servers.entries())) {
        const desiredRule = desiredRules.get(port);
        if (!desiredRule) {
          await this.stopProxy(port, 'rule removed or disabled');
        } else if (runningProxy.fingerprint !== this.ruleFingerprint(desiredRule)) {
          await this.stopProxy(port, 'rule updated');
        }
      }

      for (const [port, rule] of desiredRules) {
        if (!this.servers.has(port)) {
          await this.startProxy(rule);
        }
      }
    };

    const queuedUpdate = this.updateQueue.then(update, update);
    this.updateQueue = queuedUpdate.catch(() => undefined);
    return queuedUpdate;
  }

  getRunningPorts(): number[] {
    return Array.from(this.servers.keys());
  }
}
