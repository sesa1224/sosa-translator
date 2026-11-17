// "Claude 초안 받기": one line translated on request and handed back to the screen, never written to the project.
// It sends exactly what the translate job would send for a batch of that one line (same planning, same prompt),
// so asking for a draft never carries more material than translating the line would.
import type { LineDraft } from '../../shared/api.js';
import { NEED_LOGIN } from '../claude/chat.js';
import { buildTranslatePrompt, isTranslateAnswer, planBatches, TRANSLATE_SCHEMA, type TranslateAnswer } from './batches.js';
import { ALL_STATUSES, finishTranslation, NO_REASON, REFUSED_REASON, type JobOptions } from './job.js';

export const CANNOT_DRAFT = '이 줄은 지금 번역할 수 없어요';

export async function draftLine(o: Omit<JobOptions, 'ids' | 'maxItems' | 'maxChars'>, id: string, signal?: AbortSignal): Promise<LineDraft> {
  const svc = o.svc;
  const glossary = svc.glossary();
  const [batch] = planBatches(svc.units(), (x) => svc.entry(x), glossary, { ids: [id], includeStatuses: ALL_STATUSES, decisions: svc.decisions() });
  if (!batch) throw new Error(CANNOT_DRAFT);
  const prompt = buildTranslatePrompt(batch, glossary);
  const r = await o.call<TranslateAnswer>({
    command: o.claude.command, prefixArgs: o.claude.prefixArgs, cwd: o.cwd, model: o.model,
    system: prompt.system, user: prompt.user, schema: TRANSLATE_SCHEMA, validate: isTranslateAnswer, signal,
  });
  if (!r.ok) {
    const reason = r.kind === 'auth' ? NEED_LOGIN : r.kind === 'refused' ? REFUSED_REASON : r.message;
    return { text: null, reason, usage: r.usage };
  }
  const item = batch.items[0];
  const a = r.data.items.find((x) => x.i === item.i);
  if (!a) return { text: null, reason: '답에 이 줄이 없어요', usage: r.usage };
  if (a.t === null) return { text: null, reason: a.declined?.trim() || NO_REASON, usage: r.usage };
  return { text: finishTranslation(item, a.t, glossary, svc), usage: r.usage };
}
