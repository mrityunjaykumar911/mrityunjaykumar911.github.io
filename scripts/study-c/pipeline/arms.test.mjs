import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArm } from './arms.mjs';

const task = { id: 42, prompt: 'Create a task list' };
const artifact = { extracted: { content: '<html>fixture</html>' }, render: { observations: {
  pageErrors: [], consoleErrors: [], requestFailures: [], domStats: { buttons: 2, inputs: 1 },
} } };

test('B and G do not request speculative repairs without reported failures', async () => {
  const browser = await buildArm({ arm: 'B', task, artifact });
  assert.equal(browser.repairPrompt, null);
  const model = await buildArm({ arm: 'G', task, artifact, client: { generate: async () => ({ ok: true, text: JSON.stringify({ tests: [{ id: 'add', status: 'PASS', reason: 'items added' }] }) }) } });
  assert.equal(model.repairPrompt, null);
});

test('G reports malformed model feedback as blocked, not a task-only repair', async () => {
  const result = await buildArm({ arm: 'G', task, artifact, client: { generate: async () => ({ ok: true, text: 'broken response' }) } });
  assert.equal(result.ok, false);
  assert.equal(result.repairPrompt, null);
});

test('B repairs observed runtime errors', async () => {
  const result = await buildArm({ arm: 'B', task, artifact: { ...artifact, render: { observations: { ...artifact.render.observations, pageErrors: ['button handler failed'] } } } });
  assert.match(result.repairPrompt, /button handler failed/);
});