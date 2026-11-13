import { scopeLabel } from '../../shared/rows.js';
import type { TextUnit } from '../types.js';
import type { BuildSnapshot } from './snapshot.js';

export interface BuildDiff {
  number: number; previous: number | null;
  newTranslations: number; changedTranslations: number; removedTranslations: number;
  byScope: { label: string; added: number; changed: number }[];      // per scope label, largest 10
  newImages: string[]; changedImages: string[];
  addedFiles: string[]; removedFiles: string[];
  extras: Record<string, { added: string[]; removed: string[] }>;
}

const SCOPE_LIMIT = 10;
const LIST_LIMIT = 20;

/** What changed since the previous build (prev null = the first build). */
export function diffSnapshots(prev: BuildSnapshot | null, cur: BuildSnapshot, units: TextUnit[]): BuildDiff {
  const before = prev?.translations ?? {};
  const fileOf = new Map(units.map((u) => [u.id, u.refs[0]?.file ?? '']));
  const scopes = new Map<string, { label: string; added: number; changed: number }>();
  const bump = (id: string, what: 'added' | 'changed') => {
    const label = scopeLabel(fileOf.get(id) ?? '');
    const s = scopes.get(label) ?? { label, added: 0, changed: 0 };
    s[what]++;
    scopes.set(label, s);
  };
  let added = 0, changed = 0, removed = 0;
  for (const [id, h] of Object.entries(cur.translations)) {
    if (!(id in before)) {
      added++;
      bump(id, 'added');
    } else if (before[id] !== h) {
      changed++;
      bump(id, 'changed');
    }
  }
  for (const id of Object.keys(before)) if (!(id in cur.translations)) removed++;

  const prevImages = prev?.images ?? {};
  const prevFiles = new Set(prev?.files ?? []);
  const curFiles = new Set(cur.files);
  const extras: BuildDiff['extras'] = {};
  for (const key of new Set([...Object.keys(prev?.extras ?? {}), ...Object.keys(cur.extras)])) {
    const was = new Set(prev?.extras[key] ?? []);
    const now = new Set(cur.extras[key] ?? []);
    const a = [...now].filter((x) => !was.has(x));
    const r = [...was].filter((x) => !now.has(x));
    if (a.length > 0 || r.length > 0) extras[key] = { added: a, removed: r };
  }
  return {
    number: cur.number, previous: prev?.number ?? null,
    newTranslations: added, changedTranslations: changed, removedTranslations: removed,
    byScope: [...scopes.values()].sort((x, y) => y.added + y.changed - (x.added + x.changed) || x.label.localeCompare(y.label)).slice(0, SCOPE_LIMIT),
    newImages: Object.keys(cur.images).filter((f) => !(f in prevImages)).sort(),
    changedImages: Object.keys(cur.images).filter((f) => f in prevImages && prevImages[f] !== cur.images[f]).sort(),
    addedFiles: [...curFiles].filter((f) => !prevFiles.has(f)).sort(),
    removedFiles: [...prevFiles].filter((f) => !curFiles.has(f)).sort(),
    extras,
  };
}

const EXTRA_LABEL: Record<string, string> = { patches: '게임 수정', fonts: '폰트' };

function listed(items: string[]): string {
  const shown = items.slice(0, LIST_LIMIT).join(', ');
  return items.length > LIST_LIMIT ? `${shown} 외 ${items.length - LIST_LIMIT}개` : shown;
}

/** Title line of a build's notes. */
export function notesTitle(name: string, number: number): string {
  return `${name} 한국어 패치 빌드 ${number}`;
}

/** Notes for people, in Korean. Items that are zero get no line. */
export function formatNotes(diff: BuildDiff, meta: { name: string; version: string }): string {
  const out = [notesTitle(meta.name, diff.number), diff.previous === null ? '(첫 빌드)' : `(빌드 ${diff.previous} 대비)`];
  if (diff.newTranslations > 0) out.push(`- 새 번역 ${diff.newTranslations}줄`);
  if (diff.changedTranslations > 0) out.push(`- 고친 번역 ${diff.changedTranslations}줄`);
  if (diff.removedTranslations > 0) out.push(`- 빠진 번역 ${diff.removedTranslations}줄`);
  if (diff.byScope.length > 0) {
    out.push('- 범위별:');
    for (const s of diff.byScope) {
      const parts = [s.added > 0 ? `새 ${s.added}` : '', s.changed > 0 ? `고침 ${s.changed}` : ''].filter(Boolean);
      out.push(`  · ${s.label}: ${parts.join(', ')}`);
    }
  }
  if (diff.newImages.length > 0) out.push(`- 새로 번역한 그림 ${diff.newImages.length}장: ${listed(diff.newImages)}`);
  if (diff.changedImages.length > 0) out.push(`- 바뀐 그림 ${diff.changedImages.length}장: ${listed(diff.changedImages)}`);
  // On the first build every file is new; listing them all says nothing.
  if (diff.previous !== null && diff.addedFiles.length > 0) out.push(`- 더해진 파일 ${diff.addedFiles.length}개: ${listed(diff.addedFiles)}`);
  if (diff.removedFiles.length > 0) out.push(`- 빠진 파일 ${diff.removedFiles.length}개: ${listed(diff.removedFiles)}`);
  for (const [key, x] of Object.entries(diff.extras)) {
    const label = EXTRA_LABEL[key] ?? key;
    for (const a of x.added) out.push(`- ${label}: ${a}`);
    for (const r of x.removed) out.push(`- ${label} 빠짐: ${r}`);
  }
  if (out.length === 2) out.push('- 바뀐 점 없음');
  return out.join('\n');
}

/** How to install (and remove) the patch, in Korean. MV games with a www folder get that layout explained. */
export function INSTALL_TEXT(o: { contentPrefix: string; name: string }): string {
  const www = o.contentPrefix.replace(/\/+$/, '');
  const lines = [
    `${o.name} 한국어 패치 설치 방법`,
    '',
    '1. 먼저 게임 폴더(Game.exe 가 있는 폴더)를 통째로 다른 곳에 복사해 백업해 두세요.',
    '2. 이 압축 파일을 풀면 나오는 파일과 폴더를 게임 폴더에 그대로 덮어쓰세요.',
    '   "같은 이름의 파일이 있습니다"라고 물으면 모두 바꾸기를 고르세요.',
  ];
  if (www) {
    lines.push(
      `   이 게임은 게임 파일이 ${www} 폴더 안에 있습니다. 압축 안의 ${www} 폴더를 게임 폴더의 ${www} 폴더와 합쳐지게 덮어쓰세요.`,
      `   (${www} 폴더 안에 ${www} 폴더가 하나 더 생기면 잘못 넣은 것입니다.)`,
    );
  }
  lines.push(
    '   패치노트.txt 와 설치 방법.txt 는 게임에 넣지 않아도 됩니다.',
    '3. 게임을 실행해 한국어로 나오는지 확인하세요.',
    '',
    '패치를 지우려면: 백업해 둔 게임 폴더를 원래 자리에 되돌리면 됩니다.',
  );
  return lines.join('\r\n') + '\r\n';
}
