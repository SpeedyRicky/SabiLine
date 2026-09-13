import { describe, it, expect, beforeEach } from 'vitest';
import { diagnosticsLog, logError, clearDiagnostics, formatDiagnosticsReport } from './diagnostics';

describe('diagnostics logging', () => {
  beforeEach(() => {
    clearDiagnostics();
  });

  it('records a real Error with its message', () => {
    logError('test', new Error('boom'));
    expect(diagnosticsLog).toHaveLength(1);
    expect(diagnosticsLog[0].message).toBe('boom');
    expect(diagnosticsLog[0].source).toBe('test');
  });

  it('handles a malformed / non-Error rejection value without throwing', () => {
    expect(() => logError('fetch', { weird: 'shape' })).not.toThrow();
    expect(diagnosticsLog[0].message).toContain('weird');
  });

  it('handles a plain string error', () => {
    logError('manual', 'something broke');
    expect(diagnosticsLog[0].message).toBe('something broke');
  });

  it('handles a value that cannot be serialized (circular reference) without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logError('circular', circular)).not.toThrow();
    expect(diagnosticsLog).toHaveLength(1);
  });

  it('caps the log at 50 entries, keeping the newest first', () => {
    for (let i = 0; i < 60; i++) {
      logError('loop', `error-${i}`);
    }
    expect(diagnosticsLog.length).toBe(50);
    expect(diagnosticsLog[0].message).toBe('error-59');
  });

  it('formatDiagnosticsReport produces valid JSON', () => {
    logError('test', new Error('boom'));
    const report = formatDiagnosticsReport();
    expect(() => JSON.parse(report)).not.toThrow();
    const parsed = JSON.parse(report);
    expect(parsed.errors).toHaveLength(1);
  });
});
