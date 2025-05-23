import type { DiagnosticEntry, DiagnosticLevel } from "../types.ts";

export class Diagnostics {
  private readonly logs: DiagnosticEntry[] = [];

  clear(): void {
    this.logs.length = 0;
  }

  error(message: string, context?: Record<string, any>) {
    this.log("error", message, context);
  }

  getLogs(filterLevel?: DiagnosticLevel): DiagnosticEntry[] {
    if (filterLevel === undefined) {
      return this.logs.slice();
    }
    return this.logs.filter((log) => log.level === filterLevel);
  }

  info(message: string, context?: Record<string, any>) {
    this.log("info", message, context);
  }

  log(level: DiagnosticLevel, message: string, context?: Record<string, any>) {
    const value: DiagnosticEntry = {
      level,
      message,
      timestamp: Date.now(),
    };

    if (context !== undefined && context !== null) {
      value.context = context;
    }

    this.logs.push(value);
  }

  warn(message: string, context?: Record<string, any>) {
    this.log("warn", message, context);
  }
}
