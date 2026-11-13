import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { ProjectService } from '../../src/main/projectService.js';
import type { ChangeEvent } from '../../src/shared/api.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { freshGame, idFinder } from './helpers.js';

let game: string, proj: string, svc: ProjectService;
const idOf = idFinder(() => svc.units());

beforeEach(async () => {
  ({ game, proj } = await freshGame());
  svc = await ProjectService.create(game, proj, '약초원');
});
afterEach(async () => { await svc.close(); });
afterAll(async () => { await cleanupTempDirs(); });

test('만들고 다시 열면 같은 항목', async () => {
  const fresh = await freshGame();
  const a = await ProjectService.create(fresh.game, fresh.proj, '약초원'); const n = a.units().length; await a.close();
  const b = await ProjectService.open(fresh.proj); expect(b.units().length).toBe(n); expect(b.meta.name).toBe('약초원');
  await b.close();
});
test('번역 쓰기: 저장, 이벤트, 검사', async () => {
  const seen: ChangeEvent[] = []; svc.on('changed', e => seen.push(e));
  expect(await svc.setTranslation(idOf('月光草'), '월광초', 'user')).toEqual([]);
  expect(svc.entry(idOf('月光草'))).toMatchObject({ target: '월광초', status: 'needs-review' });
  expect(seen).toEqual([{ ids: [idOf('月光草')], origin: 'user' }]);
  expect(JSON.parse(await readFile(path.join(proj, 'translations.json'), 'utf8'))[idOf('月光草')].target).toBe('월광초');
  const issues = await svc.setTranslation(idOf('夜に光る草。\\C[2]貴重\\C[0]だ'), '밤에 빛나는 풀', 'chat');
  expect(issues[0].rule).toBe('control-codes'); expect(svc.entry(idOf('夜に光る草。\\C[2]貴重\\C[0]だ')).status).toBe('error');
});
test('되돌리기: 출처별', async () => {
  await svc.setTranslation(idOf('リナ'), '리나', 'user'); await svc.setTranslation(idOf('リナ'), '린', 'chat');
  expect(await svc.undo('chat')).toEqual([idOf('リナ')]); expect(svc.entry(idOf('リナ')).target).toBe('리나');
  expect(await svc.undo('chat')).toEqual([]);
});
test('동시에 온 쓰기는 순서대로 적용되고 파일이 온전하다', async () => {
  await Promise.all(Array.from({ length: 30 }, (_, i) => svc.setTranslation(idOf('リナ'), '리나' + i, i % 2 ? 'chat' : 'user')));
  expect(svc.entry(idOf('リナ')).target).toBe('리나29');
  expect(() => JSON.parse(readFileSync(path.join(proj, 'translations.json'), 'utf8'))).not.toThrow();
});
test('없는 id', async () => { await expect(svc.setTranslation('nope', 'x', 'user')).rejects.toThrow('없는 항목입니다: nope'); });

// Extra coverage beyond the plan's assertions.
test('상태 바꾸기, 지우기, 되돌리기(출처 없이)', async () => {
  const id = idOf('月光草');
  await svc.setTranslation(id, '월광초', 'user');
  await svc.setStatus(id, 'approved', 'user');
  expect(svc.entry(id).status).toBe('approved');
  await svc.clearTranslation(id, 'user');
  expect(svc.entry(id)).toMatchObject({ target: null, status: 'untranslated' });
  expect(await svc.undo()).toEqual([id]);
  expect(svc.entry(id)).toMatchObject({ target: '월광초', status: 'approved' });
  expect(svc.issues(id)).toEqual([]);
});
