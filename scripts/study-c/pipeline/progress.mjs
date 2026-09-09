import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync } from 'node:fs';
import { threadId } from 'node:worker_threads';

export function createProgressLogger({ now = Date.now, write = (line) => process.stderr.write(line),
  append = appendFileSync, pid = process.pid, tid = threadId, heartbeatMs = 5000,
  schedule = setInterval, cancel = clearInterval } = {}) {
  const context = new AsyncLocalStorage();
  const started = now();
  let file = null;
  const field = (value) => String(value ?? '-').replace(/[\r\n\[\]]/g, '_');
  const log = (message) => {
    const timestamp = now();
    const { taskId, stage } = context.getStore() ?? {};
    const line = `[${new Date(timestamp).toISOString()}] [+${((timestamp - started) / 1000).toFixed(1)}s] ` +
      `[pid=${field(pid)} tid=${field(tid)} task=${field(taskId)} stage=${field(stage)}] ` +
      `${String(message).replace(/[\r\n]+/g, ' ')}\n`;
    write(line);
    if (file) append(file, line, 'utf8');
  };
  return {
    log,
    setFile(filename) { file = filename; },
    withTask(taskId, work) { return context.run({ ...context.getStore(), taskId }, work); },
    withStage(stage, work) {
      return context.run({ ...context.getStore(), stage }, async () => {
        const stageStarted = now();
        log('stage started');
        const timer = schedule(() => log(`heartbeat: awaiting stage completion; elapsedMs=${now() - stageStarted}; local process alive, provider state unknown`), heartbeatMs);
        timer.unref?.();
        try {
          const result = await work();
          log(`stage returned; elapsedMs=${now() - stageStarted}`);
          return result;
        } catch (error) {
          log(`stage threw; elapsedMs=${now() - stageStarted}`);
          throw error;
        } finally { cancel(timer); }
      });
    },
  };
}