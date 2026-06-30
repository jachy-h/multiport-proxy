# 测试指南

## 环境准备

### 前置条件
- Node.js >= 16
- pnpm 或 npm
- 浏览器（Chrome、Firefox、Safari 等）

### 安装与启动

```bash
# 1. 安装依赖
pnpm install

# 2. 启动应用
pnpm run dev
```

应用启动后：
- Web UI 自动打开在 http://localhost:8888
- 可以看到控制台输出：✓ Web UI running on http://localhost:8888

## 功能测试

### 1. Web UI 加载测试

**步骤：**
1. 启动应用后，浏览器自动打开 http://localhost:8888
2. 观察 Web 界面是否正确加载

**预期结果：**
- 页面显示"Multiport Proxy"标题
- 左侧显示"代理规则"面板（默认显示示例规则）
- 右侧显示"实时日志"面板
- 所有样式正确应用

---

### 2. 添加新规则测试

**步骤：**
1. 点击"新增规则"按钮
2. 填写表单：
   - 本地监听端口：`3001`
   - 目标服务地址：`http://httpbin.org` (公开测试服务)
   - 超时时间：保持默认 30000
   - 重试次数：保持默认 0
   - 启用 CORS：打勾
   - 启用此规则：打勾
3. 点击"保存"按钮

**预期结果：**
- 弹出"规则已保存！"提示
- Modal 关闭
- 规则列表更新，显示新增的 `:3001 -> http://httpbin.org`
- 控制台输出：`✓ Proxy running: localhost:3001 -> http://httpbin.org`

---

### 3. 编辑规则测试

**步骤：**
1. 点击规则列表中的某个规则
2. Modal 打开，显示该规则的详细信息
3. 修改超时时间为 60000
4. 点击"保存"按钮

**预期结果：**
- 弹出"规则已保存！"提示
- 规则信息更新
- 代理服务重启该端口

---

### 4. 删除规则测试

**步骤：**
1. 编辑某个规则（打开 Modal）
2. 点击"删除"按钮（红色按钮）
3. 确认删除

**预期结果：**
- 弹出"规则已删除！"提示
- Modal 关闭
- 该规则从列表消失
- 对应的代理服务停止

---

### 5. CORS 配置测试

**步骤：**
1. 添加新规则或编辑现有规则
2. 打勾"启用 CORS"
3. 在 CORS 来源输入框填入：`http://localhost:3000`
4. 保存规则

**验证方法：**
1. 打开 Node.js REPL 或新建 test.js：

```javascript
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/get',
  method: 'OPTIONS',
  headers: {
    'Origin': 'http://localhost:3000',
    'Access-Control-Request-Method': 'GET'
  }
};

const req = http.request(options, (res) => {
  console.log('Status:', res.statusCode);
  console.log('CORS Headers:', {
    'Allow-Origin': res.headers['access-control-allow-origin'],
    'Allow-Methods': res.headers['access-control-allow-methods'],
    'Allow-Headers': res.headers['access-control-allow-headers']
  });
});

req.end();
```

**预期结果：**
- 响应头包含 `Access-Control-Allow-Origin: http://localhost:3000`
- `Access-Control-Allow-Methods` 包含所有 HTTP 方法
- `Access-Control-Allow-Headers` 包含常用头

---

### 6. 请求转发测试

**步骤：**
1. 确保规则配置指向 httpbin.org
2. 在命令行执行：

```bash
curl -i http://localhost:3001/get
```

**预期结果：**
- 收到来自 httpbin.org 的响应
- 状态码：200
- 日志面板实时显示该请求

---

### 7. 日志显示测试

**步骤：**
1. 发送几个 HTTP 请求到代理端口
2. 观察右侧日志面板

**预期结果：**
- 日志按时间倒序显示（最新在上）
- 每条日志显示：时间、端口、方法、路径、状态码、耗时
- 统计信息更新：
  - 总请求数
  - 错误数
  - 平均耗时

---

### 8. 日志搜索/过滤测试

**步骤：**
1. 在日志面板的搜索框输入：`/get`
2. 观察日志列表

**预期结果：**
- 日志列表只显示包含 `/get` 的条目
- 其他条目被隐藏
- 清空搜索框后恢复显示所有日志

---

### 9. 清空日志测试

**步骤：**
1. 点击日志面板的"清空"按钮
2. 在确认对话框中选择"确定"

**预期结果：**
- 所有日志被清除
- 日志面板显示"暂无日志"
- 统计信息重置为 0

---

### 10. 请求重试测试

**步骤：**
1. 编辑规则，将"重试次数"设置为 2
2. 停止目标服务（模拟连接失败）
3. 发送 HTTP 请求到代理端口
4. 观察控制台输出

**预期结果：**
- 控制台显示重试信息：`Retry 1/2 for 3001`
- 最终返回 502 Bad Gateway 错误
- 日志显示错误信息

---

### 11. 超时测试

**步骤：**
1. 创建一个慢速响应服务（可用 Node.js 创建）：

```javascript
const http = require('http');
const server = http.createServer((req, res) => {
  setTimeout(() => {
    res.writeHead(200);
    res.end('OK');
  }, 40000); // 40 秒延迟
});
server.listen(9999);
```

2. 配置代理到该服务，超时设为 5000ms
3. 发送请求

**预期结果：**
- 5 秒后请求超时
- 返回 502 错误
- 日志显示错误信息

---

### 12. 配置持久化测试

**步骤：**
1. 创建几个规则
2. 停止应用（按 Ctrl+C）
3. 查看配置文件（启动日志会显示实际路径）：

```bash
# macOS / Linux
cat ~/.config/multiport-proxy/config.json

# Windows PowerShell
Get-Content "$env:USERPROFILE\.config\multiport-proxy\config.json"
```

4. 重新启动应用

**预期结果：**
- config.json 包含所有之前配置的规则
- 重启后规则自动加载
- 代理服务自动启动对应端口

---

### 13. API 端点测试

#### 获取配置
```bash
curl http://localhost:8888/api/config | jq
```

#### 获取日志
```bash
curl 'http://localhost:8888/api/logs?limit=10' | jq
```

#### 获取状态
```bash
curl http://localhost:8888/api/status | jq
```

---

## 压力测试

### 并发请求测试

使用 Apache Bench 工具：

```bash
# 发送 100 个并发请求
ab -n 100 -c 10 http://localhost:3001/get
```

**预期结果：**
- 所有请求成功处理
- 日志面板显示所有请求
- 应用无崩溃

---

## 浏览器兼容性测试

| 浏览器 | 版本 | 状态 |
|-------|------|------|
| Chrome | 最新 | ✅ |
| Firefox | 最新 | ✅ |
| Safari | 最新 | ✅ |
| Edge | 最新 | ✅ |

---

## 故障排除

### 问题：端口已被占用

**解决方案：**
1. 查找占用端口的进程：
```bash
lsof -i :3001
```

2. 修改规则中的本地端口

### 问题：无法连接到目标服务

**检查清单：**
- [ ] 目标服务地址是否正确
- [ ] 目标服务是否运行
- [ ] 网络连接是否正常
- [ ] 防火墙是否阻止连接

### 问题：日志不显示

**解决方案：**
- 刷新浏览器页面
- 检查浏览器控制台错误信息
- 检查是否发送了正确的请求

---

## 性能基准

在开发机上的典型性能（使用 httpbin.org）：

| 指标 | 值 |
|------|-----|
| 平均延迟 | 100-200ms |
| 最大并发 | 100+ |
| 内存占用 | ~50MB |
| CPU 占用 | < 5% (空闲) |

---

## 完成检查清单

在部署到生产环境前，请确保以下项都已通过：

- [ ] 所有单元测试通过
- [ ] Web UI 正确加载
- [ ] 规则 CRUD 操作正常
- [ ] 日志正确记录和显示
- [ ] CORS 配置生效
- [ ] 请求转发成功
- [ ] 配置持久化正常
- [ ] 浏览器兼容性确认
- [ ] 并发请求处理正常
- [ ] 错误处理完善
