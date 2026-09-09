// Judge step: fill the pinned ArtifactsBench MLLM template with the task
// checklist, question, and full model answer, send it with the rendered
// screenshots to the grok-4.6 judge, and extract the 0-100 Overall Score.
// The judge shares the coder's model family; that bias is recorded, not hidden.
import { decodeJudgeTemplate } from '../budget-preflight.mjs';
import { extractOverallScore, scoreToNumber } from './extract.mjs';

export { decodeJudgeTemplate };

// Literal single-occurrence substitution ($Checklist/$Question/$Answer are each
// verified unique by decodeJudgeTemplate, so a plain replace is faithful).
export function buildJudgePrompt({ template, checklist, question, answer }) {
  const values = { Checklist: checklist, Question: question, Answer: answer };
  return template.replace(/\$(Checklist|Question|Answer)/g, (_match, name) => values[name]);
}

export async function judgeArtifact({ client, template, checklist, question, answer, imageBuffers, purpose = 'judge' }) {
  const prompt = buildJudgePrompt({ template, checklist, question, answer });
  const result = await client.judge({ prompt, images: imageBuffers, purpose });
  if (!result.ok) return { ...result, score: null, rawScore: null };
  const rawScore = extractOverallScore(result.text);
  const score = scoreToNumber(rawScore);
  return { ...result, rawScore, score, text: result.text };
}
