import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgressLogger } from './progress.mjs';

test('silent stages emit exact timestamps and isolated PID/thread/task identifiers', async () => {
  const lines = [];
  const timers = [];
  const cleared = [];
  let time = Date.parse('2030-01-01T12:00:00.000Z');
  const logger = createProgressLogger({ now: () => time, write: (line) => lines.push(line), pid: 123, tid: 0,
    schedule: (tick, ms) => { const timer = { tick, ms }; timers.push(timer); return timer; },
    cancel: (timer) => cleared.push(timer) });
  const releases = [];
  const jobs = [1097, 1267].map((taskId) => logger.withTask(taskId, () => logger.withStage('contract-generation',
    () => new Promise((resolve) => { releases.push(() => { timers[releases.length - 1]; resolve(); });
      time += 5000;
      timers.at(-1).tick();
    }))));
  releases.forEach((release) => release());
  await Promise.all(jobs);
  assert.equal(cleared.length, 2);
  assert.ok(timers.every((timer) => timer.ms === 5000));
  for (const taskId of [1097, 1267]) {
    const heartbeat = lines.find((line) => line.includes(`task=${taskId} `) && line.includes('heartbeat:'));
    assert.match(heartbeat, /^\[2030-01-01T12:00:\d\d\.000Z\]/);
    assert.ok(heartbeat.includes(`[pid=123 tid=0 task=${taskId} stage=contract-generation]`));
    assert.match(heartbeat, /provider state unknown/);
  }
});

test('heartbeats stop on failure and persisted output equals console output', async () => {
  const consoleLines = [];
  const savedLines = [];
  let cancelled = 0;
  const logger = createProgressLogger({ write: (line) => consoleLines.push(line),
    append: (file, line) => { assert.equal(file, 'progress.log'); savedLines.push(line); },
    schedule: () => ({}), cancel: () => { cancelled++; } });
  logger.setFile('progress.log');
  await assert.rejects(logger.withTask(869, () => logger.withStage('judge', async () => { throw new Error('sensitive raw error'); })));
  assert.equal(cancelled, 1);
  assert.deepEqual(savedLines, consoleLines);
  assert.equal(consoleLines.some((line) => line.includes('sensitive raw error')), false);
  logger.log('outside task');
  assert.match(consoleLines.at(-1), /task=- stage=-/);
});