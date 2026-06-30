let currentEditingId = null;
let currentSubRules = [];
const LOG_DISPLAY_LIMIT = 200;
let isLoadingLogs = false;
let lastRenderedLogIds = null;
let pendingConfirmation = null;
let confirmationTrigger = null;

const TOAST_ICONS = {
  success: '✓',
  error: '!',
  warning: '!',
  info: 'i',
};

function showToast(message, type = 'info', title = '') {
  const region = document.getElementById('toastRegion');
  const toast = document.createElement('div');
  const toastTitle = title || {
    success: '操作成功',
    error: '操作未完成',
    warning: '请检查输入',
    info: '提示',
  }[type];

  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = TOAST_ICONS[type] || TOAST_ICONS.info;

  const copy = document.createElement('div');
  copy.className = 'toast-copy';
  const heading = document.createElement('strong');
  heading.textContent = toastTitle;
  const body = document.createElement('span');
  body.textContent = message;
  copy.append(heading, body);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'toast-close';
  closeButton.setAttribute('aria-label', '关闭提示');
  closeButton.textContent = '×';

  const dismiss = () => {
    if (toast.classList.contains('leaving')) return;
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  closeButton.addEventListener('click', dismiss);
  toast.append(icon, copy, closeButton);
  region.appendChild(toast);
  setTimeout(dismiss, type === 'error' ? 6000 : 3600);
}

function requestConfirmation({ title, message, confirmLabel = '确认', danger = true }) {
  const modal = document.getElementById('confirmModal');
  const actionButton = document.getElementById('confirmActionBtn');
  confirmationTrigger = document.activeElement;
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  actionButton.textContent = confirmLabel;
  actionButton.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  requestAnimationFrame(() => document.getElementById('confirmCancelBtn').focus());
  return new Promise(resolve => {
    pendingConfirmation = resolve;
  });
}

function settleConfirmation(confirmed) {
  if (!pendingConfirmation) return;
  const resolve = pendingConfirmation;
  pendingConfirmation = null;
  const modal = document.getElementById('confirmModal');
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.getElementById('ruleModal').classList.contains('show')) {
    document.body.classList.remove('modal-open');
  }
  if (confirmationTrigger && typeof confirmationTrigger.focus === 'function') {
    confirmationTrigger.focus();
  }
  confirmationTrigger = null;
  resolve(confirmed);
}

// 启用 CORS 复选框的事件监听
document.addEventListener('DOMContentLoaded', () => {
  const corsCheckbox = document.getElementById('ruleCorsEnabled');
  const corsOrigins = document.getElementById('corsOrigins');
  
  corsCheckbox.addEventListener('change', (e) => {
    corsOrigins.style.display = e.target.checked ? 'block' : 'none';
  });

  // 端口输入验证
  const portInput = document.getElementById('rulePort');
  portInput.addEventListener('input', validatePort);
  portInput.addEventListener('blur', validatePort);

  // 初始化
  loadRules();
  loadLogs();
  
  // 定时刷新日志
  setInterval(() => {
    if (!document.hidden) loadLogs();
  }, 2000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadLogs();
  });

  // 日志筛选
  document.getElementById('logFilter').addEventListener('input', filterLogs);

  document.getElementById('confirmCancelBtn').addEventListener('click', () => settleConfirmation(false));
  document.getElementById('confirmActionBtn').addEventListener('click', () => settleConfirmation(true));
  document.getElementById('confirmModal').addEventListener('click', event => {
    if (event.target.id === 'confirmModal') settleConfirmation(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && pendingConfirmation) {
      event.preventDefault();
      settleConfirmation(false);
      return;
    }

    if (event.key === 'Tab' && pendingConfirmation) {
      const cancelButton = document.getElementById('confirmCancelBtn');
      const actionButton = document.getElementById('confirmActionBtn');
      if (event.shiftKey && document.activeElement === cancelButton) {
        event.preventDefault();
        actionButton.focus();
      } else if (!event.shiftKey && document.activeElement === actionButton) {
        event.preventDefault();
        cancelButton.focus();
      }
    }
  });
});

// 验证端口
function validatePort() {
  const port = parseInt(document.getElementById('rulePort').value);
  const hint = document.getElementById('portHint');
  
  // 常用软件端口列表
  const reservedPorts = {
    20: 'FTP Data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP',
    53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS',
    445: 'SMB', 993: 'IMAPS', 995: 'POP3S', 1433: 'MSSQL', 1521: 'Oracle',
    3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL', 5900: 'VNC',
    6379: 'Redis', 8080: 'HTTP Alt', 8443: 'HTTPS Alt', 9090: 'Prometheus',
    27017: 'MongoDB',
  };

  if (isNaN(port) || port < 1 || port > 65535) {
    hint.textContent = '';
    hint.style.display = 'none';
    return;
  }

  if (reservedPorts[port]) {
    hint.textContent = `端口 ${port} 是 ${reservedPorts[port]} 的常用端口，请选择其他端口`;
    hint.className = 'form-hint error';
    hint.style.display = 'block';
  } else if (port < 1024) {
    hint.textContent = `端口 ${port} 是系统保留端口（<1024），需要管理员权限`;
    hint.className = 'form-hint warning';
    hint.style.display = 'block';
  } else {
    hint.textContent = '';
    hint.style.display = 'none';
  }
}

// 加载规则列表
async function loadRules() {
  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    const rules = data.rules || [];

    const rulesList = document.getElementById('rulesList');
    
    if (rules.length === 0) {
      rulesList.innerHTML = '<div class="loading">暂无规则，点击"新增规则"开始</div>';
      return;
    }

    rulesList.innerHTML = rules.map(rule => {
      const subRules = rule.subRules || [];
      const enabledSubRules = subRules.filter(sr => sr.enabled);
      
      let subRulesHtml = '';
      if (enabledSubRules.length > 0) {
        subRulesHtml = `<div class="sub-rules-preview" aria-label="子规则转发关系">
          ${enabledSubRules.slice(0, 3).map((sr, index) => `
            <div class="sub-rule-route ${sr.type}">
              <span class="sub-rule-order">${index + 1}</span>
              <div class="sub-rule-route-detail">
                <div class="sub-rule-condition">
                  <span class="sub-rule-caption">${sr.type === 'prefix' ? '请求路径以' : '请求路径匹配正则'}</span>
                  <code>${escapeHtml(sr.pattern)}</code>
                  ${sr.type === 'prefix' ? '<span class="sub-rule-caption">开头</span>' : ''}
                </div>
                <div class="sub-rule-forward">
                  <span class="route-arrow" aria-hidden="true">↳</span>
                  <span class="sub-rule-caption">转发到</span>
                  <code>${escapeHtml(sr.targetUrl)}</code>
                </div>
              </div>
            </div>
          `).join('')}
          ${enabledSubRules.length > 3 ? `<span class="sub-rule-more">另有 ${enabledSubRules.length - 3} 条已启用规则</span>` : ''}
        </div>`;
      }

      return `
        <div class="rule-item">
          <div class="rule-item-header" onclick="editRule('${rule.id}')">
            <span class="rule-port">
              :${rule.localPort}
              <span class="rule-status ${rule.enabled ? 'enabled' : 'disabled'}"></span>
            </span>
            <div class="rule-actions" onclick="event.stopPropagation()">
              <button type="button" class="btn btn-rule-action btn-copy" onclick="copyProxyUrl(${rule.localPort}, this)" title="复制 http://localhost:${rule.localPort}" aria-label="复制代理链接 http://localhost:${rule.localPort}">
                <span class="copy-icon" aria-hidden="true">⧉</span>
                <span class="copy-text">复制</span>
              </button>
              <button type="button" class="btn btn-rule-action btn-test" onclick="testRule('${rule.id}', this)" title="测试连接">
                <span class="test-icon">⚡</span>
                <span class="test-text">测试</span>
              </button>
            </div>
          </div>
          <div class="rule-target" onclick="editRule('${rule.id}')">
            <span class="target-label"></span>
            <span class="target-arrow" aria-hidden="true">→</span>
            <span class="default-target-url">${escapeHtml(rule.targetUrl)}</span>
          </div>
          ${subRulesHtml}
          <div class="rule-test-result" id="test-result-${rule.id}"></div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Failed to load rules:', error);
  }
}

// 复制本地代理链接
async function copyProxyUrl(port, button) {
  const proxyUrl = `http://localhost:${port}`;
  const textEl = button.querySelector('.copy-text');

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(proxyUrl);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = proxyUrl;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      try {
        textarea.select();
        if (!document.execCommand('copy')) {
          throw new Error('Copy command failed');
        }
      } finally {
        textarea.remove();
      }
    }

    button.classList.add('copied');
    textEl.textContent = '已复制';
  } catch (error) {
    console.error('Failed to copy proxy URL:', error);
    button.classList.add('copy-failed');
    textEl.textContent = '复制失败';
  }

  setTimeout(() => {
    button.classList.remove('copied', 'copy-failed');
    textEl.textContent = '复制';
  }, 1600);
}

// 打开新增规则表单
function showAddRuleForm() {
  currentEditingId = null;
  currentSubRules = [];
  document.getElementById('modalTitle').textContent = '新增代理规则';
  document.getElementById('deleteBtn').style.display = 'none';
  document.getElementById('ruleForm').reset();
  document.getElementById('ruleTimeout').value = '30000';
  document.getElementById('ruleRetries').value = '0';
  document.getElementById('ruleEnabled').checked = true;
  document.getElementById('ruleCorsEnabled').checked = false;
  document.getElementById('corsOrigins').style.display = 'none';
  document.getElementById('portHint').style.display = 'none';
  renderSubRules();
  document.getElementById('ruleModal').classList.add('show');
  document.body.classList.add('modal-open');
}

// 编辑规则
async function editRule(id) {
  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    const rule = data.rules.find(r => r.id === id);

    if (!rule) return;

    currentEditingId = id;
    currentSubRules = (rule.subRules || []).map(sr => ({ ...sr }));
    
    document.getElementById('modalTitle').textContent = '编辑代理规则';
    document.getElementById('deleteBtn').style.display = 'inline-block';
    document.getElementById('rulePort').value = rule.localPort;
    document.getElementById('ruleTarget').value = rule.targetUrl;
    document.getElementById('ruleTimeout').value = rule.timeout || 30000;
    document.getElementById('ruleRetries').value = rule.retries || 0;
    document.getElementById('ruleEnabled').checked = rule.enabled !== false;
    document.getElementById('ruleCorsEnabled').checked = rule.cors?.enabled || false;
    document.getElementById('ruleCorsOrigins').value = rule.cors?.origins?.join(', ') || '*';
    document.getElementById('corsOrigins').style.display = rule.cors?.enabled ? 'block' : 'none';

    renderSubRules();
    document.getElementById('ruleModal').classList.add('show');
    document.body.classList.add('modal-open');
  } catch (error) {
    console.error('Failed to edit rule:', error);
  }
}

// 渲染子规则列表
function renderSubRules() {
  const container = document.getElementById('subRulesList');
  
  if (currentSubRules.length === 0) {
    container.innerHTML = '<div class="empty-sub-rules">暂无子规则</div>';
    return;
  }

  container.innerHTML = currentSubRules.map((sr, index) => `
    <div class="sub-rule-item ${sr.enabled ? '' : 'disabled'}">
      <div class="sub-rule-header">
        <label class="checkbox">
          <input type="checkbox" ${sr.enabled ? 'checked' : ''} onchange="toggleSubRule(${index})">
        </label>
        <select class="sub-rule-type-select ${sr.type}" onchange="updateSubRuleType(${index}, this.value)">
          <option value="prefix" ${sr.type === 'prefix' ? 'selected' : ''}>前缀匹配</option>
          <option value="regex" ${sr.type === 'regex' ? 'selected' : ''}>正则匹配</option>
        </select>
        <button type="button" class="btn-icon" onclick="removeSubRule(${index})" title="删除">&times;</button>
      </div>
      <div class="sub-rule-body">
        <div class="form-group">
          <label>匹配规则</label>
          <input type="text" value="${escapeHtml(sr.pattern)}" 
                 placeholder="${sr.type === 'prefix' ? '例如: /api' : '例如: ^/api/.*'}"
                 onchange="updateSubRule(${index}, 'pattern', this.value)">
        </div>
        <div class="form-group">
          <label>目标地址</label>
          <input type="url" value="${escapeHtml(sr.targetUrl)}" 
                 placeholder="http://localhost:9000"
                 onchange="updateSubRule(${index}, 'targetUrl', this.value)">
        </div>
      </div>
    </div>
  `).join('');
}

// 添加子规则
function addSubRule() {
  currentSubRules.push({
    id: Math.random().toString(36).slice(2),
    type: 'prefix',
    pattern: '',
    targetUrl: '',
    enabled: true,
  });
  renderSubRules();
}

// 删除子规则
function removeSubRule(index) {
  currentSubRules.splice(index, 1);
  renderSubRules();
}

// 切换子规则启用状态
function toggleSubRule(index) {
  currentSubRules[index].enabled = !currentSubRules[index].enabled;
  renderSubRules();
}

// 更新子规则
function updateSubRule(index, field, value) {
  currentSubRules[index][field] = value;
}

// 更新子规则类型
function updateSubRuleType(index, type) {
  currentSubRules[index].type = type;
  renderSubRules();
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// 保存规则
async function saveRule(e) {
  e.preventDefault();

  // 验证子规则
  for (const sr of currentSubRules) {
    if (sr.enabled && (!sr.pattern || !sr.targetUrl)) {
      showToast('启用的子规则必须同时填写匹配规则和目标地址。', 'warning');
      return;
    }
  }

  const rule = {
    localPort: parseInt(document.getElementById('rulePort').value),
    targetUrl: document.getElementById('ruleTarget').value,
    timeout: parseInt(document.getElementById('ruleTimeout').value),
    retries: parseInt(document.getElementById('ruleRetries').value),
    enabled: document.getElementById('ruleEnabled').checked,
    cors: {
      enabled: document.getElementById('ruleCorsEnabled').checked,
      origins: document.getElementById('ruleCorsOrigins').value
        .split(',')
        .map(o => o.trim())
        .filter(o => o),
    },
    subRules: currentSubRules,
  };

  try {
    if (currentEditingId) {
      const response = await fetch(`/api/config/rules/${currentEditingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Failed to update rule');
      }
    } else {
      const response = await fetch('/api/config/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Failed to add rule');
      }
    }

    closeRuleForm();
    loadRules();
    showToast('端口配置已同步生效。', 'success', '规则已保存');
  } catch (error) {
    console.error('Error saving rule:', error);
    showToast(error.message, 'error', '规则保存失败');
  }
}

// 删除规则
async function deleteRule() {
  if (!currentEditingId) return;
  const port = document.getElementById('rulePort').value;
  const confirmed = await requestConfirmation({
    title: `删除端口 :${port} 的规则？`,
    message: '删除后，该端口会立即停止监听，此操作无法撤销。',
    confirmLabel: '删除规则',
  });
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/config/rules/${currentEditingId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete rule');
    }

    closeRuleForm();
    loadRules();
    showToast(`端口 :${port} 已停止监听。`, 'success', '规则已删除');
  } catch (error) {
    console.error('Error deleting rule:', error);
    showToast(error.message, 'error', '规则删除失败');
  }
}

// 关闭表单
function closeRuleForm() {
  document.getElementById('ruleModal').classList.remove('show');
  if (!document.getElementById('confirmModal').classList.contains('show')) {
    document.body.classList.remove('modal-open');
  }
  currentEditingId = null;
  currentSubRules = [];
}

// 加载日志
async function loadLogs() {
  if (isLoadingLogs) return;
  isLoadingLogs = true;

  try {
    const response = await fetch(`/api/logs?limit=${LOG_DISPLAY_LIMIT}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load logs (${response.status})`);
    }

    const data = await response.json();
    const logs = (data.logs || []).slice(0, LOG_DISPLAY_LIMIT);

    if (data.stats) {
      updateTextIfChanged('totalLogs', data.stats.totalLogs);
      updateTextIfChanged('errorCount', data.stats.errorCount);
      updateTextIfChanged('avgDuration', data.stats.averageDuration + 'ms');
    }

    const logsContainer = document.getElementById('logsContainer');
    const logIds = logs.map(log => log.id).join(',');
    if (logIds === lastRenderedLogIds) return;

    const previousScrollHeight = logsContainer.scrollHeight;
    const previousScrollTop = logsContainer.scrollTop;
    const isFollowingLatest = previousScrollTop < 24;
    lastRenderedLogIds = logIds;

    if (logs.length === 0) {
      logsContainer.innerHTML = '<div class="logs-empty">暂无日志</div>';
      return;
    }

    logsContainer.innerHTML = logs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString('zh-CN');
      const statusCode = Number(log.statusCode);
      const isError = Boolean(log.error) || (Number.isFinite(statusCode) && statusCode >= 400);
      const statusClass = isError ? 'error' : 'success';
      const statusText = log.statusCode || (log.error ? 'ERROR' : '?');
      const duration = Number.isFinite(Number(log.duration)) ? Math.round(Number(log.duration)) : 0;
      const method = String(log.method || 'UNKNOWN').toUpperCase();
      const methodClass = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'].includes(method)
        ? method
        : 'OTHER';

      return `
        <div class="log-entry">
          <span class="log-time">${time}</span>
          <span class="log-port">:${escapeHtml(String(log.localPort))}</span>
          <span class="log-method ${methodClass}">${escapeHtml(method)}</span>
          <span class="log-path">${escapeHtml(log.path || '/')}</span>
          <span class="log-status ${statusClass}">${escapeHtml(String(statusText))}</span>
          <span class="log-duration">${duration}ms</span>
          ${log.error ? `<span class="log-error">${escapeHtml(log.error)}</span>` : ''}
        </div>
      `;
    }).join('');

    if (isFollowingLatest) {
      logsContainer.scrollTop = 0;
    } else {
      logsContainer.scrollTop = previousScrollTop + (logsContainer.scrollHeight - previousScrollHeight);
    }

    filterLogs();
  } catch (error) {
    console.error('Failed to load logs:', error);
  } finally {
    isLoadingLogs = false;
  }
}

function updateTextIfChanged(id, value) {
  const element = document.getElementById(id);
  const nextValue = String(value);
  if (element.textContent !== nextValue) element.textContent = nextValue;
}

// 筛选日志
function filterLogs() {
  const filter = document.getElementById('logFilter').value.toLowerCase();
  const entries = document.querySelectorAll('#logsContainer .log-entry');

  entries.forEach(entry => {
    const text = entry.textContent.toLowerCase();
    entry.style.display = text.includes(filter) ? '' : 'none';
  });
}

// 清空日志
async function clearLogs() {
  const confirmed = await requestConfirmation({
    title: '清空全部请求日志？',
    message: '当前显示的请求记录和统计数据会被清除，此操作无法撤销。',
    confirmLabel: '清空日志',
  });
  if (!confirmed) return;

  try {
    const response = await fetch('/api/logs', {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to clear logs');
    }

    await loadLogs();
    showToast('请求记录与统计数据已清空。', 'success', '日志已清空');
  } catch (error) {
    console.error('Error clearing logs:', error);
    showToast(error.message, 'error', '日志清空失败');
  }
}

// 测试规则连接
async function testRule(id, button) {
  const resultEl = document.getElementById(`test-result-${id}`);
  
  button.disabled = true;
  button.classList.add('testing');
  resultEl.innerHTML = '<span class="testing">测试中...</span>';
  resultEl.style.display = 'block';

  try {
    const response = await fetch(`/api/config/rules/${id}/test`, {
      method: 'POST',
    });
    const data = await response.json();

    if (data.success) {
      resultEl.innerHTML = `<span class="test-success">✓ ${data.message} (${data.duration}ms)</span>`;
    } else {
      resultEl.innerHTML = `<span class="test-fail">✗ ${data.message}</span>`;
    }

    setTimeout(() => {
      resultEl.style.display = 'none';
    }, 3000);
  } catch (error) {
    resultEl.innerHTML = `<span class="test-fail">✗ 测试请求失败: ${error.message}</span>`;
  } finally {
    button.disabled = false;
    button.classList.remove('testing');
  }
}
