// 结构化、分级日志。控制平面所有子系统共用。
//
// - 级别：debug < info < warn < error，阈值由 APROG_LOG_LEVEL 控制（默认 info）。
// - 输出：每行一条 JSON（便于采集）；error 走 stderr，其余走 stdout。
// - child(component, baseFields)：派生带固定上下文（如 component / sandboxId）的子 logger。
// - Error 字段被安全序列化（name/message/code/stack/cause），不会丢异常信息。
// - sink 可注入（测试里捕获日志，见 createLogger 第三参）。

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogRecord {
  ts: string;
  level: LogLevel;
  component: string;
  msg: string;
  [field: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(component: string, baseFields?: Record<string, unknown>): Logger;
}

function threshold(): number {
  const lvl = (process.env.APROG_LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
  return ORDER[lvl] ?? ORDER.info;
}

/** 把 Error 摊成可序列化对象，保留 cause 链。 */
function serializeError(e: unknown): unknown {
  if (e instanceof Error) {
    const out: Record<string, unknown> = { name: e.name, message: e.message };
    // 自定义错误上的额外字段（如 code / retryable）
    for (const k of ['code', 'retryable', 'provider'] as const) {
      const v = (e as unknown as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = v;
    }
    if (e.stack) out.stack = e.stack;
    if ('cause' in e && e.cause !== undefined) out.cause = serializeError(e.cause);
    return out;
  }
  return e;
}

function normalizeFields(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? serializeError(v) : v;
  }
  return out;
}

const defaultSink: LogSink = (record) => {
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({ ts: record.ts, level: record.level, component: record.component, msg: record.msg, _serializeError: true });
  }
  const stream = record.level === 'error' ? process.stderr : process.stdout;
  stream.write(line + '\n');
};

/** 建一个 logger。component 标识子系统；base 为每条记录附带的固定字段；sink 可注入（测试用）。 */
export function createLogger(component: string, base: Record<string, unknown> = {}, sink: LogSink = defaultSink): Logger {
  const baseNorm = normalizeFields(base);

  function log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (ORDER[level] < threshold()) return;
    const record: LogRecord = {
      ts: new Date().toISOString(),
      level,
      component,
      msg,
      ...baseNorm,
      ...normalizeFields(fields),
    };
    sink(record);
  }

  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
    child: (childComponent, childFields = {}) =>
      createLogger(childComponent, { ...baseNorm, ...normalizeFields(childFields) }, sink),
  };
}
