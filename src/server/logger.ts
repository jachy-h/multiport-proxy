export interface LogEntry {
  id: string;
  timestamp: number;
  localPort: number;
  method: string;
  path: string;
  statusCode?: number;
  duration: number;
  targetUrl: string;
  error?: string;
}

export class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 500;

  addLog(entry: Omit<LogEntry, 'id'>): LogEntry {
    const logEntry: LogEntry = {
      id: Math.random().toString(36).slice(2),
      ...entry,
    };

    this.logs.unshift(logEntry);

    // 保持日志数量在限制内
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    return logEntry;
  }

  getLogs(limit: number = 100, offset: number = 0): LogEntry[] {
    return this.logs.slice(offset, offset + limit);
  }

  getLogsByPort(port: number, limit: number = 100): LogEntry[] {
    return this.logs.filter(log => log.localPort === port).slice(0, limit);
  }

  getLogsByStatusCode(statusCode: number, limit: number = 100): LogEntry[] {
    return this.logs.filter(log => log.statusCode === statusCode).slice(0, limit);
  }

  clearLogs(): void {
    this.logs = [];
  }

  getAllLogs(): LogEntry[] {
    return this.logs;
  }

  getStats() {
    return {
      totalLogs: this.logs.length,
      errorCount: this.logs.filter(l => l.error || (l.statusCode !== undefined && l.statusCode >= 400)).length,
      averageDuration: this.logs.length > 0
        ? Math.round(this.logs.reduce((sum, log) => sum + log.duration, 0) / this.logs.length)
        : 0,
    };
  }
}
