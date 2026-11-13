# MV/MZ 번역 작업실 · 계획 2: 앱과 채팅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계획 1의 핵심 라이브러리 위에 윈도우용 데스크톱 앱을 올린다. 게임을 가져와 텍스트 표에서 번역을 보고 고칠 수 있고, 앱 안의 채팅으로 Claude CLI에게 말하면 Claude가 앱이 제공하는 도구로 번역표를 고치며 그 변경이 화면에 즉시 반영된다.

**Architecture:** Electron. 메인 프로세스의 `ProjectService` 가 열린 프로젝트의 유일한 소유자이고 모든 읽기와 쓰기가 여기를 지난다. Claude CLI는 헤드리스 모드로 실행되고, CLI가 띄우는 작은 stdio MCP 서버(`src/mcp/server.ts`)가 도구 호출을 로컬 브리지(127.0.0.1)로 메인 프로세스에 넘긴다. 렌더러(React)는 IPC로만 메인과 이야기한다.

**Tech Stack:** Electron, electron-vite, React 19, TypeScript, `@modelcontextprotocol/sdk`, zod, `@tanstack/react-virtual`. 시험은 vitest(메인 로직은 node 환경, 렌더러는 jsdom + `@testing-library/react`), 앱 연기 시험은 `playwright-core` 의 `_electron`. 기존 의존성(fflate, commander)은 그대로.

**Spec:** `docs/2026-11-13-mvmz-번역작업실-기획서.md` (특히 4.10, 4.11, 5, 5.1, 6, 9장). 화면 참고: `docs/mockup/Main.dc.html` (색, 간격, 배치, 문구의 기준. 이 파일은 시안 도구 형식이라 그대로 실행되지는 않는다).

## Global Constraints

- 계획 1의 `src/core` 공개 함수와 타입 이름은 바꾸지 않는다. 필요한 것은 추가만 한다. 계획 1의 시험 61개는 계속 통과해야 한다.
- 원본 게임 폴더에는 쓰지 않는다.
- 프로젝트 데이터의 쓰기는 `ProjectService` 만 한다. MCP 서버 프로세스와 렌더러는 파일을 직접 쓰지 않는다.
- Claude CLI 실행 인자(2.1.318에서 `claude --help` 로 확인한 것): `-p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --model <id> --mcp-config <file> --strict-mcp-config --tools "" --allowedTools <mcp 도구들> --permission-mode dontAsk --append-system-prompt <글>`, 이어가기는 `--resume <session_id>`. 내장 도구는 전부 끈다(`--tools ""`).
- MCP 서버 이름은 `mvmz`. Claude에게 보이는 도구 이름은 `mcp__mvmz__<도구>`.
- 브리지는 `127.0.0.1` 의 임의 포트에서만 듣고, 앱 실행마다 새로 만든 토큰이 `Authorization: Bearer` 로 오지 않으면 401.
- 화면 문구는 한국어, 코드 식별자와 주석은 영어. 색은 CSS 변수로만 쓰고 어두운 테마와 밝은 테마를 둘 다 제공한다.
- 표는 7,000줄에서도 끊기지 않아야 한다(가상 스크롤).
- 시스템에 프로그램 설치가 필요하거나 버전이 맞지 않으면 우회하지 말고 멈춰서 보고한다. `npm install` 로 프로젝트 안에 들어가는 의존성은 해당하지 않는다.
- 커밋은 작업마다 한 번.

테마 색 (CSS 변수 이름 → 어두운 값 / 밝은 값):

| 변수 | 어두운 | 밝은 |
|---|---|---|
| `--bg` | `#121418` | `#F6F5F1` |
| `--panel` | `#181B20` | `#FFFFFF` |
| `--card` | `#1F232A` | `#F0EFEA` |
| `--line` | `#2A2F38` | `#DDDAD2` |
| `--text` | `#E9E7E2` | `#1B1D21` |
| `--sub` | `#A9ADB5` | `#555A63` |
| `--mute` | `#8B909A` | `#6B7079` |
| `--accent` | `#5CC8B5` | `#0F7A6B` |
| `--accent-bg` | `#17342F` | `#DDF1ED` |
| `--accent-text` | `#8ADBCC` | `#0B5F53` |
| `--on-accent` | `#0E1513` | `#FFFFFF` |
| `--warn` / `--warn-bg` | `#E3AD55` / `#3A2D14` | `#8A5A00` / `#F8EBCB` |
| `--err` / `--err-bg` | `#F2A093` / `#3D1F1C` | `#A8322A` / `#F9DEDA` |

글꼴: 화면 `'IBM Plex Sans KR'`, 숫자와 위치 `'IBM Plex Mono'`, Claude의 답 `'Noto Serif KR'`. 글꼴 파일은 npm 패키지(`@fontsource/*`)로 앱에 넣는다(실행 중 네트워크 요청 없음).

## Review Focus

1. **Claude 프로세스가 죽거나 `claude` 를 못 찾을 때**: 채팅에 한 줄 오류("Claude CLI를 실행할 수 없습니다…" 또는 "로그인이 필요합니다. 터미널에서 `claude` 를 실행해 로그인하세요")가 뜨고 앱은 계속 동작한다. → 작업 7
2. **채팅 중에 사용자가 같은 줄을 손으로 고칠 때**: 두 쓰기가 모두 `ProjectService` 를 지나 순서대로 적용되고, 화면은 마지막 값을 보인다. 파일이 깨지지 않는다. → 작업 2
3. **스트림 줄이 잘려서 올 때**: stdout 조각이 JSON 한 줄의 중간에서 끊겨도 파서가 다음 조각과 이어 붙인다. 모르는 `type` 의 줄은 무시한다. → 작업 6
4. **큰 스크린샷**: 붙여넣은 이미지가 5MB를 넘으면 보내지 않고 "이미지가 너무 큽니다(최대 5MB)"를 보인다. PNG, JPEG, WebP만 받는다. → 작업 11
5. **검색어의 특수문자**: `\C[2]`, `(`, `*` 가 들어간 검색어가 정규식으로 해석되지 않고 글자 그대로 찾는다. → 작업 3

---

## File Structure

```
electron.vite.config.ts   tsconfig.node.json   tsconfig.web.json
src/shared/api.ts          IPC 채널 이름, 요청/응답 타입, ChatEvent, Row
src/shared/rows.ts         행 만들기, 필터, 검색, 통계 (순수 함수)
src/main/index.ts          창, 수명 주기
src/main/settings.ts       앱 설정 읽기/쓰기
src/main/projectService.ts 열린 프로젝트의 소유자
src/main/toolHandlers.ts   도구 이름 → 처리 함수
src/main/bridge.ts         로컬 HTTP 브리지
src/main/claude/args.ts    CLI 인자 만들기
src/main/claude/stream.ts  stream-json 파서
src/main/claude/chat.ts    ClaudeChat (프로세스 관리)
src/main/claude/prompt.ts  시스템 프롬프트 글
src/main/ipc.ts            IPC 처리기 등록
src/mcp/server.ts          stdio MCP 서버 (브리지로 넘김)
src/preload/index.ts       contextBridge
src/renderer/index.html  main.tsx  App.tsx  theme.css
src/renderer/state.ts      렌더러 상태 (useSyncExternalStore 기반, 추가 의존성 없음)
src/renderer/components/   TopBar, Sidebar, TextTable, ItemPanel, ChatPanel, SettingsView, ProjectPicker, StatusBar, CodeText
tests/main/**  tests/shared/**  tests/renderer/**  tests/e2e/app.e2e.test.ts
tests/fixtures/fake-claude.mjs
```

## 공용 타입 (`src/shared/api.ts`, 작업 1에서 만든다)

```ts
import type { TextUnit, TranslationEntry, TranslationStatus, UnitKind, Issue } from '../core/types.js';

export interface Row {
  id: string; kind: UnitKind; speaker?: string; source: string;
  target: string | null; status: TranslationStatus; needsDecision: boolean;
  file: string;          // 첫 ref 의 file
  location: string;      // 사람이 읽는 위치. 예 '맵4 · 이벤트3', 'Items · 1', '플러그인 설정'
  refCount: number;
}
export type StatusFilter = 'all' | TranslationStatus | 'needs-decision';
export interface RowQuery { text?: string; status?: StatusFilter; file?: string }
export interface Stats { total: number; untranslated: number; needsReview: number; approved: number; error: number; needsDecision: number }
export interface Scope { file: string; label: string; total: number; done: number }   // done = target 이 있는 수

export type Origin = 'user' | 'chat';
export interface ChangeEvent { ids: string[]; origin: Origin }

export interface ChatImage { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string }
export interface ChatUsage { input: number; output: number; cacheRead: number; cacheCreate: number }
export type ChatEvent =
  | { type: 'session'; sessionId: string; model: string }
  | { type: 'text-delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-start'; id: string; name: string; input: unknown }
  | { type: 'tool-end'; id: string; isError: boolean; summary: string }
  | { type: 'turn-end'; ok: boolean; usage: ChatUsage; error?: string }
  | { type: 'error'; message: string };

export interface ModelOption { id: string; label: string }
export interface AppSettings { theme: 'dark' | 'light'; models: ModelOption[]; chatModel: string; claudePath: string | null; projectsDir: string }
export const DEFAULT_MODELS: ModelOption[] = [
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' }, { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' } ];
```

---

### Task 1: Electron 뼈대와 연기 시험

**Files:**
- Create: `electron.vite.config.ts`, `tsconfig.node.json`, `tsconfig.web.json`, `src/shared/api.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/theme.css`
- Modify: `package.json`(scripts `dev`, `build:app`, `test:e2e`; `main` 은 `out/main/index.js`), `tsconfig.json`, `vitest.config.ts`(프로젝트 둘: node, jsdom), `.gitignore`(`out`)
- Test: `tests/e2e/app.e2e.test.ts`

**Interfaces:**
- Produces: 창 제목 `MV/MZ 번역 작업실`, `contextIsolation: true`, `nodeIntegration: false`, 최소 크기 1100×700. `theme.css` 에 위 표의 변수(`:root[data-theme="dark"]`, `:root[data-theme="light"]`).
- Produces: 환경 변수 `MVMZ_USER_DATA` 가 있으면 `app.setPath('userData', …)` (시험이 설정과 프로젝트 폴더를 격리하는 데 쓴다)

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('앱이 뜨고 프로젝트 고르기 화면이 보인다', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MVMZ_USER_DATA: tmp } });
  const win = await app.firstWindow();
  expect(await win.title()).toBe('MV/MZ 번역 작업실');
  await expect(win.getByRole('heading', { name: '프로젝트' })).toBeVisible();
  expect(await win.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await app.close();
});
```

- [x] **Step 2: `npm run build:app && npm run test:e2e` → FAIL**
- [x] **Step 3: 구현** — `App.tsx` 는 지금은 `<h1>프로젝트</h1>` 만 그린다
- [x] **Step 4: PASS, 그리고 `npx vitest run` 으로 계획 1 시험 61개 통과 확인**
- [x] **Step 5: `git commit -m "feat: Electron 뼈대와 연기 시험"`**

### Task 2: ProjectService

**Files:**
- Create: `src/main/projectService.ts`
- Test: `tests/main/projectService.test.ts`

**Interfaces:**
- Consumes: 계획 1의 `createProject`, `openProject`, `extractAll`, `loadUnits`, `TranslationStore`, `checkTranslation`, `checkAll`, `buildPatch`
- Produces:

```ts
export class ProjectService extends EventEmitter {   // 'changed' → ChangeEvent
  static create(gameDir: string, projectDir: string, name: string): Promise<ProjectService>; // createProject + extractAll
  static open(projectDir: string): Promise<ProjectService>;
  readonly projectDir: string; readonly meta: ProjectMeta;
  units(): TextUnit[];  unit(id: string): TextUnit | undefined;  entry(id: string): TranslationEntry;
  setTranslation(id: string, target: string, origin: Origin): Promise<Issue[]>; // 검사해서 error 가 있으면 status 'error', 없으면 'needs-review'
  setStatus(id: string, status: TranslationStatus, origin: Origin): Promise<void>;
  clearTranslation(id: string, origin: Origin): Promise<void>;                 // target null, 'untranslated'
  issues(id: string): Issue[];                                                  // 현재 target 의 검사 결과
  undo(origin?: Origin): Promise<string[]>;                                     // 가장 최근 변경 하나를 되돌리고 바뀐 id 를 돌려준다. 없으면 []
  build(): Promise<BuildResult>;
  close(): Promise<void>;                                                       // 남은 저장을 끝낸다
}
```

모르는 id 는 `Error('없는 항목입니다: <id>')`. 모든 변경은 내부 큐로 한 번에 하나씩 실행하고, 실행 후 `translations.json` 을 저장하고 `'changed'` 를 낸다. 되돌리기 기록은 메모리에 최대 200개(변경 전 `TranslationEntry` 를 보관).

- [x] **Step 1: 실패하는 시험 쓰기** (`makeMiniGame` 사용, `idOf(source)` 는 시험 도우미)

```ts
test('만들고 다시 열면 같은 항목', async () => {
  const a = await ProjectService.create(game, proj, '약초원'); const n = a.units().length; await a.close();
  const b = await ProjectService.open(proj); expect(b.units().length).toBe(n); expect(b.meta.name).toBe('약초원');
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
```

- [x] **Step 2: `npx vitest run tests/main/projectService.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: ProjectService"`**

### Task 3: 행, 필터, 검색, 통계

**Files:**
- Create: `src/shared/rows.ts`
- Test: `tests/shared/rows.test.ts`

**Interfaces:**
- Produces: `toRow(unit: TextUnit, entry: TranslationEntry): Row`, `locationLabel(unit: TextUnit): string`, `scopeLabel(file: string): string`, `filterRows(rows: Row[], q: RowQuery): Row[]`, `computeStats(rows: Row[]): Stats`, `computeScopes(rows: Row[]): Scope[]`

규칙: `locationLabel` — `data/Map004.json` 의 `['events', 3, 'pages', 0, 'list']` → `맵4 · 이벤트3`(페이지가 0이 아니면 ` · 2페이지` 를 붙인다. 페이지 번호는 1부터), `data/CommonEvents.json` `[7,'list']` → `커먼이벤트7`, `data/Items.json` `[1,'name']` → `Items · 1`, `data/System.json` → `시스템`, `js/plugins.js` → `플러그인 설정`. `scopeLabel` — `data/Map004.json` → `맵4`, `data/CommonEvents.json` → `커먼이벤트`, `js/plugins.js` → `플러그인 설정`, 그 외 `data/X.json` → `X`. `filterRows` — `text` 는 대소문자 무시, 글자 그대로(정규식 아님), source·target·speaker 중 하나에 들어있으면 통과. `status: 'needs-decision'` 은 `needsDecision` 인 행. `computeScopes` 는 처음 나온 파일 순서.

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('위치 이름', () => {
  expect(locationLabel(unitAt({ type: 'lines', file: 'data/Map004.json', listPath: ['events', 3, 'pages', 0, 'list'], start: 1, count: 2, code: 401 }))).toBe('맵4 · 이벤트3');
  expect(locationLabel(unitAt({ type: 'lines', file: 'data/Map004.json', listPath: ['events', 3, 'pages', 1, 'list'], start: 1, count: 1, code: 401 }))).toBe('맵4 · 이벤트3 · 2페이지');
  expect(locationLabel(unitAt({ type: 'value', file: 'data/Items.json', path: [1, 'name'] }))).toBe('Items · 1');
  expect(locationLabel(unitAt({ type: 'value', file: 'js/plugins.js', path: [0, 'parameters', 'title'] }))).toBe('플러그인 설정');
  expect(scopeLabel('data/Map004.json')).toBe('맵4'); expect(scopeLabel('data/CommonEvents.json')).toBe('커먼이벤트');
});
test('검색은 글자 그대로', () => {
  expect(filterRows(rows, { text: '\\C[2]' }).map(r => r.id)).toEqual(['item-desc']);
  expect(filterRows(rows, { text: '(' })).toEqual([]); expect(filterRows(rows, { text: '월광' }).map(r => r.id)).toEqual(['item-name']);
  expect(filterRows(rows, { text: 'リナ' }).length).toBeGreaterThan(1); // 화자로도 찾는다
});
test('상태 필터와 통계', () => {
  expect(filterRows(rows, { status: 'needs-decision' }).every(r => r.needsDecision)).toBe(true);
  expect(filterRows(rows, { status: 'untranslated', file: 'data/Items.json' }).map(r => r.id)).toEqual(['item-desc']);
  expect(computeStats(rows)).toEqual({ total: rows.length, untranslated: rows.length - 1, needsReview: 1, approved: 0, error: 0, needsDecision: 2 });
  expect(computeScopes(rows).find(s => s.file === 'data/Items.json')).toEqual({ file: 'data/Items.json', label: 'Items', total: 2, done: 1 });
});
```

- [x] **Step 2: `npx vitest run tests/shared/rows.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 행 모델과 필터"`**

### Task 4: 도구 처리기

**Files:**
- Create: `src/main/toolHandlers.ts`
- Test: `tests/main/toolHandlers.test.ts`

**Interfaces:**
- Consumes: `ProjectService`, `toRow`, `filterRows`, `computeStats`
- Produces: `interface ToolDef { name: string; description: string; inputSchema: z.ZodObject<any> }`, `TOOL_DEFS: ToolDef[]`, `callTool(svc: ProjectService, name: string, input: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>` — 쓰기는 모두 `origin: 'chat'`

| 도구 | 입력 | 돌려주는 것 |
|---|---|---|
| `project_status` | 없음 | `{ name, engine, stats }` |
| `search_units` | `query: string`, `status?: StatusFilter`, `limit?: number`(기본 20, 최대 50) | `{ total, items: [{ id, kind, speaker, location, source, target, status, needsDecision }] }` |
| `get_unit` | `id: string` | 위 항목 + `refCount`, `issues`, `before`/`after`(같은 파일에서 바로 앞뒤 대사 각 2개의 `{ source, target }`) |
| `set_translation` | `id: string`, `target: string` | `{ status, issues }` |
| `set_status` | `id: string`, `status: 'approved' \| 'needs-review'` | `{ status }` |
| `undo_last` | 없음 | `{ ids }` |

입력이 스키마에 맞지 않거나 모르는 도구면 `ok: false`. 설명글(description)은 한국어로, 언제 쓰는지 한 문장. `search_units` 의 설명에는 "원문, 번역, 화자에서 글자 그대로 찾는다"를 적는다.

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('검색하고 번역을 쓴다', async () => {
  const r = await callTool(svc, 'search_units', { query: '月光草' }); expect(r.ok).toBe(true);
  const id = (r as any).data.items[0].id;
  expect(await callTool(svc, 'set_translation', { id, target: '월광초' })).toEqual({ ok: true, data: { status: 'needs-review', issues: [] } });
  expect(svc.entry(id).target).toBe('월광초');
});
test('limit 은 50을 넘지 않는다', async () => { expect(((await callTool(svc, 'search_units', { query: '', limit: 999 })) as any).data.items.length).toBeLessThanOrEqual(50); });
test('get_unit 은 앞뒤 문맥을 준다', async () => {
  const d = ((await callTool(svc, 'get_unit', { id: idOf('やった！') })) as any).data;
  expect(d.before.map((x: any) => x.source)).toContain('あれ？\\N[1]じゃない！\nこんな夜に来るなんて'); expect(d.refCount).toBe(1);
});
test('잘못된 입력과 모르는 도구', async () => {
  expect(await callTool(svc, 'set_translation', { id: 1 })).toMatchObject({ ok: false });
  expect(await callTool(svc, 'rm_rf', {})).toEqual({ ok: false, error: '모르는 도구입니다: rm_rf' });
  expect(await callTool(svc, 'get_unit', { id: 'nope' })).toEqual({ ok: false, error: '없는 항목입니다: nope' });
});
test('되돌리기는 채팅 변경만', async () => {
  await svc.setTranslation(idOf('リナ'), '리나', 'user'); expect(await callTool(svc, 'undo_last', {})).toEqual({ ok: true, data: { ids: [] } });
});
```

- [x] **Step 2: `npx vitest run tests/main/toolHandlers.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 채팅용 도구 처리기"`**

### Task 5: 브리지와 MCP 서버

**Files:**
- Create: `src/main/bridge.ts`, `src/mcp/server.ts`
- Modify: `electron.vite.config.ts`(메인 빌드에 `mcp/server` 진입점 추가 → `out/main/mcp-server.js`)
- Test: `tests/main/bridge.test.ts`

**Interfaces:**
- Consumes: `callTool`, `TOOL_DEFS`
- Produces: `startBridge(getService: () => ProjectService | null): Promise<{ url: string; token: string; close(): Promise<void> }>` — `GET /tools` → `TOOL_DEFS` 를 JSON Schema 로, `POST /call` `{ name, input }` → `callTool` 결과. 열린 프로젝트가 없으면 `{ ok: false, error: '열린 프로젝트가 없습니다' }`
- Produces: `src/mcp/server.ts` — 환경 변수 `MVMZ_BRIDGE_URL`, `MVMZ_BRIDGE_TOKEN` 을 읽고, `tools/list` 는 브리지의 `/tools`, `tools/call` 은 `/call` 로 넘긴다. 결과는 `content: [{ type: 'text', text: JSON }]`, 실패면 `isError: true`
- Produces: `writeMcpConfig(dir: string, bridge: { url: string; token: string }, serverScript: string, nodePath: string): Promise<string>` — `{ mcpServers: { mvmz: { command: nodePath, args: [serverScript], env: { MVMZ_BRIDGE_URL, MVMZ_BRIDGE_TOKEN } } } }` 를 쓰고 경로를 돌려준다. Electron 에서 `nodePath` 는 `process.execPath` 이고 env 에 `ELECTRON_RUN_AS_NODE: '1'` 을 더한다

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('토큰이 없으면 401', async () => { expect((await fetch(bridge.url + '/tools')).status).toBe(401); });
test('MCP 클라이언트로 도구를 부르면 프로젝트가 바뀐다', async () => {
  const client = await connectStdioClient(process.execPath, [builtServerPath], { MVMZ_BRIDGE_URL: bridge.url, MVMZ_BRIDGE_TOKEN: bridge.token });
  expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(['get_unit', 'project_status', 'search_units', 'set_status', 'set_translation', 'undo_last']);
  const res = await client.callTool({ name: 'set_translation', arguments: { id: idOf('月光草'), target: '월광초' } });
  expect(res.isError).toBeFalsy(); expect(svc.entry(idOf('月光草')).target).toBe('월광초');
  expect((await client.callTool({ name: 'get_unit', arguments: { id: 'nope' } })).isError).toBe(true);
});
test('127.0.0.1 에서만 듣는다', () => { expect(new URL(bridge.url).hostname).toBe('127.0.0.1'); });
```

- [x] **Step 2: `npx vitest run tests/main/bridge.test.ts` → FAIL**
- [x] **Step 3: 구현** — HTTP 는 `node:http`. zod → JSON Schema 는 zod 의 내장 변환을 쓴다
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 로컬 브리지와 MCP 서버"`**

### Task 6: Claude CLI 인자와 스트림 파서

**Files:**
- Create: `src/main/claude/args.ts`, `src/main/claude/stream.ts`, `src/main/claude/prompt.ts`
- Test: `tests/main/claude.test.ts`

**Interfaces:**
- Produces: `buildClaudeArgs(o: { model: string; mcpConfigPath: string; systemPrompt: string; resumeSessionId?: string }): string[]`
- Produces: `class StreamParser { push(chunk: string): ChatEvent[]; }` — 줄 단위 JSON, 조각이 줄 중간에서 끊겨도 이어 붙인다
- Produces: `userMessageLine(text: string, images: ChatImage[]): string` — 표준 입력으로 보낼 한 줄(끝에 `\n`)
- Produces: `buildSystemPrompt(meta: ProjectMeta, stats: Stats): string`

파서 규칙(줄의 `type` 기준):

| 줄 | 내는 이벤트 |
|---|---|
| `system` + `subtype: 'init'` | `session`(`session_id`, `model`) |
| `stream_event` 이고 `event.type === 'content_block_delta'`, `event.delta.type === 'text_delta'` | `text-delta` |
| `assistant` 의 `message.content[]` | `text` 블록 → `text`, `tool_use` 블록 → `tool-start`(`name` 에서 `mcp__mvmz__` 를 뗀다) |
| `user` 의 `message.content[]` 중 `tool_result` | `tool-end`(`tool_use_id`, `is_error`, 내용의 앞 200자) |
| `result` | `turn-end`(`subtype === 'success'` 면 ok. `usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. 실패면 `error` 에 `result` 글자) |
| JSON 이 아닌 줄, 모르는 `type` | 없음 |

입력 한 줄: `{"type":"user","message":{"role":"user","content":[{"type":"text","text":…},{"type":"image","source":{"type":"base64","media_type":…,"data":…}}]}}`.

시스템 프롬프트에 꼭 들어갈 내용: 프로젝트 이름과 엔진, 현재 통계, "게임 파일을 직접 볼 수 없고 `mvmz` 도구만 쓴다", "먼저 `search_units` 로 찾고 필요한 것만 `get_unit` 으로 읽는다", "제어문자와 `%1` 은 그대로 둔다", "`needsDecision` 항목은 화면에 보이는 글자라고 판단될 때만 번역하고 이유를 말한다", "사용자에게는 한국어로 짧게 답한다".

이 형식은 이 계획을 쓸 때 실제 출력으로 확인하지 못했다(CLI 로그인 전). 작업 12에서 실제 CLI 출력으로 맞춰 본다.

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('인자', () => {
  const a = buildClaudeArgs({ model: 'claude-opus-5-5', mcpConfigPath: 'C:/x/mcp.json', systemPrompt: 'S' });
  expect(a).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', 'claude-opus-5-5', '--mcp-config', 'C:/x/mcp.json', '--strict-mcp-config', '--tools', '',
    '--allowedTools', 'mcp__mvmz__project_status,mcp__mvmz__search_units,mcp__mvmz__get_unit,mcp__mvmz__set_translation,mcp__mvmz__set_status,mcp__mvmz__undo_last',
    '--permission-mode', 'dontAsk', '--append-system-prompt', 'S']);
  expect(buildClaudeArgs({ model: 'm', mcpConfigPath: 'p', systemPrompt: 'S', resumeSessionId: 'abc' }).slice(-2)).toEqual(['--resume', 'abc']);
});
test('잘린 줄을 이어 붙인다', () => {
  const p = new StreamParser(); const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'm' }) + '\n';
  expect(p.push(line.slice(0, 10))).toEqual([]); expect(p.push(line.slice(10))).toEqual([{ type: 'session', sessionId: 's1', model: 'm' }]);
});
test('도구 호출과 결과, 끝', () => {
  const p = new StreamParser();
  expect(p.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '찾아볼게' }, { type: 'tool_use', id: 't1', name: 'mcp__mvmz__search_units', input: { query: '記録' } }] } }) + '\n'))
    .toEqual([{ type: 'text', text: '찾아볼게' }, { type: 'tool-start', id: 't1', name: 'search_units', input: { query: '記録' } }]);
  expect(p.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: [{ type: 'text', text: '{"total":1}' }] }] } }) + '\n'))
    .toEqual([{ type: 'tool-end', id: 't1', isError: false, summary: '{"total":1}' }]);
  expect(p.push(JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 } }) + '\n'))
    .toEqual([{ type: 'turn-end', ok: true, usage: { input: 10, output: 5, cacheRead: 3, cacheCreate: 1 } }]);
});
test('쓰레기 줄과 모르는 type 은 무시', () => { expect(new StreamParser().push('hello\n{"type":"zzz"}\n')).toEqual([]); });
test('입력 줄에 이미지가 들어간다', () => {
  const m = JSON.parse(userMessageLine('이거 봐', [{ mediaType: 'image/png', base64: 'AAAA' }]));
  expect(m.message.content).toEqual([{ type: 'text', text: '이거 봐' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]);
});
test('시스템 프롬프트', () => { const s = buildSystemPrompt(meta, stats); expect(s).toContain('약초원'); expect(s).toContain('search_units'); expect(s).toContain('MZ'); });
```

- [x] **Step 2: `npx vitest run tests/main/claude.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: Claude CLI 인자와 스트림 파서"`**

### Task 7: ClaudeChat (프로세스 관리)

**Files:**
- Create: `src/main/claude/chat.ts`, `tests/fixtures/fake-claude.mjs`
- Test: `tests/main/chat.test.ts`

**Interfaces:**
- Consumes: `buildClaudeArgs`, `StreamParser`, `userMessageLine`
- Produces:

```ts
export class ClaudeChat extends EventEmitter {   // 'event' → ChatEvent
  constructor(o: { command: string; prefixArgs?: string[]; cwd: string; mcpConfigPath: string; systemPrompt: string; model: string });
  send(text: string, images?: ChatImage[]): void;   // 프로세스가 없으면 띄운다. 턴이 진행 중이면 Error('답을 기다리는 중입니다')
  setModel(model: string): void;                    // 다음 send 부터 적용. 프로세스를 끝내고 --resume 으로 다시 띄운다
  stop(): void;                                     // 진행 중인 턴을 멈춘다(프로세스 종료). 대화는 --resume 으로 이어진다
  reset(): void;                                    // 새 대화. session id 를 버린다
  readonly busy: boolean; readonly sessionId: string | null;
  dispose(): void;
}
export function findClaude(configured: string | null): string | null; // 설정값 → PATH 의 claude(.exe/.cmd) → null
```

`fake-claude.mjs`: 인자를 `FAKE_CLAUDE_ARGS_OUT` 파일에 JSON 으로 남기고, init 줄을 낸 뒤 stdin 의 한 줄마다 `text-delta` 두 개(`'받음: '`, 사용자 글), `assistant` 줄, `result` 줄을 낸다. 사용자 글이 `'죽어'` 면 종료 코드 3으로 끝나고, `'로그인'` 이면 stderr 에 `Invalid API key · Please run /login` 을 쓰고 종료 코드 1.

오류 규칙: 실행 파일이 없으면(`ENOENT`) `error` 이벤트 `'Claude CLI를 실행할 수 없습니다. 설정에서 경로를 확인하세요.'`. 턴 도중 프로세스가 끝나면 `turn-end` `ok: false`, `error` 는 stderr 마지막 줄. stderr 에 `/login` 이나 `not logged in`(대소문자 무시)이 있으면 `error` 는 `'로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.'`. 어떤 경우에도 예외를 밖으로 던지지 않고, 다음 `send` 는 다시 동작한다.

- [x] **Step 1: 실패하는 시험 쓰기** (`command: process.execPath, prefixArgs: [fakePath]`, `turn(chat, text)` 는 `turn-end` 까지 이벤트를 모으는 도우미)

```ts
test('한 턴', async () => {
  const ev = await turn(chat, '안녕');
  expect(ev[0]).toMatchObject({ type: 'session' }); expect(ev.filter(e => e.type === 'text-delta').map((e: any) => e.text).join('')).toBe('받음: 안녕');
  expect(ev.at(-1)).toMatchObject({ type: 'turn-end', ok: true }); expect(chat.busy).toBe(false); expect(chat.sessionId).toBe('fake-session');
});
test('같은 프로세스로 두 번째 턴', async () => { await turn(chat, '하나'); await turn(chat, '둘'); expect(spawnCount()).toBe(1); });
test('턴 도중 다시 보내면 오류', () => { chat.send('하나'); expect(() => chat.send('둘')).toThrow('답을 기다리는 중입니다'); });
test('모델을 바꾸면 --resume 으로 다시 뜬다', async () => {
  await turn(chat, '하나'); chat.setModel('claude-haiku-5-5'); await turn(chat, '둘');
  const args = lastArgs(); expect(args).toContain('claude-haiku-5-5'); expect(args.slice(-2)).toEqual(['--resume', 'fake-session']);
});
test('프로세스가 죽어도 다음 턴은 된다', async () => {
  expect((await turn(chat, '죽어')).at(-1)).toMatchObject({ type: 'turn-end', ok: false });
  expect((await turn(chat, '다시')).at(-1)).toMatchObject({ type: 'turn-end', ok: true });
});
test('로그인 안 됨', async () => { expect((await turn(chat, '로그인')).at(-1)).toMatchObject({ ok: false, error: '로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.' }); });
test('실행 파일이 없음', async () => {
  const c = new ClaudeChat({ ...opts, command: 'C:/no/such/claude.exe', prefixArgs: [] });
  expect(await firstEvent(c, () => c.send('x'))).toEqual({ type: 'error', message: 'Claude CLI를 실행할 수 없습니다. 설정에서 경로를 확인하세요.' }); expect(c.busy).toBe(false);
});
test('멈추기', async () => { chat.send('느리게'); chat.stop(); expect(chat.busy).toBe(false); expect((await turn(chat, '다시')).at(-1)).toMatchObject({ ok: true }); });
```

(`'느리게'` 는 fake 가 2초 뒤에 답하는 글이다.)

- [x] **Step 2: `npx vitest run tests/main/chat.test.ts` → FAIL**
- [x] **Step 3: 구현** — `child_process.spawn`, `windowsHide: true`. `.cmd` 는 `shell: true` 가 필요하므로 `findClaude` 는 `.exe` 를 먼저 찾는다
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: ClaudeChat 프로세스 관리"`**

### Task 8: 설정, IPC, preload

**Files:**
- Create: `src/main/settings.ts`, `src/main/ipc.ts`
- Modify: `src/preload/index.ts`, `src/main/index.ts`, `src/shared/api.ts`
- Test: `tests/main/settings.test.ts`, `tests/main/ipc.test.ts`

**Interfaces:**
- Produces: `loadSettings(dir: string): Promise<AppSettings>`(파일이 없거나 깨졌으면 기본값: `theme 'dark'`, `models DEFAULT_MODELS`, `chatModel 'claude-fable-5-2'`, `claudePath null`, `projectsDir <documents>/MVMZ 번역 작업실`), `saveSettings(dir, s)`. `models` 가 비면 저장하지 않고 `Error('모델이 하나 이상 있어야 합니다')`
- Produces: `window.api`(preload) — 아래 표. 처리기는 `registerIpc(deps)` 에서 등록하고, `deps` 는 시험에서 가짜로 바꿀 수 있게 주입한다(`ipcMain`, `dialog`, 설정 폴더, 현재 `ProjectService` 를 들고 있는 상자)

| `window.api` | 동작 |
|---|---|
| `settings.get()` / `settings.set(patch)` | 설정 읽기 / 고치기. `theme` 이 바뀌면 모든 창에 `settings:changed` |
| `project.list()` | `projectsDir` 안의 프로젝트 `{ dir, name, engine }[]` |
| `project.pickGameDir()` | 폴더 고르기 창 → 경로 또는 null |
| `project.create(gameDir, name)` | `projectsDir/<name>` 에 만들고 연다. 실패하면 한국어 오류 글자를 던진다 |
| `project.open(dir)` / `project.close()` | 열기 / 닫기(채팅도 끝낸다) |
| `project.snapshot()` | `{ meta, rows: Row[], stats, scopes }` |
| `unit.get(id)` | `{ row, issues, refs 요약 }` |
| `unit.setTranslation(id, target)` / `unit.setStatus(id, status)` / `unit.clear(id)` | `origin: 'user'` 로 쓰기 |
| `project.undo()` | 가장 최근 변경 되돌리기 |
| `project.build()` | `BuildResult` |
| `chat.send(text, images, attachedUnitId?)` | 붙은 항목이 있으면 글 앞에 `[붙은 항목] id=<id> 위치=<location>\n원문: …\n번역: …\n\n` 을 붙여 보낸다 |
| `chat.stop()` / `chat.reset()` / `chat.setModel(id)` | |
| `on('project:changed', cb)` | `{ rows: Row[] (바뀐 것만), stats, scopes, origin }` |
| `on('chat:event', cb)` | `ChatEvent` |
| `on('settings:changed', cb)` | `AppSettings` |

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('설정 기본값과 깨진 파일', async () => {
  expect((await loadSettings(dir)).chatModel).toBe('claude-fable-5-2');
  await writeFile(path.join(dir, 'settings.json'), '{깨'); expect((await loadSettings(dir)).theme).toBe('dark');
  await expect(saveSettings(dir, { ...(await loadSettings(dir)), models: [] })).rejects.toThrow('모델이 하나 이상 있어야 합니다');
});
test('만들고, 고치면 변경 알림에 바뀐 행만 온다', async () => {
  await invoke('project:create', game, '약초원'); const snap = await invoke('project:snapshot');
  expect(snap.rows.length).toBeGreaterThan(5); const id = snap.rows.find((r: Row) => r.source === '月光草').id;
  await invoke('unit:setTranslation', id, '월광초');
  expect(sent('project:changed').at(-1)).toMatchObject({ origin: 'user', rows: [{ id, target: '월광초' }], stats: { needsReview: 1 } });
});
test('붙은 항목이 채팅 글 앞에 들어간다', async () => {
  await invoke('chat:send', '이 줄 좀 더 밝게', [], id);
  expect(fakeChat.sent[0].text).toMatch(/^\[붙은 항목\] id=.+ 위치=Items · 1\n원문: 月光草\n번역: 월광초\n\n이 줄 좀 더 밝게$/);
});
test('같은 이름의 프로젝트가 있으면 오류', async () => { await expect(invoke('project:create', game, '약초원')).rejects.toThrow('프로젝트 폴더가 비어있지 않습니다'); });
```

- [x] **Step 2: `npx vitest run tests/main/settings.test.ts tests/main/ipc.test.ts` → FAIL**
- [x] **Step 3: 구현** — `index.ts` 에서 브리지 시작, MCP 설정 파일 쓰기, `ProjectService` 의 `'changed'` 와 `ClaudeChat` 의 `'event'` 를 창으로 전달
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 설정과 IPC"`**

### Task 9: 렌더러 뼈대 — 상태, 테마, 프로젝트 고르기, 배치

**Files:**
- Create: `src/renderer/state.ts`, `src/renderer/components/ProjectPicker.tsx`, `TopBar.tsx`, `Sidebar.tsx`, `StatusBar.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/theme.css`
- Test: `tests/renderer/shell.test.tsx`

**Interfaces:**
- Consumes: `window.api`(시험에서는 `fakeApi()` 로 바꾼다)
- Produces: `useApp()` — `{ settings, snapshot, rowsById, selectedId, query, view: 'text' | 'settings', rightTab: 'item' | 'chat', chat: { messages, busy, usage, sessionModel } }` 와 그 변경 함수들. `project:changed` 가 오면 바뀐 행만 갈아 끼운다

화면(시안의 배치를 따른다): 프로젝트가 없으면 `ProjectPicker`(기존 프로젝트 목록, "게임 폴더 고르기" → 이름 입력 → 만들기, 진행 중 표시, 오류 글자). 프로젝트가 열리면 위 `TopBar`(게임 이름, 엔진, 전체 진행률 막대와 `n / m줄 · p%`, "패치 빌드" 버튼), 왼쪽 `Sidebar`(작업: "텍스트 <미번역 수>", "설정" / 범위별 진행률: 누르면 그 파일로 필터, 다시 누르면 해제 / "원본 게임은 수정되지 않음" 상자), 가운데 본문, 오른쪽 "항목 | 채팅" 탭, 아래 `StatusBar`("Claude CLI 연결됨" 또는 "Claude CLI 없음", 이번 대화 입력·출력 토큰, 캐시 적중률, 마지막 저장 시각). 시안에 있지만 이 계획에서 만들지 않는 것(용어집, 이미지, 이벤트, 수정 내역, 스토리 보기, 게임 실행, 새 버전 가져오기, 인게임 미리보기)은 그리지 않는다. 빈 버튼이나 "준비 중"을 두지 않는다.

패치 빌드: 누르면 `project.build()`. 성공하면 "패치를 만들었습니다 · 파일 n개 · 오류로 뺀 항목 k개"와 "폴더 열기", 실패하면 오류 글자(예: "바뀐 파일이 없습니다").

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
test('프로젝트가 없으면 고르기 화면, 만들면 본 화면', async () => {
  render(<App />); expect(await screen.findByRole('heading', { name: '프로젝트' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '게임 폴더 고르기' })); await user.type(screen.getByLabelText('프로젝트 이름'), '약초원');
  await user.click(screen.getByRole('button', { name: '만들기' }));
  expect(await screen.findByText('霧の薬草園')).toBeVisible(); expect(api.calls).toContainEqual(['project.create', 'C:/game', '약초원']);
});
test('진행률과 범위', async () => {
  await openFake(); expect(screen.getByText('1 / 8줄 · 13%')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /Items/ })); expect(useApp.get().query.file).toBe('data/Items.json');
});
test('테마 전환', async () => { await openFake(); api.emit('settings:changed', { ...settings, theme: 'light' }); expect(document.documentElement.dataset.theme).toBe('light'); });
test('변경 알림은 그 행만 바꾼다', async () => {
  await openFake(); const before = useApp.get().rowsById;
  api.emit('project:changed', { rows: [{ ...row1, target: '리나', status: 'needs-review' }], stats, scopes, origin: 'chat' });
  expect(useApp.get().rowsById[row1.id].target).toBe('리나'); expect(useApp.get().rowsById[row2.id]).toBe(before[row2.id]);
});
test('패치 빌드 결과', async () => {
  await openFake(); await user.click(screen.getByRole('button', { name: '패치 빌드' }));
  expect(await screen.findByText('패치를 만들었습니다 · 파일 3개 · 오류로 뺀 항목 1개')).toBeVisible();
});
```

- [ ] **Step 2: `npx vitest run tests/renderer/shell.test.tsx` → FAIL**
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS**
- [ ] **Step 5: `git commit -m "feat: 앱 배치와 프로젝트 고르기"`**

### Task 10: 텍스트 표와 항목 탭

**Files:**
- Create: `src/renderer/components/TextTable.tsx`, `ItemPanel.tsx`, `CodeText.tsx`
- Test: `tests/renderer/text.test.tsx`

**Interfaces:**
- Consumes: `useApp`, `filterRows`, `controlCodes`(계획 1)
- Produces: `<CodeText text />` — 제어문자와 `%1` 을 칩(`<code class="chip">`)으로, 줄바꿈을 `<br>` 로 그린다

표: 열은 위치, 화자, 원문, 번역, 상태. `@tanstack/react-virtual` 로 보이는 줄만 그린다. 위에 상태 필터 칩("전체 n", "미번역 n", "검토 필요 n", "승인됨 n", "오류 n", "판단 필요 n")과 검색 칸(입력 후 200ms 뒤 적용). 줄을 누르면 선택되고 오른쪽이 "항목" 탭으로 바뀐다. 위아래 화살표로 선택 이동. 미번역 줄의 번역 칸은 흐린 "번역 전", 판단 필요 줄은 "판단 대기".

항목 탭: 위치와 `refCount` 가 2 이상이면 "같은 문장 n곳", 원문(`CodeText`), 번역 편집 칸(textarea. `Ctrl+Enter` 로 저장, 저장하면 `unit.setTranslation`), 검사 결과 목록(문제가 없으면 "통과 · 제어 코드 일치" 한 줄, 있으면 규칙별 한 줄), 버튼 "채팅으로 말하기"(오른쪽을 채팅 탭으로 바꾸고 이 항목을 붙인다), "지우기", "승인"(상태가 `error` 이거나 번역이 없으면 누를 수 없고 이유를 옆에 적는다). 선택이 없으면 "줄을 고르면 여기에 자세한 내용이 나와요".

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
test('제어문자 칩', () => {
  const { container } = render(<CodeText text={'月光草を\\C[4]3本\\C[0]\n%1 G'} />);
  expect([...container.querySelectorAll('code.chip')].map(e => e.textContent)).toEqual(['\\C[4]', '\\C[0]', '%1']); expect(container.querySelectorAll('br')).toHaveLength(1);
});
test('7000줄이어도 보이는 줄만 그린다', async () => { await openFake({ rows: manyRows(7000) }); expect(screen.getAllByRole('row').length).toBeLessThan(80); });
test('필터 칩과 검색', async () => {
  await openFake(); await user.click(screen.getByRole('button', { name: /미번역 7/ })); expect(useApp.get().query.status).toBe('untranslated');
  await user.type(screen.getByLabelText('문장 검색'), '月光'); await waitFor(() => expect(useApp.get().query.text).toBe('月光'));
});
test('고치고 저장', async () => {
  await openFake(); await user.click(screen.getByText('月光草')); const box = screen.getByLabelText('번역');
  await user.clear(box); await user.type(box, '월광초{Control>}{Enter}{/Control}'); expect(api.calls).toContainEqual(['unit.setTranslation', itemId, '월광초']);
});
test('오류 상태는 승인할 수 없다', async () => {
  await openFake({ select: errorRowId }); expect(screen.getByRole('button', { name: '승인' })).toBeDisabled(); expect(screen.getByText(/제어 코드/)).toBeVisible();
});
test('채팅으로 말하기는 항목을 붙인다', async () => {
  await openFake({ select: itemId }); await user.click(screen.getByRole('button', { name: '채팅으로 말하기' }));
  expect(useApp.get().rightTab).toBe('chat'); expect(screen.getByText(/붙은 항목 · Items · 1/)).toBeVisible();
});
```

- [ ] **Step 2: `npx vitest run tests/renderer/text.test.tsx` → FAIL**
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS**
- [ ] **Step 5: `git commit -m "feat: 텍스트 표와 항목 탭"`**

### Task 11: 채팅 탭

**Files:**
- Create: `src/renderer/components/ChatPanel.tsx`
- Test: `tests/renderer/chat.test.tsx`

**Interfaces:**
- Consumes: `useApp`, `window.api.chat`, `on('chat:event')`

동작: 메시지 목록(사용자 말풍선에 첨부 이미지 썸네일, Claude의 답은 `Noto Serif KR`, `text-delta` 가 오는 대로 이어 그리고 `text` 가 오면 그 글로 확정). 도구 호출은 작은 한 줄: `search_units` → `검색 · "<query>"`, `get_unit` → `읽음 · <위치>`, `set_translation` → `수정 · <위치>`, `set_status` → `상태 변경 · <위치>`, `undo_last` → `되돌림`, `project_status` → `상태 확인`. `set_translation` 줄은 버튼이고 누르면 그 항목을 표에서 선택한다. 실패한 도구 줄은 `--err` 색. 입력 칸은 `Enter` 로 보내고 `Shift+Enter` 는 줄바꿈. 답을 기다리는 동안 보내기 버튼은 "멈추기"로 바뀐다. 첨부: 이미지 버튼(파일 고르기), 붙여넣기(`paste` 의 이미지), 끌어다 놓기. PNG·JPEG·WebP 만, 한 장 최대 5MB, 한 번에 최대 4장. 넘으면 보내지 않고 칸 아래에 이유를 적는다. 붙은 항목은 칩으로 보이고 ×로 뗀다. 모델 고르기(`settings.models`), "새 대화", "방금 변경 되돌리기"(`project.undo()` 가 아니라 채팅 출처만 되돌리도록 `chat` 쪽 IPC `chat.undo()` 를 작업 8의 표에 추가해 쓴다). `turn-end` 의 `ok: false` 와 `error` 이벤트는 목록에 `--err` 색 한 줄로 보인다. 아래에 "이번 대화 n 토큰".

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
test('보내고 답이 이어서 그려진다', async () => {
  await openFake({ rightTab: 'chat' }); await user.type(screen.getByLabelText('메시지'), '안녕{Enter}');
  expect(api.calls).toContainEqual(['chat.send', '안녕', [], undefined]);
  api.emit('chat:event', { type: 'text-delta', text: '찾아' }); api.emit('chat:event', { type: 'text-delta', text: '볼게' });
  expect(await screen.findByText('찾아볼게')).toBeVisible(); expect(screen.getByRole('button', { name: '멈추기' })).toBeVisible();
  api.emit('chat:event', { type: 'turn-end', ok: true, usage: { input: 1200, output: 300, cacheRead: 0, cacheCreate: 0 } });
  expect(screen.getByRole('button', { name: '보내기' })).toBeVisible(); expect(screen.getByText('이번 대화 1,500 토큰')).toBeVisible();
});
test('도구 줄과 이동', async () => {
  api.emit('chat:event', { type: 'tool-start', id: 't1', name: 'search_units', input: { query: '記録' } });
  api.emit('chat:event', { type: 'tool-start', id: 't2', name: 'set_translation', input: { id: itemId, target: '월광초' } });
  expect(await screen.findByText('검색 · "記録"')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '수정 · Items · 1' })); expect(useApp.get().selectedId).toBe(itemId);
});
test('이미지 붙여넣기', async () => {
  await user.click(screen.getByLabelText('메시지')); await user.paste(pngClipboard(1000)); expect(await screen.findByAltText('첨부 1')).toBeVisible();
  await user.type(screen.getByLabelText('메시지'), '여기{Enter}'); expect(api.calls.at(-1)).toEqual(['chat.send', '여기', [{ mediaType: 'image/png', base64: expect.any(String) }], undefined]);
});
test('너무 큰 이미지와 지원하지 않는 형식', async () => {
  await user.paste(pngClipboard(6 * 1024 * 1024)); expect(await screen.findByText('이미지가 너무 큽니다(최대 5MB)')).toBeVisible();
  await dropFile('a.gif', 'image/gif'); expect(await screen.findByText('PNG, JPEG, WebP 이미지만 보낼 수 있어요')).toBeVisible(); expect(screen.queryByAltText('첨부 1')).toBeNull();
});
test('오류는 한 줄로', async () => {
  api.emit('chat:event', { type: 'turn-end', ok: false, usage: zero, error: '로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.' });
  expect(await screen.findByText(/로그인이 필요합니다/)).toBeVisible(); expect(screen.getByRole('button', { name: '보내기' })).toBeEnabled();
});
```

- [ ] **Step 2: `npx vitest run tests/renderer/chat.test.tsx` → FAIL**
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS**
- [ ] **Step 5: `git commit -m "feat: 채팅 탭"`**

### Task 12: 설정 화면, 전체 연기 시험, 실제 CLI 확인

**Files:**
- Create: `src/renderer/components/SettingsView.tsx`
- Modify: `tests/e2e/app.e2e.test.ts`, `README.md`
- Test: `tests/renderer/settings.test.tsx`, `tests/e2e/app.e2e.test.ts`

**Interfaces:**
- Consumes: `window.api.settings`

설정 화면: 테마(어두운/밝은), 채팅 기본 모델, 모델 목록 편집(이름과 id, 추가와 삭제. 마지막 하나는 지울 수 없다), Claude CLI 경로(비우면 자동 찾기, 지금 찾은 경로를 보여준다), 프로젝트 폴더 위치.

연기 시험은 가짜 CLI 로 한다: 환경 변수 `MVMZ_CLAUDE_COMMAND`, `MVMZ_CLAUDE_PREFIX_ARGS`(JSON 배열)가 있으면 `findClaude` 대신 그것을 쓴다. 폴더 고르기 창은 `MVMZ_PICK_DIR` 가 있으면 그 경로를 돌려준다.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
// settings.test.tsx
test('마지막 모델은 지울 수 없다', async () => { await openSettings({ models: [m1] }); expect(screen.getByRole('button', { name: 'Claude Fable 5.2 삭제' })).toBeDisabled(); });
test('모델 추가', async () => {
  await openSettings(); await user.type(screen.getByLabelText('모델 이름'), 'Claude Opus 6'); await user.type(screen.getByLabelText('모델 id'), 'claude-opus-6');
  await user.click(screen.getByRole('button', { name: '모델 추가' })); expect(api.calls.at(-1)[1].models.at(-1)).toEqual({ id: 'claude-opus-6', label: 'Claude Opus 6' });
});
// app.e2e.test.ts
test('가져오기 → 손으로 번역 → 채팅 → 빌드', async () => {
  const app = await launch({ MVMZ_PICK_DIR: game, MVMZ_CLAUDE_COMMAND: process.execPath, MVMZ_CLAUDE_PREFIX_ARGS: JSON.stringify([fakeClaude]) });
  const w = await app.firstWindow();
  await w.getByRole('button', { name: '게임 폴더 고르기' }).click(); await w.getByLabel('프로젝트 이름').fill('약초원'); await w.getByRole('button', { name: '만들기' }).click();
  await w.getByText('月光草', { exact: true }).click(); await w.getByLabel('번역').fill('월광초'); await w.getByLabel('번역').press('Control+Enter');
  await expect(w.getByRole('row', { name: /月光草.*월광초.*검토 필요/ })).toBeVisible();
  await w.getByRole('tab', { name: '채팅' }).click(); await w.getByLabel('메시지').fill('안녕'); await w.getByLabel('메시지').press('Enter');
  await expect(w.getByText('받음: 안녕')).toBeVisible();
  await w.getByRole('button', { name: '패치 빌드' }).click(); await expect(w.getByText(/패치를 만들었습니다 · 파일 1개/)).toBeVisible();
  expect(existsSync(path.join(projectsDir, '약초원/builds/001/약초원_patch_001.zip'))).toBe(true);
  await app.close();
});
```

- [ ] **Step 2: `npx vitest run tests/renderer/settings.test.tsx && npm run build:app && npm run test:e2e` → FAIL**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 전체 확인** — `npx vitest run` 전부 통과, `npx tsc --noEmit -p tsconfig.node.json` 와 `-p tsconfig.web.json` 오류 없음, `npm run test:e2e` 통과
- [ ] **Step 5: 실제 CLI 확인** — `claude auth status` 가 `loggedIn: true` 일 때만 한다. 로그인돼 있지 않으면 이 단계를 건너뛰고 보고에 "실제 CLI 확인 안 함"이라고 적는다(로그인은 사용자만 할 수 있다). 로그인돼 있으면: `makeMiniGame` 으로 만든 게임으로 `ProjectService` 와 브리지를 띄우고 실제 `claude` 를 `buildClaudeArgs` 인자로 실행해 "月光草 를 찾아서 '월광초'로 번역해줘"를 보낸다. 확인할 것: (1) 출력 줄의 실제 모양이 작업 6의 파서 표와 맞는지. 다르면 실제 출력 몇 줄을 `tests/fixtures/real-stream.jsonl` 로 저장하고 파서와 시험을 실제 모양에 맞춘다, (2) Claude가 `mcp__mvmz__set_translation` 을 불러 번역표가 바뀌는지, (3) 내장 도구(Bash, Read 등)가 도구 목록에 없는지. 인자 이름이 달라 실행이 안 되면 고치지 말고 멈춰서 보고한다
- [ ] **Step 6: `README.md` 에 실행 방법(`npm run dev`), 구조, 채팅 도구 표를 적고 `git commit -m "feat: 설정 화면과 전체 흐름 시험"`**

---

## 이 계획이 끝난 뒤 사람이 확인할 것

- 실제 게임(MV 6,937줄짜리)을 가져와 표가 끊기지 않는지, 검색이 바로 되는지.
- 채팅에서 스크린샷을 붙이고 "여기 일본어 남았어"라고 했을 때 Claude가 찾아서 고치는지, 고친 줄이 표에 바로 보이는지.
- 밝은 테마에서 글자가 잘 읽히는지.
