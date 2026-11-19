// Builds the installer and publishes it to GitHub Releases.
// The token lives outside the repository (the repo is public) in ~/.sosa-translator/release-token,
// or in GH_TOKEN. It is passed to electron-builder only through the child's environment and never printed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const tokenFile = join(homedir(), '.sosa-translator', 'release-token');
let token = process.env.GH_TOKEN?.trim();
if (!token && existsSync(tokenFile)) token = readFileSync(tokenFile, 'utf8').trim();
if (!token) {
  console.error(`GitHub 토큰이 없어요. ${tokenFile} 파일에 토큰 한 줄을 넣거나 GH_TOKEN 을 정해 주세요.`);
  process.exit(1);
}

const env = { ...process.env, GH_TOKEN: token };
// shell: true so npx resolves to npx.cmd on Windows.
const run = (cmd) => {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('npx electron-vite build');
run('npx electron-builder --win --publish always');
