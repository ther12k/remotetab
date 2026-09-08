import { describe, expect, it } from 'vitest';
import { PrioritizedInputSender, type SenderTimers } from './input-sender.ts';

/** Manual clock so coalescing behavior is deterministic. */
function makeClock(): { now: () => number; advance: (ms: number) => void; timers: SenderTimers } {
  let now = 0;
  const scheduled: { at: number; fn: () => void }[] = [];
  const timers: SenderTimers = {
    set(fn, ms) {
      const id = { at: now + ms, fn };
      scheduled.push(id);
      return id;
    },
    clear(id) {
      const i = scheduled.indexOf(id as { at: number; fn: () => void });
      if (i >= 0) scheduled.splice(i, 1);
    },
  };
  return {
    now: () => now,
    advance(ms) {
      now += ms;
      for (const job of scheduled.splice(0)) job.fn();
    },
    timers,
  };
}

describe('PrioritizedInputSender', () => {
  it('coalesces pointer moves to the latest position', () => {
    const clock = makeClock();
    const sent: string[] = [];
    const s = new PrioritizedInputSender({
      send: (raw) => {
        sent.push(raw);
        return true;
      },
      encodeWheel: () => 'wheel',
      moveIntervalMs: 30,
      timers: clock.timers,
    });
    s.sendMove(() => 'move1');
    s.sendMove(() => 'move2');
    s.sendMove(() => 'move3');
    clock.advance(30);
    expect(sent).toEqual(['move3']); // only the latest position ever sent
    expect(s.stats.droppedMoves).toBe(0);
    s.dispose();
  });

  it('does not encode a move until its flush fires', () => {
    // Sequence numbers are minted at encode time (#22): a queued move must
    // not consume one before it is actually sent.
    const clock = makeClock();
    let encodes = 0;
    const sent: string[] = [];
    const s = new PrioritizedInputSender({
      send: (raw) => {
        sent.push(raw);
        return true;
      },
      encodeWheel: () => 'wheel',
      moveIntervalMs: 30,
      timers: clock.timers,
    });
    s.sendMove(() => {
      encodes += 1;
      return 'move1';
    });
    expect(encodes).toBe(0);
    clock.advance(30);
    expect(encodes).toBe(1);
    expect(sent).toEqual(['move1']);
    s.dispose();
  });

  it('drops stale moves when the channel is congested but keeps trying', () => {
    const clock = makeClock();
    let congested = true;
    const sent: string[] = [];
    const s = new PrioritizedInputSender({
      send: (raw) => {
        if (congested) return false;
        sent.push(raw);
        return true;
      },
      encodeWheel: () => 'wheel',
      moveIntervalMs: 30,
      timers: clock.timers,
    });
    s.sendMove(() => 'move1');
    clock.advance(30);
    expect(sent).toEqual([]);
    expect(s.stats.droppedMoves).toBe(1); // stale move dropped under pressure
    congested = false;
    s.sendMove(() => 'move2');
    clock.advance(30);
    expect(sent).toEqual(['move2']);
    s.dispose();
  });

  it('never drops key/button frames — they queue until the channel accepts', () => {
    const clock = makeClock();
    let congested = true;
    const sent: string[] = [];
    const s = new PrioritizedInputSender({
      send: (raw) => {
        if (congested) return false;
        sent.push(raw);
        return true;
      },
      encodeWheel: () => 'wheel',
      retryMs: 10,
      timers: clock.timers,
    });
    expect(s.sendUrgent(() => 'keyDown-a')).toBe(false); // queued
    expect(s.sendUrgent(() => 'keyUp-a')).toBe(false);
    expect(sent).toEqual([]);
    congested = false;
    clock.advance(10); // retry fires → both flush in order
    expect(sent).toEqual(['keyDown-a', 'keyUp-a']);
    expect(s.stats.queuedUrgent).toBe(0);
    s.dispose();
  });

  it('encodes an urgent frame exactly once — retries reuse the encoded frame (#22)', () => {
    const clock = makeClock();
    let congested = true;
    let encodes = 0;
    const sent: string[] = [];
    const s = new PrioritizedInputSender({
      send: (raw) => {
        if (congested) return false;
        sent.push(raw);
        return true;
      },
      encodeWheel: () => 'wheel',
      retryMs: 10,
      timers: clock.timers,
    });
    s.sendUrgent(() => {
      encodes += 1;
      return `frame-${encodes}`;
    });
    // Eagerly encoded on the first (failed) attempt and NOT re-encoded later.
    expect(encodes).toBe(1);
    congested = false;
    clock.advance(10);
    clock.advance(10);
    expect(sent).toEqual(['frame-1']);
    expect(encodes).toBe(1);
    s.dispose();
  });

  it('accumulates wheel deltas between flushes', () => {
    const clock = makeClock();
    const wheels: string[] = [];
    const s = new PrioritizedInputSender({
      send: (raw) => {
        wheels.push(raw);
        return true;
      },
      encodeWheel: (d) => `wheel:${d.x},${d.y},${d.deltaX},${d.deltaY}`,
      wheelIntervalMs: 50,
      timers: clock.timers,
    });
    s.sendWheel({ x: 0.5, y: 0.5, deltaX: 0, deltaY: 30 });
    s.sendWheel({ x: 0.5, y: 0.6, deltaX: 4, deltaY: 20 });
    clock.advance(50);
    expect(wheels).toEqual(['wheel:0.5,0.6,4,50']);
    s.dispose();
  });
});

describe('PrioritizedInputSender.reset', () => {
  it('drops queued urgent frames, moves, and wheel on reset (#016)', () => {
    const clock = makeClock();
    let congested = true;
    const sent: string[] = [];
    const s = new PrioritizedInputSender({
      send: (raw) => {
        if (congested) return false;
        sent.push(raw);
        return true;
      },
      encodeWheel: () => 'wheel',
      moveIntervalMs: 30,
      timers: clock.timers,
    });
    s.sendUrgent(() => 'keyDown-a'); // queued (congested)
    s.sendMove(() => 'move1'); // pending flush
    s.sendWheel({ x: 0.5, y: 0.5, deltaX: 0, deltaY: 40 }); // pending
    s.reset();
    congested = false;
    clock.advance(100);
    // Nothing from the old session may be flushed after the reset.
    expect(sent).toEqual([]);
    expect(s.stats.queuedUrgent).toBe(0);
  });
});
