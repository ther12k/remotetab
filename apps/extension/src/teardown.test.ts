import { describe, expect, it } from 'vitest';
import { TeardownOrchestrator, type TeardownStep } from './teardown.ts';

function steps(names: string[]): { list: TeardownStep[]; calls: string[] } {
  const calls: string[] = [];
  const list: TeardownStep[] = names.map((name) => ({
    name,
    run: async () => {
      calls.push(name);
      return undefined;
    },
  }));
  return { list, calls };
}

describe('TeardownOrchestrator', () => {
  it('runs all steps in order', async () => {
    const { list, calls } = steps(['input', 'peer', 'capture', 'power']);
    const o = new TeardownOrchestrator(list);
    const report = await o.run();
    expect(calls).toEqual(['input', 'peer', 'capture', 'power']);
    expect(report.completed).toEqual(calls);
    expect(report.failed).toEqual([]);
    expect(o.isDone).toBe(true);
  });

  it('a failing step does not block the remaining cleanup', async () => {
    const calls: string[] = [];
    const list: TeardownStep[] = [
      {
        name: 'input',
        run: async () => {
          calls.push('input');
        },
      },
      {
        name: 'peer',
        run: async () => {
          calls.push('peer');
          throw new Error('channel already closed');
        },
      },
      {
        name: 'capture',
        run: async () => {
          calls.push('capture');
        },
      },
      {
        name: 'power',
        run: async () => {
          calls.push('power');
        },
      },
    ];
    const report = await new TeardownOrchestrator(list).run();
    expect(calls).toEqual(['input', 'peer', 'capture', 'power']);
    expect(report.completed).toEqual(['input', 'capture', 'power']);
    expect(report.failed).toEqual([{ name: 'peer', reason: 'Error: channel already closed' }]);
  });

  it('records failures for every step that throws', async () => {
    const boom = async () => {
      throw new RangeError('nope');
    };
    const report = await new TeardownOrchestrator([
      { name: 'a', run: boom },
      { name: 'b', run: boom },
    ]).run();
    expect(report.completed).toEqual([]);
    expect(report.failed.map((f) => f.name)).toEqual(['a', 'b']);
  });

  it('is idempotent: a second run does not execute steps again', async () => {
    const { list, calls } = steps(['only']);
    const o = new TeardownOrchestrator(list);
    const first = await o.run();
    const second = await o.run();
    expect(calls).toEqual(['only']);
    expect(second).toBe(first);
  });

  it('concurrent calls share one pass', async () => {
    const calls: string[] = [];
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 5));
      calls.push('slow');
    };
    const o = new TeardownOrchestrator([{ name: 'slow', run: slow }]);
    const [a, b] = await Promise.all([o.run(), o.run()]);
    expect(calls).toEqual(['slow']);
    expect(b).toBe(a);
  });

  it('reports non-Error throws as unknown', async () => {
    const report = await new TeardownOrchestrator([
      { name: 'x', run: () => Promise.reject('plain string') },
    ]).run();
    expect(report.failed[0]?.reason).toBe('unknown error');
  });
});
