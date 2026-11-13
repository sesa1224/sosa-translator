// Patch notes for each build: a build contributor that writes the snapshot and diff of the build and puts
// 패치노트.txt and 설치 방법.txt into the zip, and NotesJob, which asks Claude to polish the notes and rewrites
// the zip with them. The counting is done by src/core/notes.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import type { BuildContext } from '../core/build/patch.js';
import { TOP_PACKAGE_KEY } from '../core/build/title.js';
import { diffSnapshots, formatNotes, INSTALL_TEXT, notesTitle, type BuildDiff } from '../core/notes/diff.js';
import { buildFolder, finishedBuilds, loadSnapshot, saveSnapshot, takeSnapshot } from '../core/notes/snapshot.js';
import { readJsonFile, writeJsonFile } from '../core/util/json.js';
import type { ImageService } from './images.js';
import { lastImageBuild } from './images.js';
import type { ProjectService } from './projectService.js';
import { BatchJob, type JobOptions } from './translate/job.js';
import { versionsOf } from '../core/update/importVersion.js';

export const NOTES_FILE_IN_ZIP = '패치노트.txt';
export const INSTALL_FILE_IN_ZIP = '설치 방법.txt';
export const NOTES_FILE = 'notes.txt';
export const DIFF_FILE = 'diff.json';
/** Line between the notes of two builds in 패치노트.txt. */
const SEPARATOR = '\n\n----------------------------------------\n\n';

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
const sha1 = (d: Uint8Array) => createHash('sha1').update(d).digest('hex');

/** The notes of a build (the user's or Claude's polished text when there is one), or ''. */
export async function readBuildNotes(projectDir: string, number: number): Promise<string> {
  try {
    return (await readFile(path.join(buildFolder(projectDir, number), NOTES_FILE), 'utf8')).replace(/^﻿/, '');
  } catch {
    return '';
  }
}

export async function readBuildDiff(projectDir: string, number: number): Promise<BuildDiff | null> {
  try {
    return (await readJsonFile(path.join(buildFolder(projectDir, number), DIFF_FILE))) as BuildDiff;
  } catch {
    return null;
  }
}

/** 패치노트.txt: this build's notes, then the older finished builds' notes, newest first. */
async function composeNotes(projectDir: string, number: number, own: string): Promise<string> {
  const parts = [own.trim()];
  for (const n of await finishedBuilds(projectDir)) {
    if (n >= number) continue;
    const t = (await readBuildNotes(projectDir, n)).trim();
    if (t) parts.push(t);
  }
  return crlf(parts.join(SEPARATOR)) + '\r\n';
}

/**
 * Replaces files inside a finished build's zip (and its patch/ copy), fixes the sha1s in manifest.json
 * and checks the new zip before it takes the old one's place.
 */
export async function rezipBuild(projectDir: string, number: number, replace: Record<string, string>): Promise<void> {
  const dir = buildFolder(projectDir, number);
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest = (await readJsonFile(manifestFile)) as { files: { path: string; sha1: string }[] };
  const zipName = (await readdir(dir)).find((n) => n.toLowerCase().endsWith('.zip'));
  if (!zipName) throw new Error(`빌드 ${number} 의 zip 을 찾을 수 없습니다`);
  const zipPath = path.join(dir, zipName);
  const entries = unzipSync(new Uint8Array(await readFile(zipPath)));
  for (const [p, text] of Object.entries(replace)) {
    const data = new TextEncoder().encode(text);
    entries[p] = data;
    const abs = path.join(dir, 'patch', ...p.split('/'));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data);
    const f = manifest.files.find((x) => x.path === p);
    if (f) f.sha1 = sha1(data);
    else manifest.files.push({ path: p, sha1: sha1(data) });
  }
  const zip = zipSync(entries, { level: 9 });
  const check = unzipSync(zip);
  for (const f of manifest.files) if (!check[f.path] || sha1(check[f.path]) !== f.sha1) throw new Error(`패치 검증 실패: ${f.path}`);
  const tmp = `${zipPath}.tmp`;
  await writeFile(tmp, zip);
  await rename(tmp, zipPath);
  await writeJsonFile(manifestFile, manifest);
}

/** Saves edited notes for a build and puts them into its zip. */
export async function setBuildNotes(projectDir: string, number: number, text: string): Promise<void> {
  const clean = text.replace(/\r\n/g, '\n').trim();
  await writeFile(path.join(buildFolder(projectDir, number), NOTES_FILE), clean, 'utf8');
  await rezipBuild(projectDir, number, { [NOTES_FILE_IN_ZIP]: await composeNotes(projectDir, number, clean) });
}

/** Pictures of this build (file → sha1) and their zip paths, from the image contributor's run when it was this build. */
async function picturesOf(images: ImageService | null, ctx: BuildContext): Promise<{ pictures: Record<string, string>; zipPaths: string[] }> {
  if (!images) return { pictures: {}, zipPaths: [] };
  const last = lastImageBuild.get(images);
  const r = last && last.number === ctx.number && last.projectDir === ctx.projectDir ? last : await images.buildFiles(ctx.contentPrefix);
  return { pictures: r.pictures, zipPaths: [...r.files.keys()] };
}

/**
 * Adds 패치노트.txt and 설치 방법.txt to every patch and records snapshot.json, diff.json and notes.txt in
 * builds/NNN/. Nothing is added when the build has nothing else in it, so an empty build still fails.
 */
export function registerNotesContributor(svc: ProjectService, o: { images: ImageService | null }): void {
  svc.buildContributors.push(async (ctx) => {
    const { pictures, zipPaths } = await picturesOf(o.images, ctx);
    const extras: Record<string, string[]> = {};
    for (const summarize of svc.buildSummaries) {
      for (const [k, lines] of Object.entries(await summarize())) extras[k] = [...(extras[k] ?? []), ...lines];
    }
    if (ctx.changed.size === 0 && zipPaths.length === 0 && Object.values(extras).every((l) => l.length === 0)) return new Map();

    const files = [...[...ctx.changed.keys()].map((k) => (k === TOP_PACKAGE_KEY ? 'package.json' : ctx.contentPrefix + k)), ...zipPaths];
    const cur = takeSnapshot({ number: ctx.number, version: svc.meta.current, units: svc.units(), entryOf: (id) => svc.entry(id), images: pictures, files, extras });
    const prevNumber = (await finishedBuilds(ctx.projectDir)).find((n) => n < ctx.number);
    const prev = prevNumber === undefined ? null : await loadSnapshot(ctx.projectDir, prevNumber);
    const diff = diffSnapshots(prev, cur, svc.units());
    // The notes name the game version, and say so when it changed since the last build.
    const labels = new Map(versionsOf(svc.meta).map((v) => [v.id, v.label]));
    const label = labels.get(svc.meta.current) ?? svc.meta.current;
    const previousLabel = prev ? labels.get(prev.version) ?? prev.version : null;
    const notes = formatNotes(diff, { name: svc.meta.name, version: svc.meta.current, label, previousLabel });

    await saveSnapshot(ctx.projectDir, cur);
    await writeJsonFile(path.join(buildFolder(ctx.projectDir, ctx.number), DIFF_FILE), diff);
    await writeFile(path.join(buildFolder(ctx.projectDir, ctx.number), NOTES_FILE), notes, 'utf8');
    return new Map<string, string>([
      [NOTES_FILE_IN_ZIP, await composeNotes(ctx.projectDir, ctx.number, notes)],
      [INSTALL_FILE_IN_ZIP, INSTALL_TEXT({ contentPrefix: ctx.contentPrefix, name: svc.meta.name })],
    ]);
  });
}

export const NOTES_SCHEMA = {
  type: 'object',
  properties: { notes: { type: 'string' } },
  required: ['notes'],
  additionalProperties: false,
} as const;

const isNotesAnswer = (v: unknown): v is { notes: string } =>
  !!v && typeof v === 'object' && typeof (v as { notes?: unknown }).notes === 'string' && (v as { notes: string }).notes.trim() !== '';

export function notesPrompt(name: string, number: number): string {
  return [
    '게임 한국어 패치의 패치노트를 쓴다. 받은 숫자와 목록에 있는 사실만 쓴다. 지어내지 않는다.',
    "사용자가 읽는 짧은 글로, 항목은 줄마다 '- ' 로 시작한다.",
    `버전 제목은 '${notesTitle(name, number)}'.`,
    '입력의 diff 는 지난 빌드와 비교한 숫자와 목록, notes 는 프로그램이 만든 초안이다. 답은 { "notes": "..." } 하나.',
  ].join('\n');
}

/** Asks Claude to polish a build's notes (from diff.json and the automatic notes) and puts them into the zip. */
export class NotesJob extends BatchJob<number> {
  constructor(o: JobOptions & { number: number }) {
    super(o, 'notes');
    this.number = o.number;
  }

  private readonly number: number;

  protected plan(): { batches: number[]; total: number } {
    return { batches: [this.number], total: 1 };
  }

  protected async runBatch(number: number, signal: AbortSignal): Promise<'next' | 'limit' | 'failed' | 'stopped'> {
    const dir = this.o.svc.projectDir;
    this.update({ label: `빌드 ${number} 패치노트` });
    if (!existsSync(path.join(buildFolder(dir, number), 'manifest.json'))) {
      this.p.message = `빌드 ${number} 이 없습니다`;
      return 'failed';
    }
    const user = JSON.stringify({ name: this.o.svc.meta.name, number, diff: await readBuildDiff(dir, number), notes: await readBuildNotes(dir, number) });
    let retried = false;
    for (;;) {
      const r = await this.call({ system: notesPrompt(this.o.svc.meta.name, number), user, schema: NOTES_SCHEMA, validate: isNotesAnswer, signal });
      if (r.ok) {
        await setBuildNotes(dir, number, r.data.notes);
        this.update({ done: 1 });
        return 'next';
      }
      const what = this.failure(r, retried);
      if (what === 'retry') {
        retried = true;
        continue;
      }
      if (what === 'split') {
        this.p.message = r.message;
        return 'failed';
      }
      return what;
    }
  }
}
