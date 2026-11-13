import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { detectGame } from '../../src/core/engine/detect.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';

let dir: string;
let emptyDir: string;
beforeEach(async () => { dir = await makeTempDir(); emptyDir = await makeTempDir(); });
afterEach(cleanupTempDirs);

test('MZ 폴더를 판별한다', async () => {
  await makeMiniGame(dir); const g = await detectGame(dir);
  expect(g).toMatchObject({ engine: 'MZ', contentDir: dir, contentPrefix: '', encryptedImages: false, encryptionKey: null });
});
test('MV www 배포판을 판별한다', async () => {
  await makeMiniGame(dir, { engine: 'MV', www: true }); const g = await detectGame(dir);
  expect(g.engine).toBe('MV'); expect(g.contentPrefix).toBe('www/'); expect(g.contentDir).toBe(path.join(dir, 'www'));
});
test('암호화 키를 읽는다', async () => {
  await makeMiniGame(dir, { encrypted: true });
  expect((await detectGame(dir)).encryptionKey).toBe('d41d8cd98f00b204e9800998ecf8427e');
});
test('MV/MZ가 아니면 오류', async () => {
  await expect(detectGame(emptyDir)).rejects.toThrow('MV/MZ 게임이 아닙니다');
});
