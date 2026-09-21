import { reactive } from 'vue';

export interface DiagnosticEntry {
  id: string;
  timestamp: string;
  source: string;
  message: string;
  stack?: string;
}

const MAX_ENTRIES = 50;

export const diagnosticsLog: DiagnosticEntry[] = reactive([]);

function toMessage(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: 'Unknown error (could not be serialized)' };
  }
}

export function logError(source: string, error: unknown): void {
  const { message, stack } = toMessage(error);
  // eslint-disable-next-line no-console
  console.error(`[${source}]`, error);

  diagnosticsLog.unshift({
    id: `ERR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    source,
    message,
    stack,
  });

  if (diagnosticsLog.length > MAX_ENTRIES) {
    diagnosticsLog.length = MAX_ENTRIES;
  }
}

export function clearDiagnostics(): void {
  diagnosticsLog.length = 0;
}

export function formatDiagnosticsReport(): string {
  const envInfo = {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
    timestamp: new Date().toISOString(),
  };
  return JSON.stringify({ environment: envInfo, errors: diagnosticsLog }, null, 2);
}
