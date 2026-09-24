import { describe, expect, it } from 'vitest';
import { jobId } from './job-id.js';

describe('jobId', () => {
  /**
   * BullMQ rejects `:` in a custom job id at runtime, with no compile-time
   * signal. This test is the guard: the obvious `a:b:c` format fails only when
   * a queue is actually reachable, which is exactly when it is most annoying
   * to discover.
   */
  it('never produces a colon', () => {
    expect(jobId('sync', 'abc123', 'r_payment-core', 'COMMITS')).not.toContain(':');
  });

  it('escapes colons that appear inside a part', () => {
    expect(jobId('sync', 'a:b')).toBe('sync~a_b');
  });

  it('is deterministic, so the same work collapses into one job', () => {
    expect(jobId('sync', 'i1', 'r_api', 'ISSUES')).toBe(jobId('sync', 'i1', 'r_api', 'ISSUES'));
  });

  it('distinguishes different subjects', () => {
    expect(jobId('sync', 'i1', 'r_api', 'ISSUES')).not.toBe(
      jobId('sync', 'i1', 'r_api', 'COMMITS'),
    );
  });
});
