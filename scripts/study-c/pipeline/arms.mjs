// The three repair-feedback arms. Each consumes the shared initial artifact and
// returns a serializable feedback record plus a single repair prompt:
//   B  browser feedback        - deterministic runtime signals from the render
//   G  model-based testing      - an extra grok-4.6 call authoring functional tests
//   T  TLA+-guided testing      - executed traces checked against a task contract
// The coder and one-repair ceiling are shared; T's protocol version identifies
// the supported contract and replay procedure.

export const ARM_IDS = ['B', 'G', 'T'];

function repairPrompt({ task, html, findings }) {
  return [
    task.prompt,
    '',
    'You previously produced this HTML document:',
    '```html',
    html,
    '```',
    '',
    findings,
    '',
    'Fix the identified problems while preserving all behavior that already works. ' +
    'Return the complete corrected, self-contained HTML document in one ```html code block ' +
    '(inline CSS/JS, no external resources).',
  ].join('\n');
}

// Arm B: only what a browser reveals at runtime.
function browserArm({ task, artifact }) {
  const obs = artifact.render.observations;
  const lines = [];
  if (obs.captureError) lines.push(`- The page failed to render/capture: ${obs.captureError}`);
  for (const e of obs.pageErrors) lines.push(`- Uncaught page error: ${e}`);
  for (const e of obs.consoleErrors) lines.push(`- Console error: ${e}`);
  for (const e of obs.requestFailures) lines.push(`- Failed resource request (must be self-contained/offline): ${e}`);
  if (obs.domStats && obs.domStats.buttons === 0 && obs.domStats.inputs === 0) {
    lines.push('- The rendered page exposes no interactive controls (no buttons or inputs); the required interaction is likely missing.');
  }
  const findings = lines.length ? `Browser runtime feedback found these problems:\n${lines.join('\n')}`
    : 'No browser runtime failures observed. No speculative repair requested.';
  return { kind: 'browser', ok: true, findings, repairPrompt: lines.length ? repairPrompt({ task, html: artifact.extracted.content, findings }) : null };
}

// Arm G: conventional model-based testing. A separate grok-4.6 call authors
// concrete functional test cases from the task + code and reports likely
// failures. No formal specification is involved.
async function modelTestArm({ task, artifact, client }) {
  const prompt = [
    'You are a meticulous QA engineer. Given a coding task and an HTML artifact, ' +
    'write concrete functional test cases that check whether the artifact satisfies the task, ' +
    'then determine which tests the artifact FAILS by reasoning about its code.',
    '',
    'Task:',
    task.prompt,
    '',
    'Artifact HTML:',
    '```html',
    artifact.extracted.content,
    '```',
    '',
    'Return JSON only: {"tests":[{"id":"test-id","status":"PASS or FAIL","reason":"one-line reason"}]}. ' +
    'List 1 to 8 cases. Report failures only for task requirements; do not propose optional features or speculative improvements. These are code-review judgments, not executed tests.',
  ].join('\n');
  const report = await client.generate({ system: undefined, prompt, maxOutputTokens: 3_000, purpose: `gtest-${task.id}` });
  if (!report.ok) {
    return { kind: 'model-tests', ok: false, reason: 'model_feedback_failed', findings: '', testReportOk: false, repairPrompt: null };
  }
  try {
    const result = JSON.parse(report.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1'));
    if (!Array.isArray(result.tests) || !result.tests.length || result.tests.length > 8 || result.tests.some((item) =>
      !['PASS', 'FAIL'].includes(item.status) || typeof item.reason !== 'string')) throw new Error('invalid_review');
    const failures = result.tests.filter((item) => item.status === 'FAIL');
    const findings = failures.length ? `Model-authored code review (not executed tests):\n${JSON.stringify(failures, null, 2)}` : 'No requirement failures reported by code review. No speculative repair requested.';
    return { kind: 'model-tests', ok: true, findings, testReportOk: true, tests: result.tests,
      repairPrompt: failures.length ? repairPrompt({ task, html: artifact.extracted.content, findings }) : null };
  } catch {
    return { kind: 'model-tests', ok: false, reason: 'model_feedback_unparseable', findings: '', testReportOk: false, repairPrompt: null };
  }
}

export async function buildArm({ arm, client, task, artifact, evidenceDir, onProgress, generatedContracts }) {
  if (arm === 'B') return browserArm({ task, artifact });
  if (arm === 'G') return modelTestArm({ task, artifact, client });
  if (arm === 'T') {
    const { generativeTlaArm } = await import('./generative-tla.mjs');
    return generativeTlaArm({ task, artifact, client, repairPrompt, evidenceDir, onProgress, generatedContracts });
  }
  throw new Error(`unknown_arm_${arm}`);
}
