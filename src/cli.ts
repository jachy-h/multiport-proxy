#!/usr/bin/env node

import express from 'express';
import * as net from 'net';
import path from 'path';
import { ConfigManager } from './server/config-manager';
import { Logger } from './server/logger';
import { ProxyServer } from './server/proxy-server';
import { createApiRouter } from './web/api-routes';

const WEB_PORT = 8888;

async function main() {
  console.log('🚀 Multiport Proxy Starting...\n');

  // 初始化管理模块
  const configManager = new ConfigManager();
  const logger = new Logger();
  const proxyServer = new ProxyServer(configManager, logger);
  console.log(`💾 Config storage: ${configManager.getConfigPath()}\n`);

  // 显示配置的规则
  const rules = configManager.getRules();
  console.log('📋 Configured Rules:');
  if (rules.length > 0) {
    rules.forEach((rule, index) => {
      const status = rule.enabled ? '✅' : '⏸️';
      const subRuleCount = (rule.subRules || []).filter(sr => sr.enabled).length;
      const subInfo = subRuleCount > 0 ? ` (${subRuleCount} sub-rules)` : '';
      console.log(`   ${status} :${rule.localPort} → ${rule.targetUrl}${subInfo}`);
    });
  } else {
    console.log('   (empty) No rules configured yet');
  }
  console.log('');

  // 启动代理服务
  await proxyServer.startProxies();

  // 创建 Web 服务器
  const app = express();

  app.use(express.json());

  // 静态文件服务
  const uiDir = path.join(__dirname, 'web', 'ui');
  app.use(express.static(uiDir));

  // API 路由
  app.use('/api', createApiRouter(configManager, logger, proxyServer));

  // 根路径返回 HTML
  app.get('/', (req, res) => {
    res.sendFile(path.join(uiDir, 'index.html'));
  });

  // 启动 Web 服务器
  const webServer = app.listen(WEB_PORT, async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✓ Web UI:      http://localhost:${WEB_PORT}`);
    console.log(`✓ Running:     ${proxyServer.getRunningPorts().length} proxy(s)`);
    console.log(`✓ Total rules: ${rules.filter(r => r.enabled).length} enabled / ${rules.length} total`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // 自动打开浏览器
    try {
      const open = (await import('open')).default;
      await open(`http://localhost:${WEB_PORT}`);
    } catch (error) {
      console.log(`Please open http://localhost:${WEB_PORT} in your browser\n`);
    }
  });
  const webSockets = new Set<net.Socket>();
  webServer.on('connection', socket => {
    webSockets.add(socket);
    socket.once('close', () => webSockets.delete(socket));
  });

  // 优雅关闭：先停止接收管理请求，再关闭全部代理端口。
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n\n🛑 Received ${signal}; shutting down...`);

    const closeWebServer = new Promise<void>(resolve => {
      webServer.close(error => {
        if (error) {
          console.error(`✗ Web UI port ${WEB_PORT} close failed: ${error.message}`);
        } else {
          console.log(`✓ Web UI port closed: ${WEB_PORT}`);
        }
        resolve();
      });
      webServer.closeIdleConnections?.();
      for (const socket of webSockets) {
        socket.destroy();
      }
    });

    await Promise.all([
      closeWebServer,
      proxyServer.stopAllProxies(`application shutdown (${signal})`),
    ]);
    console.log('✓ All ports closed; shutdown complete');
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(error => {
  console.error('✗ Failed to start Multiport Proxy:', error);
  process.exitCode = 1;
});
