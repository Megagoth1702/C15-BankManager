import { writable } from 'svelte/store';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  step: string;
  message: string;
  detail?: string;
}

let nextId = 1;
let entries: LogEntry[] = [];
let bucketId = '';

/** Subscribe in DebugLogPanel to refresh the view. */
export const logVersion = writable(0);

export function getLogEntries(): LogEntry[] {
  return entries;
}

export function getLogBucket(): string {
  return bucketId;
}

export function startBucket(id: string): void {
  bucketId = id;
  entries = [];
  logVersion.update((n) => n + 1);
  log('session', `Bucket started: ${id}`);
}

export function log(
  step: string,
  message: string,
  detail?: unknown,
  level: LogLevel = 'info',
): void {
  const entry: LogEntry = {
    id: nextId++,
    time: new Date().toISOString().slice(11, 23),
    level,
    step,
    message,
    detail: detail === undefined ? undefined : stringifyDetail(detail),
  };

  entries.push(entry);
  logVersion.update((n) => n + 1);

  const prefix = `[C15:${bucketId || 'app'}:${step}]`;
  if (level === 'error') console.error(prefix, message, detail ?? '');
  else if (level === 'warn') console.warn(prefix, message, detail ?? '');
  else console.log(prefix, message, detail ?? '');
}

function stringifyDetail(detail: unknown): string {
  try {
    if (typeof detail === 'string') return detail;
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export function downloadLogFile(): void {
  const header = `# C15 Debug Log — bucket: ${bucketId}\n# exported: ${new Date().toISOString()}\n\n`;
  const body = entries
    .map(
      (e) =>
        `${e.time} [${e.level}] ${e.step}: ${e.message}${e.detail ? ` | ${e.detail}` : ''}`,
    )
    .join('\n');

  const blob = new Blob([header + body], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `c15-debug-${bucketId || 'session'}.log`;
  anchor.click();
  URL.revokeObjectURL(url);
}