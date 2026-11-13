import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, expect, test } from 'vitest';
import { NotesJob, readBuildNotes, registerNotesContributor } from '../../src/main/buildNotes.js';
import { ProjectService } from '../../src/main/projectService.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { freshGame, idFinder } from './helpers.js';
import { answer } from './jobHelpers.js';

afterAll(cleanupTempDirs);

async function project() {
  const { game, proj } = await freshGame();
  const svc = await ProjectService.create(game, proj, '약초원');
  registerNotesContributor(svc, { images: null });
  return { svc, proj, idOf: idFinder(() => svc.units()) };
}

const zipOf = async (p: string) => unzipSync(new Uint8Array(await readFile(p)));

test('빌드마다 패치노트와 설치 방법이 zip 최상위에, 기록은 builds/NNN 에', async () => {
  const { svc, proj, idOf } = await project();
  await svc.setTranslation(idOf('月光草'), '월광초', 'user');
  const b1 = await svc.build();
  const z1 = await zipOf(b1.zipPath);
  expect(Object.keys(z1)).toEqual(expect.arrayContaining(['data/Items.json', '패치노트.txt', '설치 방법.txt']));
  const n1 = strFromU8(z1['패치노트.txt']);
  expect(n1).toContain('약초원 한국어 패치 빌드 1');
  expect(n1).toContain('첫 빌드');
  for (const f of ['snapshot.json', 'diff.json', 'notes.txt']) expect(existsSync(path.join(proj, 'builds', '001', f))).toBe(true);

  await svc.setTranslation(idOf('やった！'), '해냈다!', 'user');
  const b2 = await svc.build();
  const n2 = strFromU8((await zipOf(b2.zipPath))['패치노트.txt']);
  expect(n2.indexOf('빌드 2')).toBeGreaterThanOrEqual(0);
  expect(n2.indexOf('빌드 2')).toBeLessThan(n2.indexOf('약초원 한국어 패치 빌드 1'));
  expect(n2).toContain('새 번역 1줄');
  const diff = JSON.parse(await readFile(path.join(proj, 'builds', '002', 'diff.json'), 'utf8'));
  expect(diff).toMatchObject({ number: 2, previous: 1, newTranslations: 1 });
});

test('번역이 하나도 없으면 지금처럼 빌드되지 않는다', async () => {
  const { svc, proj } = await project();
  await expect(svc.build()).rejects.toThrow('바뀐 파일이 없습니다');
  expect(existsSync(path.join(proj, 'builds', '001', 'snapshot.json'))).toBe(false);
});

test('다른 기여자의 요약이 extras 로 들어간다', async () => {
  const { svc, proj, idOf } = await project();
  svc.buildSummaries.push(async () => ({ patches: ['수정 A'] }));
  await svc.setTranslation(idOf('月光草'), '월광초', 'user');
  await svc.build();
  const diff = JSON.parse(await readFile(path.join(proj, 'builds', '001', 'diff.json'), 'utf8'));
  expect(diff.extras.patches.added).toEqual(['수정 A']);
});

test('NotesJob 이 다듬은 글을 notes.txt 에 쓰고 zip 을 다시 묶는다', async () => {
  const { svc, proj, idOf } = await project();
  await svc.setTranslation(idOf('月光草'), '월광초', 'user');
  const b = await svc.build();
  const seen: any[] = [];
  const job = new NotesJob({
    svc, number: 1, claude: { command: 'x' }, model: 'claude-haiku-5-5', cwd: proj,
    call: answer((u) => { seen.push(u); return { notes: '약초원 한국어 패치 빌드 1\n- 다듬은 글' }; }) as any,
  });
  expect(job.progress.kind).toBe('notes');
  await job.start();
  expect(job.progress.state).toBe('done');
  expect(seen[0].diff).toMatchObject({ number: 1 });
  expect(typeof seen[0].notes).toBe('string');
  expect(await readFile(path.join(proj, 'builds', '001', 'notes.txt'), 'utf8')).toBe('약초원 한국어 패치 빌드 1\n- 다듬은 글');
  expect((await readBuildNotes(proj, 1))).toBe('약초원 한국어 패치 빌드 1\n- 다듬은 글');
  const zip = await zipOf(b.zipPath);
  expect(strFromU8(zip['패치노트.txt'])).toContain('- 다듬은 글');
  const manifest = JSON.parse(await readFile(path.join(proj, 'builds', '001', 'manifest.json'), 'utf8'));
  for (const f of manifest.files) expect(createHash('sha1').update(zip[f.path]).digest('hex')).toBe(f.sha1);
  expect(Object.keys(zip).sort()).toEqual(manifest.files.map((f: any) => f.path).sort());
});

test('MV www 게임의 설치 방법에는 www 가 나온다', async () => {
  const { setupProject } = await import('../helpers/project.js');
  const { proj } = await setupProject({ engine: 'MV', www: true });
  const svc = await ProjectService.open(proj);
  registerNotesContributor(svc, { images: null });
  await svc.setTranslation(svc.units().find((u) => u.source === '月光草')!.id, '월광초', 'user');
  const b = await svc.build();
  expect(strFromU8((await zipOf(b.zipPath))['설치 방법.txt'])).toContain('www');
});

// ---- plan 6, task 8 ----
test('빌드가 실패하면 기여자가 먼저 쓴 폴더가 지워지고 다음 빌드가 같은 번호를 쓴다', async () => {
  const { svc, proj, idOf } = await project();
  await svc.setTranslation(idOf('月光草'), '월광초', 'user');
  const fail = async () => { throw new Error('기여자 실패'); };
  svc.buildContributors.push(fail);
  await expect(svc.build()).rejects.toThrow('기여자 실패');
  expect(existsSync(path.join(proj, 'builds', '001'))).toBe(false);
  svc.buildContributors.splice(svc.buildContributors.indexOf(fail), 1);
  const b = await svc.build();
  expect(b.number).toBe(1);
});

test('빌드 기록은 manifest 가 없는 폴더를 건너뛴다', async () => {
  const { finishedBuilds } = await import('../../src/core/notes/snapshot.js');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { svc, proj, idOf } = await project();
  await svc.setTranslation(idOf('月光草'), '월광초', 'user');
  await svc.build();
  await mkdir(path.join(proj, 'builds', '002'), { recursive: true });
  await writeFile(path.join(proj, 'builds', '002', 'notes.txt'), '반쯤');
  expect(await finishedBuilds(proj)).toEqual([1]);
});

test('패치노트 머리에 게임 버전, 버전이 바뀐 빌드에는 맞춤 표시', async () => {
  const { makeTempDir } = await import('../helpers/fs.js');
  const { makeMiniGame } = await import('../helpers/miniGame.js');
  const { svc, idOf } = await project();
  await svc.setTranslation(idOf('いいよ'), '좋아', 'user');
  const b1 = await svc.build();
  const n1 = strFromU8((await zipOf(b1.zipPath))['패치노트.txt']);
  expect(n1).toContain('약초원 한국어 패치 빌드 1 (게임 v1)');
  expect(n1).not.toContain('에 맞춤');

  const v2 = await makeTempDir();
  await makeMiniGame(v2, { variant: 'v2' });
  await svc.importVersion(v2, '1.1');
  registerNotesContributor(svc, { images: null });   // ipc does this when it opens the project again
  const b2 = await svc.build();
  const n2 = strFromU8((await zipOf(b2.zipPath))['패치노트.txt']);
  expect(n2).toContain('약초원 한국어 패치 빌드 2 (게임 1.1)');
  expect(n2).toContain('게임 1.1 에 맞춤');
});
