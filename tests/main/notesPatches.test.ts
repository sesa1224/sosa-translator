import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, expect, test } from 'vitest';
import { registerNotesContributor } from '../../src/main/buildNotes.js';
import { ProjectService } from '../../src/main/projectService.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { freshGame } from './helpers.js';

afterAll(cleanupTempDirs);

test('패치노트에 그 빌드에 들어간 수정의 제목이 나온다', async () => {
  const { game, proj } = await freshGame();
  const svc = await ProjectService.create(game, proj, '약초원');
  registerNotesContributor(svc, { images: null });
  await svc.addPatch({
    title: '이벤트1 끝나면 스위치 45 켜기',
    body: { kind: 'event', file: 'data/Map001.json', listPath: ['events', 1, 'pages', 0, 'list'], baseHash: '', ops: [{ op: 'insert', after: 11, commands: [{ code: 121, indent: 0, parameters: [45, 45, 0] }] }] },
  }, 'user');
  const off = await svc.addPatch({ title: '꺼 둔 수정', body: { kind: 'json', file: 'data/System.json', path: ['currencyUnit'], baseValue: 'ゴールド', value: 'G' } }, 'user');
  await svc.updatePatch(off.id, { enabled: false });
  const r = await svc.build();
  const notes = strFromU8(unzipSync(await readFile(r.zipPath))['패치노트.txt']);
  expect(notes).toContain('이벤트1 끝나면 스위치 45 켜기');
  expect(notes).not.toContain('꺼 둔 수정');
  await svc.close();
});
