#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command, CommanderError } from 'commander';
import {
  buildPatch,
  checkAll,
  createProject,
  exportUntranslated,
  extractAll,
  importTranslations,
  loadUnits,
  readJsonFile,
  TranslationStore,
  type TranslationStatus,
} from './core/index.js';

const USAGE = `사용법:
  mvmz import <gameDir> <projectDir> --name <이름>   게임을 가져와 프로젝트를 만들고 텍스트를 뽑습니다
  mvmz export <projectDir> --out <file> [--all]      미번역 항목을 JSON 으로 내보냅니다 (--all: 판단 필요 항목 포함)
  mvmz apply <projectDir> <file>                     [{id, target}] 번역 파일을 번역표에 넣습니다
  mvmz check <projectDir>                            형식 검사 (오류가 있으면 종료 코드 1)
  mvmz build <projectDir>                            바뀐 파일만 묶은 패치 zip 을 만듭니다
  mvmz status <projectDir>                           상태별 개수를 보여줍니다`;

function out(line = ''): void {
  console.log(line);
}

function parseTranslationFile(json: unknown): { id: string; target: string }[] {
  if (!Array.isArray(json) || !json.every((x) => x && typeof x === 'object' && typeof x.id === 'string' && typeof x.target === 'string')) {
    throw new Error('번역 파일 형식이 맞지 않습니다. [{"id": "...", "target": "..."}] 배열이어야 합니다');
  }
  return json as { id: string; target: string }[];
}

function buildProgram(setCode: (code: number) => void): Command {
  const program = new Command('mvmz');
  program
    .description('RPG Maker MV/MZ 번역 작업실 명령줄')
    .helpOption('-h, --help', '도움말')
    .exitOverride()
    .configureOutput({ writeOut: (s) => process.stdout.write(s), writeErr: () => {} })
    .showHelpAfterError(false);

  program
    .command('import')
    .description('게임을 가져와 프로젝트를 만들고 텍스트를 뽑습니다')
    .argument('<gameDir>')
    .argument('<projectDir>')
    .requiredOption('--name <name>', '프로젝트 이름')
    .action(async (gameDir: string, projectDir: string, opts: { name: string }) => {
      const meta = await createProject(gameDir, projectDir, opts.name);
      const { units, warnings } = await extractAll(projectDir);
      out(`엔진: ${meta.engine}${meta.contentPrefix ? ` (${meta.contentPrefix} 배포판)` : ''}`);
      out(`항목: ${units.length}개`);
      out(`판단 필요: ${units.filter((u) => u.needsDecision).length}개`);
      out(`경고: ${warnings.length}개`);
      for (const w of warnings) out(`  ${w.file}: ${w.message}`);
    });

  program
    .command('export')
    .description('미번역 항목을 JSON 으로 내보냅니다')
    .argument('<projectDir>')
    .requiredOption('--out <file>', '저장할 파일')
    .option('--all', '판단 필요 항목도 포함')
    .action(async (projectDir: string, opts: { out: string; all?: boolean }) => {
      const units = await loadUnits(projectDir);
      const store = await TranslationStore.load(projectDir);
      const items = exportUntranslated(units, store, { includeNeedsDecision: opts.all === true });
      await writeFile(opts.out, JSON.stringify(items, null, 2) + '\n', 'utf8');
      out(`내보냄: ${items.length}개 → ${opts.out}`);
    });

  program
    .command('apply')
    .description('번역 파일을 번역표에 넣습니다')
    .argument('<projectDir>')
    .argument('<file>')
    .action(async (projectDir: string, file: string) => {
      const units = await loadUnits(projectDir);
      const store = await TranslationStore.load(projectDir);
      let json: unknown;
      try {
        json = await readJsonFile(file);
      } catch {
        throw new Error(`번역 파일을 읽을 수 없습니다: ${file}`);
      }
      const r = importTranslations(units, store, parseTranslationFile(json));
      await store.save();
      out(`적용: ${r.applied}개`);
      if (r.unknownIds.length > 0) out(`모르는 id ${r.unknownIds.length}개: ${r.unknownIds.join(', ')}`);
    });

  program
    .command('check')
    .description('형식 검사')
    .argument('<projectDir>')
    .action(async (projectDir: string) => {
      const units = await loadUnits(projectDir);
      const store = await TranslationStore.load(projectDir);
      const results = checkAll(units, store);
      await store.save();
      const byId = new Map(units.map((u) => [u.id, u]));
      let errors = 0;
      for (const r of results) {
        const u = byId.get(r.id)!;
        out(`[${r.id}] ${u.source.replace(/\n/g, '⏎')}`);
        for (const i of r.issues) {
          if (i.severity === 'error') errors++;
          out(`  ${i.severity === 'error' ? '오류' : '경고'} (${i.rule}): ${i.message}`);
        }
      }
      out(`검사한 번역 중 문제 있는 항목: ${results.length}개, 오류: ${errors}건`);
      if (errors > 0) setCode(1);
    });

  program
    .command('build')
    .description('패치 zip 을 만듭니다')
    .argument('<projectDir>')
    .action(async (projectDir: string) => {
      const units = await loadUnits(projectDir);
      const store = await TranslationStore.load(projectDir);
      const r = await buildPatch(projectDir, units, store);
      await store.save();
      out(`빌드 ${String(r.number).padStart(3, '0')}: ${r.zipPath}`);
      out(`파일 ${r.files.length}개:`);
      for (const f of r.files) out(`  ${f.path}`);
      out(`건너뛴 오류 항목: ${r.skippedErrors}개`);
    });

  program
    .command('status')
    .description('상태별 개수')
    .argument('<projectDir>')
    .action(async (projectDir: string) => {
      const units = await loadUnits(projectDir);
      const store = await TranslationStore.load(projectDir);
      const count: Record<TranslationStatus, number> = { untranslated: 0, 'needs-review': 0, approved: 0, error: 0, declined: 0 };
      for (const u of units) {
        const e = store.get(u.id);
        count[e.target === null ? 'untranslated' : e.status]++;
      }
      out(`전체: ${units.length}`);
      out(`미번역: ${count.untranslated}`);
      out(`검토 필요: ${count['needs-review']}`);
      out(`승인: ${count.approved}`);
      out(`오류: ${count.error}`);
      if (count.declined > 0) out(`거절됨: ${count.declined}`);
    });

  return program;
}

/** Runs the CLI with user arguments (no node/script prefix). Returns the exit code. */
export async function run(argv: string[]): Promise<number> {
  let code = 0;
  const program = buildProgram((c) => { code = c; });
  if (argv.length === 0) {
    console.error(USAGE);
    return 2;
  }
  try {
    await program.parseAsync(argv, { from: 'user' });
    return code;
  } catch (e) {
    if (e instanceof CommanderError) {
      if (e.code === 'commander.helpDisplayed' || e.code === 'commander.version') return 0;
      console.error(USAGE);
      return 2;
    }
    console.error(`오류: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(path.resolve(entry))).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) {
  run(process.argv.slice(2)).then((c) => { process.exitCode = c; });
}
