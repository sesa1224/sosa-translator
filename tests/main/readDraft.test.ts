// 대본을 읽고 만드는 용어집 초안 (계획 3 추가 요구)
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, expect, test } from 'vitest';
import { SPEAKER_PRESETS } from '../../src/core/text/speaker.js';
import type { TextUnit } from '../../src/core/types.js';
import type { JsonCallResult } from '../../src/main/claude/json.js';
import { ProjectService } from '../../src/main/projectService.js';
import { DRAFT_NOTES_FILE, DraftJob } from '../../src/main/translate/draft.js';
import {
  mergeReadNotes, pickExcerpts, pickWindows, planReadChunks, scriptLines, SKIP_MARK, type ReadNote,
} from '../../src/main/translate/read.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { idle, someUsage, zero } from './jobHelpers.js';

afterAll(() => cleanupTempDirs());
const bracket = SPEAKER_PRESETS.find((p) => p.id === 'bracket')!.pattern;
let n = 0;
const D = (source: string, file = 'data/Map001.json'): TextUnit =>
  ({ id: `d${n++}`, kind: 'dialogue', source, needsDecision: false, refs: [{ type: 'value', file, path: [n] }] });

test('조각은 대사 사이에서만 자르고 화자 줄을 뗀다', () => {
  const units = [D('【アーテル】\n「もちろん無料で受けるわ」'), D('【ギア】\n「ふん」'), D('地の文。'), D('【アーテル】\n「え？」', 'data/Map002.json'),
    { ...D('ShowRecord 記録'), kind: 'plugin-command' as const, needsDecision: true }];
  const chunks = planReadChunks(units, bracket, { maxChars: 30 });
  const all = chunks.flatMap((c) => c.lines);
  expect(all).toEqual(['## 맵1', 'アーテル: 「もちろん無料で受けるわ」', 'ギア: 「ふん」', '地の文。', '## 맵2', 'アーテル: 「え？」']);
  for (const c of chunks) expect(c.text).toBe(c.lines.join('\n'));
  expect(chunks.length).toBeGreaterThan(1);
  expect(all.some((l) => l.includes('【'))).toBe(false);
  expect(planReadChunks(units, bracket)).toHaveLength(1);
});

test('메모 합치기: 같은 인물을 모으고 길이를 지킨다', () => {
  const note = (traits: string, style = ''): ReadNote => ({ characters: [{ name: 'アーテル', traits, speech: '반말', moans: '짧은 소리' }], terms: [{ source: 'ギルド', kind: 'term', note: '모험가 조합' }], sfx: [], style });
  const s = mergeReadNotes([note('차분함'), note('겁이 많음', '건조한 문체'), { characters: [{ name: 'ギア', traits: '퉁명', speech: '거친 반말', moans: '' }], terms: [], sfx: [{ source: 'ぐちゅ', note: '물소리' }], style: '' }]);
  expect(s.characters.map((c) => c.name)).toEqual(['アーテル', 'ギア']);
  expect(s.characters[0]).toMatchObject({ traits: '차분함 / 겁이 많음', speech: '반말', moans: '짧은 소리' });
  expect(s.terms).toEqual([{ source: 'ギルド', kind: 'term', note: '모험가 조합' }]);
  expect(s.sfx).toEqual([{ source: 'ぐちゅ', note: '물소리' }]);
  const long = mergeReadNotes(Array.from({ length: 40 }, (_, i) => note(`조각${i} `.padEnd(100, '가'))));
  const c = long.characters[0];
  expect(c.traits.length + c.speech.length + c.moans.length).toBeLessThanOrEqual(1500);
  expect(c.traits).toContain('조각39'); expect(c.traits).not.toContain('조각0 ');
});

/** A long script: 4,000 lines of about 25 characters; 'ミナ' talks only around line 2,300; 'ユキ' moans only at line 3,333. */
function longScript(): TextUnit[] {
  const units: TextUnit[] = [];
  for (let i = 0; i < 4000; i++) {
    const who = i >= 2300 && i < 2310 ? 'ミナ' : i === 3333 ? 'ユキ' : i % 3 === 0 ? 'アーテル' : i % 3 === 1 ? 'ギア' : 'リナ';
    const body = i === 3333 ? '「あっ…んんっ♥」' : `「これは${i}番目のせりふです」`;
    units.push({ ...D(`【${who}】\n${body}`), id: `L${i}` });
  }
  for (let i = 0; i < 30; i++) units.push({ ...D(`【ユキ】\n「ユキの${i}番目」`), id: `Y${i}` });   // ユキ is a top speaker too
  return units;
}

test('적당히 읽기: 고르게 퍼지고, 예산을 크게 넘지 않고, 화자와 신음을 빼먹지 않는다', () => {
  const units = longScript();
  const all = scriptLines(units, bracket);
  const total = all.reduce((s, l) => s + l.text.length + 1, 0);
  const starts: number[] = []; let acc = 0; for (const l of all) { starts.push(acc); acc += l.text.length + 1; }
  const { windows, picked } = pickWindows(all, { budgetChars: 20000, windowChars: 2500, topSpeakers: 12 });
  const even = windows.slice(0, 8);
  expect(starts[even[0][0]]).toBeLessThan(total * 0.1);
  expect(starts[even.at(-1)![0]]).toBeGreaterThanOrEqual(total * 0.9 - 2500);
  const pickedChars = picked.reduce((s, i) => s + all[i].text.length + 1, 0);
  expect(pickedChars).toBeLessThan(20000 * 1.6);
  expect(picked.filter((i) => all[i].speaker === 'ミナ').length).toBeGreaterThanOrEqual(2);
  expect(picked.some((i) => all[i].speaker === 'ユキ' && all[i].moan)).toBe(true);
  const chunks = pickExcerpts(units, bracket, { budgetChars: 20000 });
  expect(chunks.some((c) => c.lines.includes(SKIP_MARK))).toBe(true);
  expect(chunks.every((c) => c.chars <= 20000 + 200)).toBe(true);
});
test('대본이 예산보다 짧으면 전부 읽는다', () => {
  const units = [D('【アーテル】\n「え？」'), D('地の文。')];
  expect(pickExcerpts(units, bracket).map((c) => c.text)).toEqual(planReadChunks(units, bracket).map((c) => c.text));
});

// ---- the job ------------------------------------------------------------------------------------
let svc: ProjectService | null = null;
afterEach(async () => { await svc?.close(); svc = null; });

async function bigGame(lines = 60): Promise<ProjectService> {
  const game = await makeTempDir();
  await makeMiniGame(game, { engine: 'MV' });
  const file = path.join(game, 'data', 'Map001.json');
  const map = JSON.parse(await readFile(file, 'utf8'));
  const list: unknown[] = map.events[1].pages[0].list;
  const add: unknown[] = [];
  for (let i = 0; i < lines; i++) {
    add.push({ code: 101, indent: 0, parameters: ['', 0, 0, 2] },
      { code: 401, indent: 0, parameters: [i % 2 ? '【アーテル】' : '【ギア】'] }, { code: 401, indent: 0, parameters: [`「せりふ${i}番」`] });
  }
  list.splice(list.length - 1, 0, ...add);
  await writeFile(file, JSON.stringify(map), 'utf8');
  return ProjectService.create(game, path.join(await makeTempDir(), 'proj'), '약초원');
}

const noteAnswer = { characters: [{ name: 'アーテル', traits: '차분함', speech: '반말', moans: '짧은 소리' }], terms: [], sfx: [], style: '' };
const draftAnswer = { terms: [{ source: 'アーテル', category: 'name', candidates: [{ target: '아텔', reason: '' }] }], characters: [{ source: 'アーテル', target: '아텔', speech: '반말', moanStyle: '짧고 눌린 소리' }], styleNotes: '' };
type Seen = { model: string; kind: 'read' | 'merge'; user: any };
function fake(seen: Seen[], o: { limitAt?: number; refuse?: (u: any) => boolean } = {}) {
  return async (c: { model: string; user: string; schema: any }): Promise<JsonCallResult<any>> => {
    const kind = 'style' in c.schema.properties ? 'read' : 'merge';
    const user = JSON.parse(c.user);
    seen.push({ model: c.model, kind, user });
    if (o.limitAt === seen.length) return { ok: false, kind: 'limit', message: 'usage limit reached', usage: zero };
    if (kind === 'read' && o.refuse?.(user)) return { ok: false, kind: 'refused', message: '', usage: zero };
    return { ok: true, data: kind === 'read' ? noteAnswer : draftAnswer, usage: someUsage };
  };
}
const mkDraft = (s: ProjectService, call: unknown, extra: Record<string, unknown> = {}) =>
  new DraftJob({ svc: s, call: call as any, claude: { command: 'claude' }, model: 'merge-m', cwd: '.', mode: 'full', chunkChars: 400, ...extra });

test('읽기 → 정리, 이어 하면 끝난 조각은 다시 읽지 않는다', async () => {
  svc = await bigGame();
  const seen: Seen[] = [];
  const job = mkDraft(svc, fake(seen, { limitAt: 3 }));
  await job.start();
  expect(job.progress.state).toBe('paused-limit');
  const readsBefore = seen.filter((s) => s.kind === 'read').map((s) => s.user.script);
  job.resume(); await idle(job);
  expect(job.progress).toMatchObject({ state: 'done', kind: 'draft' });
  const reads = seen.filter((s) => s.kind === 'read').map((s) => s.user.script);
  expect(new Set(reads.slice(0, 2)).size).toBe(2);
  expect(reads.slice(3)).not.toContain(readsBefore[0]);
  expect(reads.slice(3)).not.toContain(readsBefore[1]);
  expect(seen.at(-1)!.kind).toBe('merge');
  expect(seen.at(-1)!.user.readNotes.characters[0].name).toBe('アーテル');
  expect(seen[1].user.known).toEqual([{ name: 'アーテル', summary: '차분함' }]);
  expect(existsSync(path.join(svc.projectDir, DRAFT_NOTES_FILE))).toBe(true);
  expect(svc.glossary().characters[0]).toMatchObject({ target: '아텔', moanStyle: '짧고 눌린 소리' });
  // A new draft of the same script reads nothing again.
  const again: Seen[] = [];
  await mkDraft(svc, fake(again)).start();
  expect(again.map((s) => s.kind)).toEqual(['merge']);
});

test('거절된 조각은 반으로 나눠 다시 읽고, 한 줄까지 줄면 건너뛴다', async () => {
  svc = await bigGame(10);
  const seen: Seen[] = [];
  const job = mkDraft(svc, fake(seen, { refuse: (u) => String(u.script).includes('せりふ3番') }));
  await job.start();
  expect(job.progress).toMatchObject({ state: 'done', errors: 1 });
  const sizes = seen.filter((s) => s.kind === 'read' && String(s.user.script).includes('せりふ3番')).map((s) => String(s.user.script).split('\n').length);
  expect(sizes.length).toBeGreaterThan(1);
  expect(Math.min(...sizes)).toBe(1);
  expect(seen.at(-1)!.kind).toBe('merge');
});

test('읽기와 정리에 각각 고른 모델을 쓰고, 표본 방식은 읽지 않는다', async () => {
  svc = await bigGame(10);
  const seen: Seen[] = [];
  await mkDraft(svc, fake(seen), { readModel: 'read-m', mergeModel: 'merge-x' }).start();
  expect(new Set(seen.filter((s) => s.kind === 'read').map((s) => s.model))).toEqual(new Set(['read-m']));
  expect(seen.at(-1)!.model).toBe('merge-x');
  const sample: Seen[] = [];
  await mkDraft(svc, fake(sample), { mode: 'sample' }).start();
  expect(sample.map((s) => [s.kind, s.model])).toEqual([['merge', 'merge-m']]);
  expect(sample[0].user.samples).toBeDefined();
});
