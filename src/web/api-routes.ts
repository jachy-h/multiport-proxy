import express, { Router, Request, Response } from 'express';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import { execSync } from 'child_process';
import { ConfigManager } from '../server/config-manager';
import { Logger } from '../server/logger';
import { ProxyServer } from '../server/proxy-server';

// 常用软件端口列表
const RESERVED_PORTS: Record<number, string> = {
  20: 'FTP Data',
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  115: 'SFTP',
  135: 'RPC',
  139: 'NetBIOS',
  143: 'IMAP',
  194: 'IRC',
  443: 'HTTPS',
  445: 'SMB',
  993: 'IMAPS',
  995: 'POP3S',
  1433: 'MSSQL',
  1521: 'Oracle',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5900: 'VNC',
  6379: 'Redis',
  8080: 'HTTP Alt',
  8443: 'HTTPS Alt',
  9090: 'Prometheus',
  27017: 'MongoDB',
};

// 检查端口是否为常用软件端口
function isReservedPort(port: number): { reserved: boolean; service?: string } {
  if (RESERVED_PORTS[port]) {
    return { reserved: true, service: RESERVED_PORTS[port] };
  }
  return { reserved: false };
}

// 检查端口是否被占用
function checkPortAvailable(port: number): { available: boolean; details: string } {
  const isWindows = process.platform === 'win32';
  
  try {
    let command: string;
    let output: string;

    if (isWindows) {
      // Windows 使用 netstat
      command = `netstat -ano | findstr :${port}`;
      output = execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    } else {
      // macOS 和 Linux 使用 lsof
      command = `lsof -i :${port}`;
      output = execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    }

    if (output.trim()) {
      const lines = output.trim().split('\n');
      const details = lines.slice(1).map(line => line.trim()).join('\n');
      return {
        available: false,
        details: `端口 ${port} 已被占用\n\n程序信息:\n${details}`,
      };
    }

    return {
      available: true,
      details: `端口 ${port} 可用`,
    };
  } catch (error: any) {
    // 命令执行失败可能表示端口未被占用
    if (error.status === 1 || error.code === 1) {
      return {
        available: true,
        details: `端口 ${port} 可用`,
      };
    }

    // 其他错误
    return {
      available: false,
      details: `端口 ${port} 检查失败: ${error.message}`,
    };
  }
}

export function createApiRouter(
  configManager: ConfigManager,
  logger: Logger,
  proxyServer: ProxyServer
): Router {
  const router = express.Router();

  // 获取所有配置
  router.get('/config', (req: Request, res: Response) => {
    res.json(configManager.getConfig());
  });

  // 保存配置
  router.post('/config', (req: Request, res: Response) => {
    try {
      const { rules } = req.body;
      if (!Array.isArray(rules)) {
        return res.status(400).json({ error: 'Invalid rules format' });
      }

      configManager.setRules(rules);
      proxyServer.updateProxies();

      res.json({ success: true, message: 'Config saved' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 添加规则
  router.post('/config/rules', async (req: Request, res: Response) => {
    try {
      const rule = req.body;
      if (!rule.id) {
        rule.id = Math.random().toString(36).slice(2);
      }
      rule.enabled = rule.enabled !== false;
      rule.subRules = rule.subRules || [];

      // 为子规则生成 ID
      rule.subRules = rule.subRules.map((sr: any) => ({
        ...sr,
        id: sr.id || Math.random().toString(36).slice(2),
        enabled: sr.enabled !== false,
      }));

      // 检查是否为常用软件端口
      const reservedCheck = isReservedPort(rule.localPort);
      if (reservedCheck.reserved) {
        return res.status(400).json({
          error: 'Reserved port',
          details: `端口 ${rule.localPort} 是 ${reservedCheck.service} 的常用端口，请选择其他端口`,
        });
      }

      // 检查端口是否被占用
      const portCheck = checkPortAvailable(rule.localPort);
      if (!portCheck.available) {
        return res.status(400).json({
          error: 'Port unavailable',
          details: portCheck.details,
        });
      }

      configManager.addRule(rule);
      proxyServer.updateProxies();

      res.json({ success: true, rule });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 更新规则
  router.put('/config/rules/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      // 获取旧规则
      const oldRule = configManager.getConfig().rules.find(r => r.id === id);
      const portChanged = oldRule && oldRule.localPort !== updates.localPort;

      // 如果端口改变了，需要检查新端口是否可用
      if (portChanged) {
        // 检查是否为常用软件端口
        const reservedCheck = isReservedPort(updates.localPort);
        if (reservedCheck.reserved) {
          return res.status(400).json({
            error: 'Reserved port',
            details: `端口 ${updates.localPort} 是 ${reservedCheck.service} 的常用端口，请选择其他端口`,
          });
        }

        // 检查系统端口占用
        const portCheck = checkPortAvailable(updates.localPort);
        if (!portCheck.available) {
          return res.status(400).json({
            error: 'Port unavailable',
            details: portCheck.details,
          });
        }
      }

      // 为子规则生成 ID
      if (updates.subRules) {
        updates.subRules = updates.subRules.map((sr: any) => ({
          ...sr,
          id: sr.id || Math.random().toString(36).slice(2),
          enabled: sr.enabled !== false,
        }));
      }

      configManager.updateRule(id, updates);
      proxyServer.updateProxies();

      res.json({ success: true, message: 'Rule updated' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 删除规则
  router.delete('/config/rules/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      configManager.deleteRule(id);
      proxyServer.updateProxies();

      res.json({ success: true, message: 'Rule deleted' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 获取日志
  router.get('/logs', (req: Request, res: Response) => {
    try {
      const { limit: requestedLimit = '200', offset = '0', port, statusCode } = req.query;
      const parsedLimit = parseInt(requestedLimit as string, 10);
      const parsedOffset = parseInt(offset as string, 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 200;
      const safeOffset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

      let logs;
      if (port) {
        logs = logger.getLogsByPort(parseInt(port as string), limit);
      } else if (statusCode) {
        logs = logger.getLogsByStatusCode(parseInt(statusCode as string), limit);
      } else {
        logs = logger.getLogs(limit, safeOffset);
      }

      res.json({
        logs,
        stats: logger.getStats(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 清空日志
  router.delete('/logs', (req: Request, res: Response) => {
    try {
      logger.clearLogs();
      res.json({ success: true, message: 'Logs cleared' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 获取运行状态
  router.get('/status', (req: Request, res: Response) => {
    res.json({
      runningPorts: proxyServer.getRunningPorts(),
      stats: logger.getStats(),
    });
  });

  // 测试代理连接
  router.post('/config/rules/:id/test', async (req: Request, res: Response) => {
    const { id } = req.params;
    const rules = configManager.getRules();
    const rule = rules.find(r => r.id === id);

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    const startTime = Date.now();
    const timeout = rule.timeout || 10000;
    let settled = false;

    const sendResult = (result: Record<string, unknown>): void => {
      if (settled || res.headersSent || res.writableEnded || res.destroyed) {
        return;
      }

      settled = true;
      res.json(result);
    };

    try {
      let testUrl = rule.targetUrl;

      // 确保 URL 有协议前缀
      if (!testUrl.startsWith('http://') && !testUrl.startsWith('https://')) {
        testUrl = 'http://' + testUrl;
      }

      const urlObj = new URL(testUrl);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options: http.RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname,
        method: 'GET',
        timeout: timeout,
        headers: {
          'User-Agent': 'MultiportProxy-Test/1.0',
        },
      };

      // 如果是 HTTPS，忽略证书错误
      if (isHttps) {
        (options as any).rejectUnauthorized = false;
      }

      const testReq = httpModule.request(options, (testRes) => {
        // 本接口只测试连通性，不读取响应内容，但仍需消费响应体以释放连接。
        testRes.resume();
        const duration = Date.now() - startTime;
        sendResult({
          success: true,
          statusCode: testRes.statusCode,
          duration,
          message: `网络连接正常 (${testRes.statusCode})`,
        });
      });

      testReq.on('error', (error) => {
        const duration = Date.now() - startTime;
        sendResult({
          success: false,
          duration,
          error: error.message,
          message: `网络连接失败: ${error.message}`,
        });
      });

      testReq.on('timeout', () => {
        const duration = Date.now() - startTime;
        sendResult({
          success: false,
          duration,
          error: 'timeout',
          message: `连接超时 (${timeout}ms)`,
        });
        testReq.destroy();
      });

      testReq.end();
    } catch (error: any) {
      const duration = Date.now() - startTime;
      sendResult({
        success: false,
        duration,
        error: error.message,
        message: `测试失败: ${error.message}`,
      });
    }
  });

  return router;
}
