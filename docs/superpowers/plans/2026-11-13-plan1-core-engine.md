# MV/MZ 번역 작업실 · 계획 1: 핵심 엔진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 화면 없이 명령줄로 MV/MZ 게임을 가져오고, 번역 대상 텍스트를 뽑고, 번역을 받아 넣고, 검사하고, 바뀐 파일만 묶은 패치 zip을 만드는 핵심 라이브러리를 만든다.

**Architecture:** 순수 TypeScript 라이브러리(`src/core`)와 얇은 CLI(`src/cli.ts`). 원본 게임은 읽기만 하고, 프로젝트 폴더에 원본 사본(data, js)과 층(units, translations, builds)을 JSON 파일로 쌓는다. 이후 계획의 Electron 앱과 MCP 도구는 이 라이브러리의 함수를 그대로 부른다.

**Tech Stack:** Node 22, TypeScript 5 (strict, ESM), vitest, fflate(zip), commander(CLI). 다른 런타임 의존성은 넣지 않는다.

**Spec:** `docs/2026-11-13-mvmz-번역작업실-기획서.md`

## 전체 순서 (계획 7개)

기획서가 독립된 덩어리 여러 개라서 계획을 나눈다. 계획마다 그 자체로 동작하는 결과물이 나온다. 이 문서는 계획 1이고, 나머지는 앞 계획이 끝난 뒤에 따로 쓴다.

| 계획 | 내용 | 끝나면 되는 것 |
|---|---|---|
| **1 핵심 엔진** (이 문서) | 가져오기, 추출, 번역표, 형식 검사, 적용, 패치 zip, CLI | 명령줄로 게임 하나를 번역 패치까지 |
| 2 앱 껍데기와 채팅 | Electron, 텍스트 화면(표), Claude CLI 연결, MCP 도구, 스크린샷 첨부, 화면 즉시 반영 | 앱에서 채팅으로 번역 시키기 |
| 3 용어집과 번역 흐름 | 용어집 3부, 인물 카드, 추천안 진행과 표시, 묶음 번역, 검수, 단계별 모델, 식별자 의심 판정 | 처음부터 끝까지 번역 한 바퀴 |
| 4 미리보기와 스토리 보기 | 인게임 미리보기, 픽셀 폭 검사, 폰트 고르기, 스토리 보기, 항목 탭 | 넘침을 실행 전에 잡기 |
| 5 이벤트와 수정 층 | 이벤트 풀어쓰기, 사용처 검색, 수정 기록과 적용, 한글 폰트 수정, 게임 실행 | 버그 수정과 기능 추가 |
| 6 업데이트 비교 | 새 버전 가져오기, 번역 승계, 수정 충돌 | 바뀐 것만 다시 작업 |
| 7 이미지와 패치노트 | 이미지 복호화 사용, 모음판, 지시서, 찍기, 패치노트, 제작자 목록 | 이미지 번역과 배포 기록 |

Enigma/`package.nw` 풀기는 계획 2의 가져오기 화면에서 다룬다. 계획 1은 이미 풀린 폴더를 받는다.

## Global Constraints

- 원본 게임 폴더에는 절대 쓰지 않는다. 모든 쓰기는 프로젝트 폴더 안에서만 한다.
- 대상 엔진은 RPG Maker MV와 MZ뿐이다. 다른 엔진이면 오류로 멈춘다.
- 번역 후보는 일본어 글자(히라가나, 가타카나, 한자, 반각 가타카나)가 하나라도 들어간 문자열만이다.
- 제어문자(`\V[1]`, `\N[2]`, `\C[2]`, `\I[87]`, `\{`, `\}`, `\.`, `\|`, `\!`, `\>`, `\<`, `\^`, `\$`, `\\`)와 `%1` 같은 자리 표시는 번역에서 종류와 개수가 같아야 한다.
- 번역이 없는 항목은 원문 그대로 둔다. 번역이 하나도 적용되지 않은 파일은 패치에 넣지 않는다.
- 패치 zip 안의 경로는 게임 최상위 폴더 기준 상대 경로다(MV 배포판이면 `www/data/...`).
- 프로젝트 폴더의 파일은 UTF-8 JSON, 들여쓰기 2칸.
- 모든 공개 함수는 `src/core/index.ts` 에서 다시 내보낸다.
- 커밋은 작업마다 한 번. 실행 전에 프로젝트 폴더에서 `git init` 을 한다(이 폴더는 아직 저장소가 아니다).

## Review Focus

1. **DB 배열의 `null` 과 빈 이벤트**: `Actors.json` 의 0번, 맵의 `events[0]`, 지워진 이벤트는 `null` 이다. 추출과 적용이 죽지 않고 건너뛴다. → 작업 4, 5
2. **번역 줄 수가 원문과 다른 대사**: 2줄 원문을 3줄로 번역하면 `401` 커맨드가 3개로 바뀌고, 같은 목록의 뒤쪽 대사와 선택지도 올바른 자리에 들어간다. → 작업 10
3. **선택지 `102` 와 분기 `402` 의 짝**: 선택지를 번역하면 `402` 의 글자도 같은 번역으로 바뀐다. 어긋나면 게임에서 분기가 깨진다. → 작업 10
4. **플러그인 설정의 겹친 JSON 문자열**: 번역하지 않은 설정값은 다시 감싼 결과가 원본과 글자 하나까지 같다. → 작업 6, 10
5. **깨진 데이터 파일과 BOM**: UTF-8 BOM이 붙은 JSON은 읽는다. JSON이 아닌 파일은 그 파일만 건너뛰고 경고 목록에 넣으며, 나머지는 계속한다. → 작업 7

---

## File Structure

```
package.json  tsconfig.json  vitest.config.ts
src/core/index.ts               공개 함수 다시 내보내기
src/core/types.ts               공용 타입
src/core/engine/detect.ts       엔진 판별, 폴더 위치
src/core/engine/crypto.ts       이미지·소리 파일 복호화와 암호화
src/core/text/japanese.ts       일본어 글자 판별
src/core/text/controlCodes.ts   제어문자 뽑기
src/core/extract/events.ts      이벤트 커맨드 목록에서 추출
src/core/extract/database.ts    데이터베이스와 맵에서 추출
src/core/extract/plugins.ts     plugins.js 읽기, 추출, 다시 쓰기
src/core/extract/index.ts       전체 추출, 합치기
src/core/project/project.ts     프로젝트 만들기, 열기, 경로
src/core/store/translations.ts  번역표
src/core/check/format.ts        형식 검사
src/core/build/apply.ts         번역 적용
src/core/build/patch.ts         패치 zip
src/cli.ts                      명령줄
tests/helpers/miniGame.ts       시험용 작은 게임 만들기
tests/**/*.test.ts
```

## 공용 타입 (`src/core/types.ts`, 작업 1에서 만든다)

```ts
export type Engine = 'MV' | 'MZ';

export interface GameInfo {
  engine: Engine;
  topDir: string;        // 사용자가 지정한 게임 최상위 폴더
  contentDir: string;    // data, js, img 가 들어있는 폴더 (MV 배포판이면 topDir/www)
  contentPrefix: string; // '' 또는 'www/'  (패치 경로 앞에 붙는다)
  encryptedImages: boolean;
  encryptionKey: string | null; // 32자 hex
}

export type UnitKind =
  | 'dialogue' | 'choice' | 'scroll' | 'name-change'
  | 'db' | 'system' | 'map-name'
  | 'plugin-param' | 'plugin-command' | 'script' | 'comment';

export type PathSeg = string | number | { key: string | number; json: true };

export type UnitRef =
  | { type: 'value'; file: string; path: PathSeg[] }                       // 값 하나
  | { type: 'lines'; file: string; listPath: PathSeg[]; start: number; count: number; code: 401 | 405 } // 연속 줄 묶음
  | { type: 'choice'; file: string; listPath: PathSeg[]; index: number; choice: number };              // 102의 n번째 선택지

export interface TextUnit {
  id: string;          // sha1(kind + '\u0000' + (speaker ?? '') + '\u0000' + source) 앞 16자
  kind: UnitKind;
  source: string;      // 줄 묶음은 '\n' 으로 이음
  speaker?: string;
  needsDecision: boolean; // plugin-param, plugin-command, script, comment 는 true
  refs: UnitRef[];
}

export type TranslationStatus = 'untranslated' | 'needs-review' | 'approved' | 'error';
export interface TranslationEntry { target: string | null; status: TranslationStatus; updatedAt: string }

export interface Issue { rule: 'control-codes' | 'leftover-japanese' | 'line-count' | 'empty'; severity: 'error' | 'warning'; message: string }
export interface Warning { file: string; message: string }
```

`file` 은 항상 `contentDir` 기준 상대 경로이고 `/` 로 쓴다(예: `data/Map001.json`, `js/plugins.js`).

---

### Task 1: 뼈대, 시험용 게임, 엔진 판별

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/core/types.ts`, `src/core/index.ts`, `src/core/engine/detect.ts`, `tests/helpers/miniGame.ts`
- Test: `tests/engine/detect.test.ts`

**Interfaces:**
- Produces: `detectGame(topDir: string): Promise<GameInfo>` — MV/MZ가 아니면 `Error('MV/MZ 게임이 아닙니다: <이유>')`
- Produces: `makeMiniGame(dir: string, opts?: { engine?: Engine; www?: boolean; encrypted?: boolean }): Promise<void>` (시험 전용)

판별 규칙: `topDir/www/data/System.json` 이 있으면 `contentDir = topDir/www`, 없으면 `topDir`. `js/rmmz_core.js` 가 있으면 MZ, `js/rpg_core.js` 가 있으면 MV, 둘 다 없으면 오류. 키는 `data/System.json` 의 `hasEncryptedImages`, `encryptionKey`.

`makeMiniGame` 이 쓰는 내용(뒤 작업의 시험이 이 값에 기대므로 그대로 쓴다):

```ts
// data/System.json
{ gameTitle: '霧の薬草園', currencyUnit: 'ゴールド', hasEncryptedImages: false, encryptionKey: '',
  terms: { basic: ['レベル', 'Lv'], commands: ['たたかう', null], params: ['最大HP'], messages: { alwaysDash: '常時ダッシュ' } },
  elements: ['', '物理'], skillTypes: ['', '魔法'], weaponTypes: [''], armorTypes: [''], equipTypes: ['', '武器'] }
// data/Actors.json
[null, { id: 1, name: 'リナ', nickname: '', profile: '薬草園の見習い', note: '' }]
// data/Items.json
[null, { id: 1, name: '月光草', description: '夜に光る草。\\C[2]貴重\\C[0]だ', note: '' }]
// data/Classes.json Skills.json Weapons.json Armors.json Enemies.json States.json Troops.json → [null]
// data/MapInfos.json
[null, { id: 1, name: 'MAP001' }]
// data/CommonEvents.json
[null, { id: 1, name: '', list: [
  { code: 105, indent: 0, parameters: [2, false] },
  { code: 405, indent: 0, parameters: ['むかしむかし'] },
  { code: 0, indent: 0, parameters: [] } ] }]
// data/Map001.json  (MV일 때는 101의 parameters 에서 5번째 값 'リナ' 를 뺀다)
{ displayName: '薬草園', events: [null, { id: 1, name: 'EV001', pages: [{ list: [
  { code: 101, indent: 0, parameters: ['', 0, 0, 2, 'リナ'] },
  { code: 401, indent: 0, parameters: ['あれ？\\N[1]じゃない！'] },
  { code: 401, indent: 0, parameters: ['こんな夜に来るなんて'] },
  { code: 102, indent: 0, parameters: [['いいよ', 'また今度'], 1, 0, 2, 0] },
  { code: 402, indent: 0, parameters: [0, 'いいよ'] },
  { code: 101, indent: 1, parameters: ['', 0, 0, 2, 'リナ'] },
  { code: 401, indent: 1, parameters: ['やった！'] },
  { code: 0, indent: 1, parameters: [] },
  { code: 402, indent: 0, parameters: [1, 'また今度'] },
  { code: 0, indent: 1, parameters: [] },
  { code: 404, indent: 0, parameters: [] },
  { code: 356, indent: 0, parameters: ['ShowRecord 記録'] },
  { code: 0, indent: 0, parameters: [] } ] }] }] }
// js/plugins.js  (이 글자 그대로)
var $plugins =
[{"name":"Menu","status":true,"description":"","parameters":{"title":"記録","list":"[\"{\\\"label\\\":\\\"物語\\\",\\\"id\\\":\\\"story\\\"}\"]","speed":"4"}}];
// js/rmmz_core.js (MZ) 또는 js/rpg_core.js (MV): 빈 파일
```

`www: true` 면 위 전부를 `dir/www/` 아래에 쓴다. `encrypted: true` 면 System 의 `hasEncryptedImages: true`, `encryptionKey: 'd41d8cd98f00b204e9800998ecf8427e'`.

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
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
```

- [x] **Step 2: `npx vitest run tests/engine/detect.test.ts` → FAIL (모듈 없음)**
- [x] **Step 3: `package.json`(type module, scripts `test`, `build`, bin `mvmz` → `dist/cli.js`), `tsconfig.json`(strict, NodeNext, outDir dist), 타입, `makeMiniGame`, `detectGame` 구현**
- [x] **Step 4: 같은 명령 → PASS**
- [x] **Step 5: `git add -A && git commit -m "feat: 프로젝트 뼈대와 엔진 판별"`**

### Task 2: 이미지·소리 파일 복호화와 암호화

**Files:**
- Create: `src/core/engine/crypto.ts`
- Test: `tests/engine/crypto.test.ts`

**Interfaces:**
- Produces: `decryptAsset(data: Uint8Array, keyHex: string): Uint8Array`, `encryptAsset(plain: Uint8Array, keyHex: string): Uint8Array`, `plainExtension(encryptedName: string): string | null`, `encryptedExtension(plainName: string, engine: Engine): string | null`

형식: 암호화 파일 = 머리 16바이트(`52 50 47 4D 56 00 00 00 00 03 01 00 00 00 00 00`) + 본문. 본문의 앞 16바이트만 키 16바이트와 XOR 되어 있다. 머리가 다르면 `Error('RPG Maker 암호화 파일이 아닙니다')`. 확장자: MV `.rpgmvp`↔`.png`, `.rpgmvo`↔`.ogg`, `.rpgmvm`↔`.m4a`. MZ `.png_`, `.ogg_`, `.m4a_`.

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
const key = 'd41d8cd98f00b204e9800998ecf8427e';
const png = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, ...Array(40).fill(7)]);
test('암호화하고 풀면 원래대로', () => { expect(decryptAsset(encryptAsset(png, key), key)).toEqual(png); });
test('암호화 결과는 머리 16바이트가 붙고 16바이트 뒤는 그대로', () => {
  const e = encryptAsset(png, key);
  expect(e.length).toBe(png.length + 16); expect([...e.slice(0, 5)]).toEqual([0x52,0x50,0x47,0x4d,0x56]);
  expect(e.slice(32)).toEqual(png.slice(16)); expect(e[16]).toBe(0x89 ^ 0xd4);
});
test('머리가 다르면 오류', () => { expect(() => decryptAsset(png, key)).toThrow('RPG Maker 암호화 파일이 아닙니다'); });
test('확장자', () => {
  expect(plainExtension('a.rpgmvp')).toBe('.png'); expect(plainExtension('a.png_')).toBe('.png'); expect(plainExtension('a.png')).toBeNull();
  expect(encryptedExtension('a.png', 'MV')).toBe('.rpgmvp'); expect(encryptedExtension('a.png', 'MZ')).toBe('.png_');
});
```

- [x] **Step 2: `npx vitest run tests/engine/crypto.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 에셋 복호화와 암호화"`**

### Task 3: 일본어 판별과 제어문자

**Files:**
- Create: `src/core/text/japanese.ts`, `src/core/text/controlCodes.ts`
- Test: `tests/text/text.test.ts`

**Interfaces:**
- Produces: `hasJapanese(s: string): boolean` — `/[぀-ヿ㐀-鿿ｦ-ﾟ]/`
- Produces: `controlCodes(s: string): string[]` — 나온 순서대로, 대문자로 통일한 토큰 목록

토큰 규칙: `\` + 영문자들 + 선택적 `[...]`(예 `\C[2]`, `\N[1]`, `\FS[20]`), `\` + 기호 하나(`{ } . | ! > < ^ $ \`), `%` + 숫자(`%1`). 영문자 부분은 대문자로 바꾼다(`\c[2]` 와 `\C[2]` 는 같다).

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('일본어 판별', () => {
  expect(hasJapanese('月光草')).toBe(true); expect(hasJapanese('あれ')).toBe(true); expect(hasJapanese('ｶﾀｶﾅ')).toBe(true);
  expect(hasJapanese('Lv')).toBe(false); expect(hasJapanese('월광초 4')).toBe(false); expect(hasJapanese('')).toBe(false);
});
test('제어문자 뽑기', () => {
  expect(controlCodes('月光草を\\C[4]3本\\c[0]、\\V[12]G\\!\\.%1')).toEqual(['\\C[4]', '\\C[0]', '\\V[12]', '\\!', '\\.', '%1']);
  expect(controlCodes('\\{大きく\\}\\\\')).toEqual(['\\{', '\\}', '\\\\']);
  expect(controlCodes('ふつうの文')).toEqual([]);
});
```

- [x] **Step 2: `npx vitest run tests/text/text.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 일본어 판별과 제어문자 추출"`**

### Task 4: 이벤트 커맨드 목록에서 추출

**Files:**
- Create: `src/core/extract/events.ts`
- Test: `tests/extract/events.test.ts`

**Interfaces:**
- Consumes: `hasJapanese`, 타입
- Produces: `interface RawUnit { kind: UnitKind; source: string; speaker?: string; needsDecision: boolean; ref: UnitRef }`
- Produces: `extractFromList(list: unknown, file: string, listPath: PathSeg[]): RawUnit[]`

커맨드별 규칙:

| code | 처리 |
|---|---|
| 101 | 바로 뒤의 연속된 401 들을 `'\n'` 으로 이어 `dialogue` 하나. `speaker` = `parameters[4]`(있고 비어있지 않을 때). ref `lines`, code 401 |
| 101 의 `parameters[4]` | 일본어가 있으면 별도 `db` 종류 값 하나(`path = [...listPath, i, 'parameters', 4]`). 화자 이름 번역용 |
| 105 | 바로 뒤의 연속된 405 들을 이어 `scroll` 하나. ref `lines`, code 405 |
| 102 | `parameters[0]` 의 각 글자마다 `choice`. ref `choice`. 402 는 추출하지 않는다 |
| 320, 324, 325 | `parameters[1]` → `name-change`, ref `value` |
| 356 | `parameters[0]` → `plugin-command`, needsDecision |
| 357 | `parameters[3]` 객체의 문자열 값마다 → `plugin-command`, needsDecision |
| 355 (+이어지는 655) | 각 줄 따로 → `script`, needsDecision |
| 108, 408 | `parameters[0]` → `comment`, needsDecision |

일본어가 없는 문자열은 내보내지 않는다. `list` 가 배열이 아니거나 항목이 `null` 이면 건너뛴다.

- [x] **Step 1: 실패하는 시험 쓰기** (`makeMiniGame` 의 Map001 목록을 `list` 로 쓴다)

```ts
const P = ['events', 1, 'pages', 0, 'list'];
test('대사 묶음과 화자', () => {
  const u = extractFromList(list, 'data/Map001.json', P);
  const d = u.filter(x => x.kind === 'dialogue');
  expect(d.map(x => x.source)).toEqual(['あれ？\\N[1]じゃない！\nこんな夜に来るなんて', 'やった！']);
  expect(d[0].speaker).toBe('リナ');
  expect(d[0].ref).toEqual({ type: 'lines', file: 'data/Map001.json', listPath: P, start: 1, count: 2, code: 401 });
  expect(d[1].ref).toMatchObject({ start: 6, count: 1 });
});
test('선택지는 102에서만', () => {
  const c = extractFromList(list, 'data/Map001.json', P).filter(x => x.kind === 'choice');
  expect(c.map(x => x.source)).toEqual(['いいよ', 'また今度']);
  expect(c[1].ref).toEqual({ type: 'choice', file: 'data/Map001.json', listPath: P, index: 3, choice: 1 });
});
test('플러그인 커맨드는 판단 필요', () => {
  const p = extractFromList(list, 'data/Map001.json', P).find(x => x.kind === 'plugin-command')!;
  expect(p.source).toBe('ShowRecord 記録'); expect(p.needsDecision).toBe(true);
});
test('화자 이름도 값으로 나온다', () => {
  const s = extractFromList(list, 'data/Map001.json', P).filter(x => x.kind === 'db' && x.source === 'リナ');
  expect(s).toHaveLength(2);
});
test('스크롤 문장', () => {
  const u = extractFromList(commonList, 'data/CommonEvents.json', [1, 'list']);
  expect(u).toEqual([expect.objectContaining({ kind: 'scroll', source: 'むかしむかし', ref: expect.objectContaining({ start: 1, count: 1, code: 405 }) })]);
});
test('null 과 배열 아닌 값에 죽지 않는다', () => {
  expect(extractFromList(null, 'f', [])).toEqual([]); expect(extractFromList([null, { code: 401 }], 'f', [])).toEqual([]);
});
```

- [x] **Step 2: `npx vitest run tests/extract/events.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 이벤트 커맨드 추출"`**

### Task 5: 데이터베이스와 맵에서 추출

**Files:**
- Create: `src/core/extract/database.ts`
- Test: `tests/extract/database.test.ts`

**Interfaces:**
- Consumes: `extractFromList`, `RawUnit`
- Produces: `extractFromDataFile(fileName: string, json: unknown): RawUnit[]` — `fileName` 은 `data/` 를 뺀 이름(`Actors.json`). ref 의 `file` 은 `data/<fileName>`

파일별 규칙 (모두 `ref.type = 'value'`, 일본어 있는 것만):

| 파일 | kind | 필드 |
|---|---|---|
| Actors | db | name, nickname, profile |
| Classes, Enemies | db | name |
| Skills | db | name, description, message1, message2 |
| Items, Weapons, Armors | db | name, description |
| States | db | name, message1, message2, message3, message4 |
| System | system | gameTitle, currencyUnit, terms.basic[], terms.commands[], terms.params[], terms.messages.*, elements[], skillTypes[], weaponTypes[], armorTypes[], equipTypes[] |
| Map###.json | map-name | displayName. 그리고 `events[i].pages[j].list` 마다 `extractFromList(list, file, ['events', i, 'pages', j, 'list'])` |
| CommonEvents | — | `[i].list` → `extractFromList(…, [i, 'list'])` |
| Troops | — | `[i].pages[j].list` → `extractFromList(…, [i, 'pages', j, 'list'])` |
| 그 외(MapInfos, Tilesets, Animations 등) | — | 빈 배열 |

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('액터', () => {
  const u = extractFromDataFile('Actors.json', actors);
  expect(u.map(x => [x.source, x.ref])).toEqual([
    ['リナ', { type: 'value', file: 'data/Actors.json', path: [1, 'name'] }],
    ['薬草園の見習い', { type: 'value', file: 'data/Actors.json', path: [1, 'profile'] }]]);
});
test('시스템 용어: 일본어만, null 건너뜀', () => {
  const s = extractFromDataFile('System.json', system).map(x => x.source);
  expect(s).toEqual(expect.arrayContaining(['霧の薬草園', 'ゴールド', 'レベル', 'たたかう', '最大HP', '常時ダッシュ', '物理', '魔法', '武器']));
  expect(s).not.toContain('Lv'); expect(s).not.toContain('');
});
test('맵: 표시 이름과 이벤트', () => {
  const u = extractFromDataFile('Map001.json', map);
  expect(u.find(x => x.kind === 'map-name')!.source).toBe('薬草園');
  expect(u.filter(x => x.kind === 'dialogue')).toHaveLength(2);
});
test('null 항목과 모르는 파일', () => {
  expect(extractFromDataFile('Classes.json', [null])).toEqual([]);
  expect(extractFromDataFile('Tilesets.json', [null, { name: 'タイル' }])).toEqual([]);
  expect(extractFromDataFile('Map002.json', { displayName: '', events: [null, null] })).toEqual([]);
});
```

- [x] **Step 2: `npx vitest run tests/extract/database.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 데이터베이스와 맵 추출"`**

### Task 6: plugins.js 읽기, 추출, 다시 쓰기

**Files:**
- Create: `src/core/extract/plugins.ts`
- Test: `tests/extract/plugins.test.ts`

**Interfaces:**
- Produces: `parsePluginsFile(text: string): { prefix: string; plugins: unknown[]; suffix: string }` — `prefix` 는 첫 `[` 앞까지, `suffix` 는 마지막 `]` 뒤. 못 읽으면 `Error('plugins.js 를 읽을 수 없습니다')`
- Produces: `serializePluginsFile(p: { prefix: string; plugins: unknown[]; suffix: string }): string` — `prefix + JSON.stringify(plugins) + suffix`
- Produces: `extractFromPlugins(plugins: unknown[]): RawUnit[]` — kind `plugin-param`, needsDecision true, `file: 'js/plugins.js'`
- Produces: `getAtPath(root: unknown, path: PathSeg[]): unknown`, `setAtPath(root: unknown, path: PathSeg[], value: unknown): void`

겹친 JSON: 값이 문자열이고 `[`, `{`, `"` 로 시작하며 `JSON.parse` 가 성공하고 결과가 객체, 배열, 문자열이면 한 단계 들어간다. 그 자리의 경로 조각은 `{ key, json: true }`. `setAtPath` 는 `json: true` 조각을 만나면 그 값을 파싱해 안쪽을 바꾼 뒤 `JSON.stringify` 로 다시 감싼다. `status: false` 인 플러그인도 추출한다.

- [x] **Step 1: 실패하는 시험 쓰기** (`text` 는 `makeMiniGame` 의 plugins.js 글자)

```ts
test('읽고 그대로 쓰면 원본과 같다', () => { expect(serializePluginsFile(parsePluginsFile(text))).toBe(text); });
test('설정값과 겹친 JSON 안쪽을 뽑는다', () => {
  const u = extractFromPlugins(parsePluginsFile(text).plugins);
  expect(u.map(x => x.source)).toEqual(['記録', '物語']);
  expect(u[0].ref).toEqual({ type: 'value', file: 'js/plugins.js', path: [0, 'parameters', 'title'] });
  expect(u[1].ref).toEqual({ type: 'value', file: 'js/plugins.js',
    path: [0, 'parameters', { key: 'list', json: true }, { key: 0, json: true }, 'label'] });
  expect(u.every(x => x.needsDecision)).toBe(true);
});
test('겹친 자리에 쓰면 다시 감싼다', () => {
  const p = parsePluginsFile(text); const u = extractFromPlugins(p.plugins);
  setAtPath(p.plugins, (u[1].ref as any).path, '이야기');
  expect(getAtPath(p.plugins, (u[1].ref as any).path)).toBe('이야기');
  expect(serializePluginsFile(p)).toBe(text.replace('物語', '이야기'));
});
test('못 읽는 파일', () => { expect(() => parsePluginsFile('hello')).toThrow('plugins.js 를 읽을 수 없습니다'); });
```

- [x] **Step 2: `npx vitest run tests/extract/plugins.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 플러그인 설정 추출과 다시 쓰기"`**

### Task 7: 프로젝트 만들기와 전체 추출

**Files:**
- Create: `src/core/project/project.ts`, `src/core/extract/index.ts`
- Test: `tests/project/project.test.ts`

**Interfaces:**
- Consumes: `detectGame`, `extractFromDataFile`, `parsePluginsFile`, `extractFromPlugins`
- Produces: `interface ProjectMeta { name: string; engine: Engine; gameDir: string; contentPrefix: string; sourceLang: 'ja'; targetLang: 'ko'; versions: { id: string; importedAt: string }[]; current: string }`
- Produces: `createProject(gameDir: string, projectDir: string, name: string): Promise<ProjectMeta>` — `projectDir` 이 비어있지 않으면 `Error('프로젝트 폴더가 비어있지 않습니다')`. `data/*.json`, `js/plugins.js`, `js/plugins/*.js` 를 `original/v1/` 아래 같은 구조로 복사. `project.json` 쓰기
- Produces: `openProject(projectDir: string): Promise<ProjectMeta>`
- Produces: `originalDir(projectDir: string, meta: ProjectMeta): string` → `<projectDir>/original/<current>`
- Produces: `mergeUnits(raw: RawUnit[]): TextUnit[]` — 같은 `kind + speaker + source` 를 하나로 합치고 refs 를 모은다. 처음 나온 순서 유지. needsDecision 은 하나라도 true 면 true
- Produces: `extractAll(projectDir: string): Promise<{ units: TextUnit[]; warnings: Warning[] }>` — `original/<current>` 를 읽고 `units.json` 을 쓴다
- Produces: `readJsonFile(path: string): Promise<unknown>` — 맨 앞 BOM(`﻿`)을 떼고 파싱

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
test('프로젝트를 만들고 원본을 복사한다', async () => {
  await makeMiniGame(game); const m = await createProject(game, proj, '약초원');
  expect(m).toMatchObject({ name: '약초원', engine: 'MZ', current: 'v1', contentPrefix: '' });
  expect(existsSync(path.join(proj, 'original/v1/data/Map001.json'))).toBe(true);
  expect(existsSync(path.join(proj, 'original/v1/js/plugins.js'))).toBe(true);
  expect(await openProject(proj)).toEqual(m);
});
test('비어있지 않은 폴더에는 만들지 않는다', async () => {
  await writeFile(path.join(proj, 'x.txt'), ''); await expect(createProject(game, proj, 'a')).rejects.toThrow('프로젝트 폴더가 비어있지 않습니다');
});
test('전체 추출: 합치기와 저장', async () => {
  const { units, warnings } = await extractAll(proj);
  expect(warnings).toEqual([]);
  const rina = units.filter(u => u.source === 'リナ' && u.kind === 'db');
  expect(rina).toHaveLength(1); expect(rina[0].refs).toHaveLength(3); // 액터 1 + 화자 2
  expect(units.find(u => u.source === '記録')!.needsDecision).toBe(true);
  expect(new Set(units.map(u => u.id)).size).toBe(units.length);
  expect(JSON.parse(await readFile(path.join(proj, 'units.json'), 'utf8'))).toEqual(units);
});
test('BOM 붙은 파일은 읽고, 깨진 파일은 경고만', async () => {
  await writeFile(path.join(proj, 'original/v1/data/Items.json'), '﻿' + itemsJson);
  await writeFile(path.join(proj, 'original/v1/data/Skills.json'), '{깨짐');
  const { units, warnings } = await extractAll(proj);
  expect(units.some(u => u.source === '月光草')).toBe(true);
  expect(warnings).toEqual([{ file: 'data/Skills.json', message: expect.stringContaining('읽을 수 없') }]);
});
test('원본 게임 폴더는 바뀌지 않는다', async () => { expect(await hashDir(game)).toBe(gameHashBefore); });
```

- [ ] **Step 2: `npx vitest run tests/project/project.test.ts` → FAIL**
- [ ] **Step 3: 구현** — id 는 `node:crypto` sha1
- [ ] **Step 4: PASS**
- [ ] **Step 5: `git commit -m "feat: 프로젝트 생성과 전체 추출"`**

### Task 8: 번역표

**Files:**
- Create: `src/core/store/translations.ts`
- Test: `tests/store/translations.test.ts`

**Interfaces:**
- Produces: `class TranslationStore` — `static load(projectDir): Promise<TranslationStore>`(파일이 없으면 빈 표), `get(id): TranslationEntry`(없으면 `{ target: null, status: 'untranslated', updatedAt: '' }`), `set(id, target: string, status?: TranslationStatus): void`(기본 `'needs-review'`), `setStatus(id, status): void`, `entries(): Record<string, TranslationEntry>`, `save(): Promise<void>` → `<projectDir>/translations.json`
- Produces: `exportUntranslated(units: TextUnit[], store: TranslationStore, opts?: { includeNeedsDecision?: boolean }): { id: string; kind: UnitKind; speaker?: string; source: string }[]` — target 이 null 인 것만. needsDecision 항목은 기본 제외
- Produces: `importTranslations(units: TextUnit[], store: TranslationStore, items: { id: string; target: string }[]): { applied: number; unknownIds: string[] }` — units 에 없는 id 는 넣지 않고 `unknownIds` 로 돌려준다

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
test('기본값, 저장, 다시 읽기', async () => {
  const s = await TranslationStore.load(proj);
  expect(s.get('x')).toEqual({ target: null, status: 'untranslated', updatedAt: '' });
  s.set('a1', '월광초'); expect(s.get('a1').status).toBe('needs-review');
  s.setStatus('a1', 'approved'); await s.save();
  expect((await TranslationStore.load(proj)).get('a1')).toMatchObject({ target: '월광초', status: 'approved' });
});
test('미번역 내보내기는 판단 필요 항목을 뺀다', () => {
  const out = exportUntranslated(units, store);
  expect(out.some(o => o.source === '記録')).toBe(false);
  expect(out.find(o => o.source.startsWith('あれ？'))).toMatchObject({ kind: 'dialogue', speaker: 'リナ' });
  expect(exportUntranslated(units, store, { includeNeedsDecision: true }).some(o => o.source === '記録')).toBe(true);
});
test('가져오기: 모르는 id 는 돌려준다', () => {
  const r = importTranslations(units, store, [{ id: units[0].id, target: '가' }, { id: 'nope', target: '나' }]);
  expect(r).toEqual({ applied: 1, unknownIds: ['nope'] }); expect(store.get('nope').target).toBeNull();
});
```

- [ ] **Step 2: `npx vitest run tests/store/translations.test.ts` → FAIL**
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS**
- [ ] **Step 5: `git commit -m "feat: 번역표와 내보내기/가져오기"`**

### Task 9: 형식 검사

**Files:**
- Create: `src/core/check/format.ts`
- Test: `tests/check/format.test.ts`

**Interfaces:**
- Consumes: `controlCodes`, `hasJapanese`
- Produces: `interface FormatRules { controlCodes: boolean; noLeftoverJapanese: boolean; sameLineCount: boolean; maxLines: number | null }`, `DEFAULT_RULES = { controlCodes: true, noLeftoverJapanese: true, sameLineCount: false, maxLines: 4 }`
- Produces: `checkTranslation(unit: TextUnit, target: string, rules?: FormatRules): Issue[]`
- Produces: `checkAll(units: TextUnit[], store: TranslationStore, rules?: FormatRules): { id: string; issues: Issue[] }[]` — 문제 있는 항목만. `error` 가 있으면 그 항목의 status 를 `'error'` 로 바꾼다

규칙: 빈 번역(공백만) → `empty` error. 제어문자를 정렬해 비교해서 다르면 `control-codes` error, 메시지에 빠진 것과 더해진 것을 적는다. 번역에 일본어 글자가 남으면 `leftover-japanese` error. `sameLineCount` 가 켜져 있고 줄 수가 다르면 `line-count` error. `maxLines` 는 `dialogue` 에만 적용하고 넘으면 `line-count` warning. 픽셀 폭 검사는 계획 4.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
const u = (source: string, kind: UnitKind = 'dialogue'): TextUnit => ({ id: 'i', kind, source, needsDecision: false, refs: [] });
test('통과', () => { expect(checkTranslation(u('月光草を\\C[4]3本\\C[0]'), '월광초를 \\C[4]3개\\C[0]')).toEqual([]); });
test('제어문자 누락과 순서 무관', () => {
  expect(checkTranslation(u('\\C[2]マナ\\C[0]'), '마나')[0]).toMatchObject({ rule: 'control-codes', severity: 'error' });
  expect(checkTranslation(u('\\V[1]と\\N[2]'), '\\N[2]와 \\V[1]')).toEqual([]);
});
test('남은 일본어', () => { expect(checkTranslation(u('やった'), '해냈다！やった')[0].rule).toBe('leftover-japanese'); });
test('빈 번역', () => { expect(checkTranslation(u('やった'), '  ')[0].rule).toBe('empty'); });
test('줄 수', () => {
  expect(checkTranslation(u('あ\nい'), '가\n나\n다')).toEqual([]);
  expect(checkTranslation(u('あ\nい'), '가\n나\n다', { ...DEFAULT_RULES, sameLineCount: true })[0]).toMatchObject({ rule: 'line-count', severity: 'error' });
  expect(checkTranslation(u('あ'), '1\n2\n3\n4\n5')[0]).toMatchObject({ rule: 'line-count', severity: 'warning' });
  expect(checkTranslation(u('あ', 'db'), '1\n2\n3\n4\n5')).toEqual([]);
});
```

- [ ] **Step 2: `npx vitest run tests/check/format.test.ts` → FAIL**
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS**
- [ ] **Step 5: `git commit -m "feat: 형식 검사"`**

### Task 10: 번역 적용

**Files:**
- Create: `src/core/build/apply.ts`
- Test: `tests/build/apply.test.ts`

**Interfaces:**
- Consumes: `originalDir`, `readJsonFile`, `parsePluginsFile`, `serializePluginsFile`, `getAtPath`, `setAtPath`, `TranslationStore`
- Produces: `applyTranslations(projectDir: string, units: TextUnit[], store: TranslationStore): Promise<Map<string, string>>` — 키는 `file`(contentDir 기준), 값은 새 파일 글자. 번역이 하나도 적용되지 않은 파일은 들어가지 않는다

적용 규칙:
- target 이 null 이거나 status 가 `'error'` 인 항목은 건너뛴다. needsDecision 항목은 status 가 `'approved'` 일 때만 적용한다.
- `value`: `setAtPath`.
- `choice`: `102` 의 `parameters[0][choice]` 를 바꾸고, 같은 목록에서 그 `102` 뒤에 오는 같은 `indent` 의 `402` 중 `parameters[0] === choice` 인 첫 번째의 `parameters[1]` 도 같은 글자로 바꾼다. 다음 `404`(같은 indent)를 만나면 찾기를 멈춘다.
- `lines`: `start` 부터 `count` 개의 커맨드를 번역의 줄 수만큼의 커맨드로 바꾼다. 새 커맨드는 `{ code, indent: 원래 첫 줄의 indent, parameters: [줄] }`. 한 목록 안의 `lines` 와 `choice` 는 `start`/`index` 가 큰 것부터 처리해서 앞쪽 번호가 밀리지 않게 한다.
- 데이터 파일은 `JSON.stringify(json)`(한 줄), `js/plugins.js` 는 `serializePluginsFile`.

- [ ] **Step 1: 실패하는 시험 쓰기** (`tr(source, target, status?)` 는 source 로 unit 을 찾아 `store.set` 하는 시험 도우미)

```ts
test('번역 없으면 빈 결과', async () => { expect((await applyTranslations(proj, units, store)).size).toBe(0); });
test('줄 수가 늘어도 뒤쪽이 제자리에 들어간다', async () => {
  tr('あれ？\\N[1]じゃない！\nこんな夜に来るなんて', '어라?\n\\N[1] 아니야!\n이런 밤에 오다니');
  tr('やった！', '해냈다!'); tr('いいよ', '좋아'); tr('また今度', '다음에');
  const list = JSON.parse((await applyTranslations(proj, units, store)).get('data/Map001.json')!).events[1].pages[0].list;
  expect(list.map((c: any) => c.code)).toEqual([101, 401, 401, 401, 102, 402, 101, 401, 0, 402, 0, 404, 356, 0]);
  expect(list.slice(1, 4).map((c: any) => c.parameters[0])).toEqual(['어라?', '\\N[1] 아니야!', '이런 밤에 오다니']);
  expect(list[4].parameters[0]).toEqual(['좋아', '다음에']);
  expect(list[5].parameters).toEqual([0, '좋아']); expect(list[9].parameters).toEqual([1, '다음에']);
  expect(list[7]).toEqual({ code: 401, indent: 1, parameters: ['해냈다!'] });
});
test('같은 원문은 모든 자리에 들어간다', async () => {
  tr('リナ', '리나'); const out = await applyTranslations(proj, units, store);
  expect(JSON.parse(out.get('data/Actors.json')!)[1].name).toBe('리나');
  expect(JSON.parse(out.get('data/Map001.json')!).events[1].pages[0].list[0].parameters[4]).toBe('리나');
});
test('판단 필요 항목은 승인돼야 들어간다', async () => {
  tr('物語', '이야기'); expect((await applyTranslations(proj, units, store)).has('js/plugins.js')).toBe(false);
  tr('物語', '이야기', 'approved');
  expect((await applyTranslations(proj, units, store)).get('js/plugins.js')).toBe(pluginsText.replace('物語', '이야기'));
});
test('오류 상태는 건너뛴다', async () => {
  tr('月光草', '월광초', 'error'); expect((await applyTranslations(proj, units, store)).has('data/Items.json')).toBe(false);
});
test('원본 사본은 바뀌지 않는다', async () => { expect(await hashDir(path.join(proj, 'original'))).toBe(before); });
```

- [ ] **Step 2: `npx vitest run tests/build/apply.test.ts` → FAIL**
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS**
- [ ] **Step 5: `git commit -m "feat: 번역 적용"`**

### Task 11: 패치 zip 만들기

**Files:**
- Create: `src/core/build/patch.ts`
- Test: `tests/build/patch.test.ts`

**Interfaces:**
- Consumes: `applyTranslations`, `checkAll`, `openProject`
- Produces: `interface BuildResult { number: number; zipPath: string; files: { path: string; sha1: string }[]; skippedErrors: number }`
- Produces: `buildPatch(projectDir: string, units: TextUnit[], store: TranslationStore): Promise<BuildResult>`

동작: 먼저 `checkAll` 을 돌려 error 항목을 표시하고 그 수를 `skippedErrors` 로 돌려준다. 빌드 번호는 `<projectDir>/builds/` 안의 가장 큰 번호 + 1(없으면 1), 폴더 이름은 3자리(`001`). 파일을 `builds/001/patch/<contentPrefix><file>` 에 쓰고, `builds/001/manifest.json`(`{ number, createdAt, version, files }`)을 쓰고, `builds/001/<프로젝트 이름>_patch_001.zip` 을 만든다. zip 안 경로는 `<contentPrefix><file>`. 만든 뒤 검증: zip 을 다시 읽어 manifest 의 모든 경로가 있고 sha1 이 같으며 `.json` 파일은 `JSON.parse` 가 되는지 확인한다. 하나라도 어긋나면 `Error('패치 검증 실패: <경로>')`. 바뀐 파일이 없으면 `Error('바뀐 파일이 없습니다')`.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
test('바뀐 파일만 묶는다', async () => {
  tr('月光草', '월광초'); const r = await buildPatch(proj, units, store);
  expect(r.number).toBe(1); expect(r.files.map(f => f.path)).toEqual(['data/Items.json']);
  expect(Object.keys(unzipSync(await readFile(r.zipPath)))).toEqual(['data/Items.json']);
  expect(path.basename(r.zipPath)).toBe('약초원_patch_001.zip');
});
test('번호가 올라간다', async () => { expect((await buildPatch(proj, units, store)).number).toBe(2); });
test('MV www 는 경로 앞에 www/', async () => {
  tr2('月光草', '월광초'); expect((await buildPatch(projMv, unitsMv, storeMv)).files[0].path).toBe('www/data/Items.json');
});
test('오류 항목은 빼고 센다', async () => {
  tr('やった！', 'やった!'); const r = await buildPatch(proj, units, store);
  expect(r.skippedErrors).toBe(1); expect(r.files.map(f => f.path)).toEqual(['data/Items.json']);
});
test('바뀐 게 없으면 오류', async () => { await expect(buildPatch(emptyProj, emptyUnits, emptyStore)).rejects.toThrow('바뀐 파일이 없습니다'); });
```

- [ ] **Step 2: `npx vitest run tests/build/patch.test.ts` → FAIL**
- [ ] **Step 3: 구현** — zip 은 `fflate` 의 `zipSync`/`unzipSync`
- [ ] **Step 4: PASS**
- [ ] **Step 5: `git commit -m "feat: 패치 zip 빌드와 검증"`**

### Task 12: 명령줄과 처음부터 끝까지 시험

**Files:**
- Create: `src/cli.ts`, `README.md`
- Modify: `src/core/index.ts` (전부 다시 내보내기)
- Test: `tests/cli.e2e.test.ts`

**Interfaces:**
- Consumes: 앞 작업의 공개 함수 전부
- Produces: `run(argv: string[]): Promise<number>` (종료 코드. 시험이 직접 부른다) 와 명령:

| 명령 | 동작 | 출력 |
|---|---|---|
| `mvmz import <gameDir> <projectDir> --name <이름>` | `createProject` + `extractAll` | 엔진, 항목 수, 판단 필요 수, 경고 |
| `mvmz export <projectDir> --out <file> [--all]` | `exportUntranslated` 를 JSON 배열로 저장 | 내보낸 수 |
| `mvmz apply <projectDir> <file>` | `[{id,target}]` 를 읽어 `importTranslations`, 저장 | 적용 수, 모르는 id |
| `mvmz check <projectDir>` | `checkAll`, 저장 | 문제 목록. error 가 있으면 종료 코드 1 |
| `mvmz build <projectDir>` | `buildPatch` | zip 경로, 파일 목록, 건너뛴 오류 수 |
| `mvmz status <projectDir>` | 상태별 개수 | 전체, 미번역, 검토 필요, 승인, 오류 |

모르는 명령이나 인자 부족은 사용법을 찍고 종료 코드 2. 오류는 메시지 한 줄과 종료 코드 1(스택은 찍지 않는다).

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
test('가져오기부터 패치까지', async () => {
  await makeMiniGame(game);
  expect(await run(['import', game, proj, '--name', '약초원'])).toBe(0);
  expect(await run(['export', proj, '--out', outFile])).toBe(0);
  const items = JSON.parse(await readFile(outFile, 'utf8'));
  expect(items.some((i: any) => i.source === '記録')).toBe(false);
  const ko: Record<string, string> = { '月光草': '월광초', 'リナ': '리나', 'いいよ': '좋아', 'また今度': '다음에' };
  await writeFile(inFile, JSON.stringify(items.filter((i: any) => ko[i.source]).map((i: any) => ({ id: i.id, target: ko[i.source] }))));
  expect(await run(['apply', proj, inFile])).toBe(0);
  expect(await run(['check', proj])).toBe(0);
  expect(await run(['build', proj])).toBe(0);
  const zip = unzipSync(await readFile(path.join(proj, 'builds/001/약초원_patch_001.zip')));
  expect(Object.keys(zip).sort()).toEqual(['data/Actors.json', 'data/Items.json', 'data/Map001.json']);
  expect(await hashDir(game)).toBe(gameHashBefore);
});
test('검사 오류는 종료 코드 1', async () => {
  await writeFile(inFile, JSON.stringify([{ id: idOf('やった！'), target: 'やった' }]));
  await run(['apply', proj, inFile]); expect(await run(['check', proj])).toBe(1);
});
test('MV/MZ가 아닌 폴더', async () => { expect(await run(['import', emptyDir, proj2, '--name', 'x'])).toBe(1); });
test('인자 부족', async () => { expect(await run(['build'])).toBe(2); });
```

- [ ] **Step 2: `npx vitest run tests/cli.e2e.test.ts` → FAIL**
- [ ] **Step 3: 구현** — `commander`, `exitOverride` 로 종료 코드를 돌려받는다. `README.md` 에 위 명령 표와 프로젝트 폴더 구조를 적는다
- [ ] **Step 4: `npx vitest run` (전체) → 모두 PASS, `npx tsc --noEmit` → 오류 없음**
- [ ] **Step 5: `git commit -m "feat: 명령줄과 전체 흐름 시험"`**

---

## 이 계획이 끝난 뒤 사람이 확인할 것

시험용 작은 게임으로는 실제 게임의 다양한 플러그인을 다 확인할 수 없다. 계획 2로 넘어가기 전에 실제 MV 게임 하나와 MZ 게임 하나로 `import` → `status` 를 돌려서 항목 수와 경고 목록을 본다. 여기서 나온 빠진 유형은 계획 3의 추출 보강 목록에 넣는다.
