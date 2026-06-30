# 快速开始

## 安装依赖

```bash
pnpm install
```

## 开发模式

启动项目并自动打开 Web UI：

```bash
pnpm run dev
```

项目会：
1. 启动代理服务，监听配置的端口
2. 启动 Web 服务器（localhost:8888）
3. 自动打开浏览器访问配置页面

## 生产模式

编译并启动：

```bash
pnpm run build
pnpm start
```

## 使用指南

### 1. 添加代理规则

点击"新增规则"按钮，填写以下信息：

- **本地监听端口**：应用监听的端口，如 3000
- **目标服务地址**：代理目标地址，如 http://api.example.com
- **超时时间**：请求超时时间（毫秒），默认 30000ms
- **重试次数**：连接失败时的重试次数，默认 0
- **启用 CORS**：勾选后可配置允许的来源
- **启用此规则**：勾选后规则生效

### 2. 查看实时日志

- 右侧日志面板会实时显示所有请求
- 显示请求方法、路径、状态码和耗时
- 支持按文本搜索筛选日志
- 点击"清空"按钮清除所有日志

### 3. 配置示例

#### 本地开发环境

代理前端开发服务器到本地 API：

```
本地端口: 3000
目标地址: http://localhost:8080
启用 CORS: 是
```

然后访问 http://localhost:3000，所有请求会被转发到 http://localhost:8080

#### 多个后端服务

同时代理多个后端服务：

```
规则 1:
  本地端口: 3000
  目标地址: http://api-v1.example.com

规则 2:
  本地端口: 3001
  目标地址: http://api-v2.example.com
```

#### CORS 跨域配置

```
本地端口: 5000
目标地址: http://api.example.com
启用 CORS: 是
CORS 来源: http://localhost:3000, http://localhost:3001
```

## API 文档

### 获取配置

```
GET /api/config
```

返回所有代理规则配置。

### 保存配置

```
POST /api/config
```

批量保存所有规则。

### 添加规则

```
POST /api/config/rules
```

请求体：

```json
{
  "localPort": 3000,
  "targetUrl": "http://localhost:8000",
  "timeout": 30000,
  "retries": 0,
  "cors": {
    "enabled": true,
    "origins": ["*"]
  },
  "enabled": true
}
```

### 更新规则

```
PUT /api/config/rules/:id
```

### 删除规则

```
DELETE /api/config/rules/:id
```

### 获取日志

```
GET /api/logs?limit=100&offset=0
```

支持参数：
- `limit`：返回日志条数，默认 100
- `offset`：分页偏移，默认 0
- `port`：按端口筛选
- `statusCode`：按状态码筛选

### 清空日志

```
DELETE /api/logs
```

### 获取运行状态

```
GET /api/status
```

返回运行中的代理端口列表和统计信息。

## 故障排除

### 端口已被占用

如果遇到"Port already in use"错误，可以：

1. 修改配置中的 localPort
2. 或者关闭占用该端口的应用

### 无法连接到目标服务

1. 确认目标服务地址正确
2. 检查目标服务是否正常运行
3. 检查网络连接

### 日志不显示

1. 刷新浏览器页面
2. 检查浏览器控制台是否有错误
3. 确认代理规则已启用

## 配置文件位置

配置会自动保存到：

- macOS / Linux：`~/.config/multiport-proxy/config.json`
- Windows：`%USERPROFILE%\.config\multiport-proxy\config.json`

应用启动时会在终端显示实际使用的绝对路径。若新路径尚无配置，应用会校验旧路径
`./data/config.json`；数据合法时自动复制到新位置，并保留旧文件作为回退。

可以手动编辑此文件进行配置，修改后需要重启应用或通过 Web UI 保存。

## 开发架构

项目采用前后端分离架构：

- **后端**：Node.js + TypeScript + Express
- **前端**：Vanilla JavaScript + HTML/CSS
- **代理库**：http-proxy

主要模块：

- `src/server/proxy-server.ts`：代理服务核心
- `src/server/config-manager.ts`：配置管理
- `src/server/logger.ts`：日志管理
- `src/web/api-routes.ts`：API 路由
- `src/web/ui/`：前端页面和脚本
