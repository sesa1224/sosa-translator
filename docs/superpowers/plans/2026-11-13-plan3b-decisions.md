# MV/MZ 번역 작업실 · 계획 3b: 판단 필요 항목 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플러그인 커맨드, 스크립트, 플러그인 설정, 메모란, 플러그인 JS 파일에 섞여 있는 "화면에 보이는 글자"만 골라 번역하고, 코드가 읽는 값은 건드리지 않게 한다. 같은 종류는 한 번만 판단하면 나머지에 자동 적용된다. 게임 제목 칸과 외부 번역용 내보내기·가져오기도 넣는다.

**Architecture:** 판단 필요 항목을 "판단 키"로 묶는다(커맨드 이름, 스크립트의 모양, 플러그인 인자 이름 등). 키마다 결정(번역함/안 함, 그리고 그대로 둘 부분)을 `decisions.json` 에 둔다. 번역하기로 한 항목은 일반 번역 흐름(계획 3의 묶음 번역)에 들어가되, "뼈대 검사"가 그대로 둘 부분이 한 글자도 바뀌지 않았는지 확인한다. 추출과 검사는 `src/core`, 추천 받기는 `runClaudeJson`.

**Tech Stack:** 계획 3과 같다. 새 런타임 의존성 없음.

**Spec:** `docs/2026-11-13-mvmz-번역작업실-기획서.md` (4.2, 4.12, 9장).

## 병렬 작업 규칙 (중요)

이 계획은 계획 4(미리보기)와 **동시에, 서로 다른 작업 폴더에서** 구현된다. 나중에 합치기 쉽게:
- 이 계획이 주로 고치는 곳: `src/core/extract/*`, `src/core/decisions/*`(새로), `src/core/build/*`, `src/core/exchange/*`(새로), `src/main/translate/decide.ts`(새로), `src/renderer/components/DecisionView.tsx`·`TitleField.tsx`·`ExchangeDialog.tsx`(새로).
- 여러 계획이 같이 쓰는 파일(`src/shared/api.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/projectService.ts`, `src/renderer/state.ts`, `Sidebar.tsx`, `App.tsx`, `TextTable.tsx`, `ItemPanel.tsx`, `SettingsView.tsx`, `src/main/settings.ts`)은 **추가만** 한다. 기존 줄을 옮기거나 이름을 바꾸거나 정리하지 않는다. 새 항목은 그 파일의 관련 목록 **맨 끝**에 붙인다.
- 계획 4의 영역(`src/core/preview/*`, `src/main/fonts/*`, `GamePreview.tsx`, `FontPicker.tsx`, `StoryView.tsx`)은 건드리지 않는다.
- 포매터나 정렬 도구를 저장소 전체에 돌리지 않는다.

## Global Constraints

- 계획 1~3의 공개 이름은 바꾸지 않고 추가만 한다. 기존 시험은 계속 통과해야 한다. 종류나 도구를 전부 나열한 기존 단언은 늘어난 만큼 고쳐도 된다.
- 원본 게임 폴더에는 쓰지 않는다. 읽기는 가져오기와 "빠진 원본 파일 채우기"(아래 작업 1) 때만 한다.
- 결정이 없는 판단 필요 항목은 지금처럼 번역 대상에서 빠지고 패치에도 들어가지 않는다.
- 뼈대 검사에 실패한 번역은 `error` 상태가 되고 패치에 들어가지 않는다.
- 플러그인 JS 파일을 고칠 때는 문자열 따옴표 안쪽만 바꾼다. 파일의 나머지는 바이트 단위로 같아야 한다.
- 실제 CLI 시험은 `MVMZ_REAL_CLI=1` 일 때만, 모델 `claude-haiku-5-5`, 시험용 작은 게임만. 사용자의 실제 게임 폴더는 읽지 않는다.
- 시스템에 프로그램 설치가 필요하거나 버전이 맞지 않으면 우회하지 말고 멈춰서 보고한다.
- 커밋은 작업마다 한 번, 이 작업 폴더의 브랜치에.

## Review Focus

1. **번역문에 정규식 특수문자나 `$` 가 있을 때**: 뼈대 검사와 다시 끼워 넣기가 번역문을 글자 그대로 다룬다(`$1`, `\`, `(` 가 들어가도 깨지지 않는다). → 작업 2, 6
2. **같은 커맨드 이름인데 인자 개수가 다를 때**: `D_TEXT 筋力 32` 와 `D_TEXT 筋力` 이 섞여 있어도, "마지막 인자 1개는 그대로" 규칙이 인자가 하나뿐인 쪽을 통째로 지우지 않는다(번역할 부분이 비면 그 항목은 결정 적용에서 빼고 `needsDecision` 으로 남긴다). → 작업 2
3. **플러그인 JS 파일이 추출 뒤에 달라졌을 때**: 기록한 위치의 글자가 원문과 다르면 그 파일은 적용하지 않고 경고를 낸다(엉뚱한 자리를 덮어쓰지 않는다). → 작업 6
4. **결정을 "번역함"에서 "안 함"으로 되돌릴 때**: 이미 들어간 번역은 번역표에 남지만 패치에는 들어가지 않고, 표에서 "번역 안 함"으로 보인다. 다시 "번역함"으로 바꾸면 번역이 살아난다. → 작업 3
5. **가져온 외부 번역의 id 가 프로젝트에 없거나 번역이 이미 있을 때**: 없는 id 는 건너뛰고 목록으로 알려주며, 이미 번역이 있고 내용이 다르면 사용자가 고르기 전에는 덮어쓰지 않는다. → 작업 8

---

## 공용 타입 (작업 1에서 만든다)

```ts
// src/core/types.ts 에 추가
// UnitKind 에 'note' | 'plugin-js' 추가
// UnitRef 에 추가:
//   | { type: 'note'; file: string; path: PathSeg[]; tag: string; index: number }   // note 글 안의 index 번째 <tag:값> 의 값
//   | { type: 'js'; file: string; start: number; end: number; quote: '"' | "'" | '`' } // 따옴표 안쪽의 글자 위치(UTF-16 단위)
// TextUnit 에 선택 필드: decisionKey?: string
// Issue.rule 에 'skeleton' 추가

// src/core/decisions/types.ts
export type KeepRule =
  | { mode: 'whole' }                                   // 값 전체가 표시 글자
  | { mode: 'args'; from: number; dropLast: number }    // MV 커맨드: 공백으로 나눈 조각 중 [from, 끝 - dropLast) 만 번역
  | { mode: 'spans' };                                  // 일본어가 든 구간만 번역, 나머지는 그대로
export interface Decision { translate: boolean; keep: KeepRule; status: 'suggested' | 'confirmed'; reason?: string; by: 'user' | 'claude' | 'meta' }
export interface DecisionGroup {
  key: string; label: string; kind: UnitKind; count: number;
  samples: string[];                 // 서로 다른 원문 5개까지
  hints: { fileNames: number; metaType?: string; metaText?: string; metaDesc?: string };  // fileNames = 표본 중 게임 파일 이름과 같은 값의 수
  decision: Decision | null;
}
export type Decisions = Record<string, Decision>;   // 키는 판단 키 또는 'unit:<id>'(개별 항목. 묶음 결정보다 우선)
```

판단 키:

| 종류 | 키 | 라벨 예 |
|---|---|---|
| MV 플러그인 커맨드(356) | `mv:<첫 조각>` | `addLog` |
| MZ 플러그인 커맨드(357)의 인자 값 | `mz:<플러그인>:<커맨드>:<인자 이름>` | `DestinationWindow · SET_DESTINATION · destination` |
| 플러그인 설정값 | `param:<플러그인>:<경로>`(배열 번호는 `*`) | `Menu · list[*].label` |
| 스크립트(355/655), 주석(108/408) | `shape:<모양>` — 일본어 구간을 `◆`, 숫자 연속을 `#` 로 바꾼 글 | `"1_t=#_subject=◆\\V[#]"])` |
| 메모란 태그 | `note:<파일 종류>:<태그 이름>` | `Skills · SG説明` |
| 플러그인 JS 문자열 | `js:<파일 이름>`(묶음) 과 `unit:<id>`(개별) | `Chronus.js` |

---

### Task 1: 원본 파일 목록과 빠진 파일 채우기, 타입 추가

**Files:** Create `src/core/project/originals.ts` · Modify `src/core/types.ts`, `src/core/project/project.ts`, `src/core/index.ts` · Test `tests/project/originals.test.ts`

**Interfaces:**
- Produces: `listGameFiles(contentDir): Promise<string[]>` — `img/`, `audio/`, `movies/` 아래 모든 파일의 상대 경로(`/` 구분)
- Produces: `ensureOriginals(projectDir): Promise<{ added: string[]; missingGameDir: boolean }>` — `original/<current>/` 에 `files.json`(위 목록), `index.html`, `package.json`(최상위 폴더 것. 파일 이름은 `package.top.json`)이 없으면 `meta.gameDir` 에서 읽어 채운다. 게임 폴더가 없으면 `missingGameDir: true` 를 돌려주고 나머지 기능은 그 파일 없이 동작한다
- `createProject` 는 처음부터 이 파일들을 넣는다

**시험이 확인할 것:**
- 새 프로젝트에 `files.json`, `index.html`, `package.top.json` 이 있다. `files.json` 에 `img/pictures/a.png` 같은 경로가 들어 있다(시험용 게임에 빈 파일 몇 개를 만들어 확인)
- 그 파일들을 지운 뒤 `ensureOriginals` 를 부르면 다시 생기고 `added` 에 이름이 온다
- `meta.gameDir` 가 없는 경로면 `missingGameDir: true` 이고 예외가 나지 않는다
- 원본 게임 폴더의 해시가 바뀌지 않는다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 원본 파일 목록과 보조 파일 보관"`

### Task 2: 판단 키, 묶기, 그대로 둘 부분, 뼈대 검사

**Files:** Create `src/core/decisions/types.ts`, `keys.ts`, `skeleton.ts`, `store.ts` · Modify `src/core/extract/events.ts`·`plugins.ts`(각 `RawUnit` 에 `decisionKey` 를 채운다), `src/core/extract/index.ts`, `src/core/check/format.ts` · Test `tests/decisions/keys.test.ts`, `tests/decisions/skeleton.test.ts`

**Interfaces:**
- Produces: `shapeOf(text: string): string`, `japaneseSpans(text: string): { start: number; end: number }[]` — 일본어 글자가 하나라도 든 구간. 구간은 ASCII 문법 글자(`" ' \` = : , ; ( ) [ ] { } < > + |` 와 공백 2칸 이상)에서 끊기고, 제어문자(`\V[1]`, 겹친 이스케이프 `\\V[1]` 포함)는 구간에 넣지 않는다. 구간 안의 일본어 문장부호와 전각 기호는 포함
- Produces: `keepPieces(source: string, keep: KeepRule): string[] | null` — 번역하지 않고 그대로 둘 글 조각들을 순서대로. 조각이 n+1개면 번역 구간이 n개. `whole` → `['', '']`. `args` → 앞쪽 조각들(뒤 공백 포함)과 뒤쪽 조각들(앞 공백 포함). 번역할 부분이 비면 null. `spans` → 구간 사이의 글들. 구간이 없으면 null
- Produces: `checkSkeleton(source: string, target: string, keep: KeepRule): Issue[]` — target 이 `조각0 + (한 글자 이상) + 조각1 + … + 조각n` 꼴이 아니면 `{ rule: 'skeleton', severity: 'error', message: '그대로 둬야 하는 부분이 바뀌었습니다: "<첫 번째로 어긋난 조각>"' }`. 비교는 글자 그대로(정규식으로 만들 때 조각을 이스케이프한다)
- Produces: `loadDecisions(projectDir)`, `saveDecisions(projectDir, d)` → `decisions.json`. `decisionFor(unit: TextUnit, d: Decisions): Decision | null`(`unit:<id>` 가 있으면 그것, 없으면 `unit.decisionKey` 의 것). `isTranslatable(unit, d): boolean` — `needsDecision` 이 아니거나, 결정이 `translate: true` 이고 `keepPieces` 가 null 이 아닐 때
- Produces: `groupDecisions(units: TextUnit[], d: Decisions, hints: { fileNames: Set<string>; meta: PluginMeta }): DecisionGroup[]` — 많은 순. `fileNames` 는 확장자를 뗀 파일 이름들의 집합(작업 1의 `files.json` 에서)
- `checkTranslation` 에 선택 인자 `keep?: KeepRule` 을 더해 뼈대 검사를 포함한다. 뼈대 검사 대상일 때 제어문자 검사는 번역 구간에 대해서만 한다

**시험이 확인할 것(값 그대로):**
- `shapeOf('"1_t=2_subject=おっぱい弄られた回数：\\\\V[81]"])')` → `'"#_t=#_subject=◆\\\\V[#]"])'`
- `japaneseSpans` 가 `'ShowInfo _SE[Item1]\\C[27]オートセーブ\\C[0]'` 에서 `オートセーブ` 한 구간만 준다
- `keepPieces('addLog アーテルは\\C[5]ギア\\C[0]を訓練に誘った', { mode: 'args', from: 1, dropLast: 0 })` → `['addLog ', '']`
- `keepPieces('D_TEXT 筋力\\V[22] 32', { mode: 'args', from: 1, dropLast: 1 })` → `['D_TEXT ', ' 32']`, 그리고 `keepPieces('D_TEXT 32', 같은 규칙)` → null
- `checkSkeleton('D_TEXT 筋力\\V[22] 32', 'D_TEXT 근력\\V[22] 32', args 1/1)` → `[]`, target 이 `'D_TEXT 근력\\V[22] 28'` 이면 skeleton 오류, `'텍스트 근력 32'` 이면 오류
- spans: source `'"1_t=2_subject=回数：\\\\V[81]"])'`, target `'"1_t=2_subject=횟수: \\\\V[81]"])'` → `[]`. target 에서 `1_t=2` 가 `1_t=3` 으로 바뀌면 오류
- 번역 구간에 `$1`, `(`, `\` 가 들어간 target 도 통과한다
- `decisionKey`: 시험용 게임의 `ShowRecord 記録` → `mv:ShowRecord`, 플러그인 설정 `物語` → `param:Menu:list[*].label`
- `groupDecisions`: 같은 키의 항목이 한 묶음, `samples` 는 최대 5개, 표본 값이 `fileNames` 에 있으면 `hints.fileNames` 가 센다
- `isTranslatable`: 결정 없음 → false, `translate: true` → true, `unit:<id>` 의 `translate: false` 가 묶음의 true 를 이긴다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 판단 키와 뼈대 검사"`

### Task 3: 플러그인 주석 읽기와 자동 결정

**Files:** Create `src/core/extract/pluginMeta.ts`, `src/core/decisions/auto.ts` · Test `tests/decisions/auto.test.ts`

**Interfaces:**
- Produces: `interface PluginMeta { params: Record<string, { type?: string; text?: string; desc?: string }>; commands: Record<string, { text?: string; desc?: string; args: Record<string, { type?: string; text?: string; desc?: string }> }> }`, `parsePluginMeta(js: string): PluginMeta`(파일 맨 위 `/*: … */` 블록들의 `@param`, `@command`, `@arg`, `@type`, `@text`, `@desc` 를 읽는다. `/*:ja` 블록이 있으면 그것을 우선), `loadPluginMeta(projectDir): Promise<Record<string, PluginMeta>>`(플러그인 이름 → 주석)
- Produces: `autoDecide(groups: DecisionGroup[]): Decisions` — 확실한 것만 `status: 'suggested'`, `by: 'meta'` 로 제안한다

자동 규칙(위에서부터 먼저 맞는 것):

| 조건 | 제안 |
|---|---|
| `metaType` 이 `file`, `animation`, `actor`, `class`, `skill`, `item`, `weapon`, `armor`, `enemy`, `troop`, `state`, `tileset`, `common_event`, `switch`, `variable`, `number`, `boolean`, `select`, `combo` 중 하나이거나 `file` 로 시작(`file[]` 등) | 번역 안 함, 이유 `플러그인이 이 값을 <type> 로 선언함` |
| 표본의 80% 이상이 게임 파일 이름과 같음 | 번역 안 함, 이유 `그림·소리 파일 이름과 같음` |
| `metaType` 이 `string`, `multiline_string`, `note` 이고 `metaText`/`metaDesc` 에 `表示`, `テキスト`, `メッセージ`, `名前`, `タイトル`, `説明`, `text`, `message`, `label`, `title`, `name` 중 하나가 있음(대소문자 무시) | 번역함, `whole`, 이유 `플러그인 설명에 표시용 글자라고 적힘` |
| 그 외 | 제안 없음(Claude 나 사용자가 정한다) |

**시험이 확인할 것:**
- `parsePluginMeta` 가 `@command SET_DESTINATION` 아래 `@arg destination` 의 `@type multiline_string`, `@text 行動目標` 를 읽는다. `@param` 의 `@type file` 도 읽는다. `/*:ja` 블록이 있으면 그 글을 쓴다
- 위 표의 각 줄에 대해 하나씩: 조건을 만족하는 묶음 → 기대한 제안, 마지막 줄 → 키가 결과에 없음
- 이미 `confirmed` 결정이 있는 키는 `autoDecide` 결과에 넣지 않는다(호출 쪽에서 합칠 때 사용자 결정을 덮지 않게 `mergeSuggestions(existing, suggested): Decisions` 를 함께 만든다. `confirmed` 는 유지, `suggested` 는 새 것으로 바꿈)

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 플러그인 주석으로 자동 결정"`

### Task 4: 메모란 추출

**Files:** Create `src/core/extract/notes.ts` · Modify `src/core/extract/database.ts` · Test `tests/extract/notes.test.ts`

**Interfaces:**
- Produces: `extractNotes(note: string, file: string, path: PathSeg[]): RawUnit[]` — `<태그:값>` 과 여러 줄짜리 `<태그>…</태그>` 의 값에 일본어가 있으면 `kind: 'note'`, `needsDecision: true`, ref `note`, `decisionKey: 'note:<파일 종류>:<태그>'`. 값이 없는 `<태그>` 와 태그 밖의 글은 추출하지 않는다
- `extractFromDataFile` 이 Actors, Classes, Skills, Items, Weapons, Armors, Enemies, States 의 `note` 와 맵 이벤트의 `note` 에 대해 이것을 부른다
- Produces: `replaceNoteValue(note: string, tag: string, index: number, value: string): string`

**시험이 확인할 것:**
- `'<SG説明:夜に光る草>\n<price:100>\n<SG説明:二つ目>'` → 2개, 값 `夜に光る草`·`二つ目`, index 0·1, 키 `note:Items:SG説明`. `price` 는 없음
- 여러 줄 태그 `<説明>\n一行目\n二行目\n</説明>` 의 값이 줄바꿈째로 나온다
- `replaceNoteValue` 로 index 1 만 바꾸면 나머지 글이 그대로다. 값에 `$1` 이 있어도 그대로 들어간다
- note 가 빈 글이거나 문자열이 아니면 빈 배열

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 메모란 태그 추출"`

### Task 5: 플러그인 JS 파일의 문자열 추출

**Files:** Create `src/core/extract/pluginJs.ts` · Modify `src/core/extract/index.ts` · Test `tests/extract/pluginJs.test.ts`

**Interfaces:**
- Produces: `extractJsStrings(js: string, file: string): RawUnit[]` — 주석(`//`, `/* */`)과 정규식 리터럴 밖의 문자열 리터럴(`"…"`, `'…'`, 그리고 `${` 가 없는 `` `…` ``) 중 일본어가 든 것. `source` 는 따옴표 안쪽 글 그대로(이스케이프를 풀지 않는다), ref `js`, `needsDecision: true`, `decisionKey: 'js:<파일 이름>'`. `kind: 'plugin-js'`
- `extractAll` 이 `js/plugins/*.js` 중 `plugins.js` 에서 `status: true` 인 플러그인의 파일에 대해 부른다. `plugin-js` 항목은 같은 원문끼리 합치지 않는다(파일과 위치마다 하나)

**시험이 확인할 것:**
- `var a = "表示"; // "コメント"\n/* "ブロック" */ var b = '値\\'だ';` → 2개(`表示`, `値\\'だ`), `start`/`end` 로 자른 글이 source 와 같다
- 정규식 `/["']日本語/` 안의 따옴표에 속지 않는다. 나눗셈 `a / b / "割る"` 는 문자열로 잡는다
- `${x}` 가 든 템플릿 문자열은 건너뛴다
- 꺼진 플러그인(`status: false`)의 파일은 추출하지 않는다
- 따옴표가 닫히지 않은 깨진 파일에서 예외를 던지지 않고, 그 파일에 대한 경고 하나를 돌려준다(`extractAll` 의 `warnings`)

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 플러그인 JS 문자열 추출"`

### Task 6: 적용 — 결정 반영, 메모란, JS 파일, 제목

**Files:** Modify `src/core/build/apply.ts`, `src/core/build/patch.ts` · Create `src/core/build/title.ts` · Test `tests/build/applyDecisions.test.ts`

**Interfaces:**
- `applyTranslations(projectDir, units, store, o?: { decisions?: Decisions })` — 판단 필요 항목의 적용 조건을 바꾼다: `isTranslatable(unit, decisions)` 이고 target 이 있고 상태가 `error`·`declined` 가 아니며 `checkSkeleton` 을 통과할 때. (기존의 "승인된 판단 필요 항목은 적용"도 그대로 유지한다.) `note` ref 는 `replaceNoteValue`, `js` ref 는 그 파일의 위치들을 뒤에서부터 바꾼다. JS 파일은 바꾸기 전에 `[start, end)` 의 글이 `unit.source` 와 같은지 확인하고, 하나라도 다르면 그 파일 전체를 건너뛰고 `warnings` 에 `{ file, message: '추출 뒤에 파일이 바뀌어 적용하지 않았습니다' }` 를 넣는다. 반환을 `Map` 에서 `{ files: Map<string, string>; warnings: Warning[] }` 로 바꾸지 **않는다**: 기존 시그니처를 유지하고, 경고는 새 함수 `applyTranslationsDetailed(…): Promise<{ files: Map<string, string>; warnings: Warning[] }>` 로 준다(`applyTranslations` 는 이것을 불러 `files` 만 돌려준다)
- JS 문자열에 넣을 때: 번역문에 그 따옴표 글자나 줄바꿈이 이스케이프 없이 있으면 이스케이프한다(`"` 안의 `"` → `\"`, 실제 줄바꿈 → `\n`). 이미 이스케이프된 것은 그대로
- Produces: `titleFiles(projectDir, titleTarget: string | null): Promise<Map<string, string>>` — `titleTarget` 이 있으면 `original/<current>/index.html` 의 `<title>…</title>` 안을 바꾼 글을 `index.html` 키로(HTML 특수문자 `& < >` 이스케이프). `package.top.json` 의 `window.title` 이 빈 글이 아니면 그것도 바꿔 `<top>/package.json` 키로. `name` 은 절대 바꾸지 않는다. 원본 파일이 없으면 빈 Map
- `buildPatch` 가 `decisions.json` 을 읽어 넘기고, `System.json` 의 `gameTitle` 번역이 있으면 `titleFiles` 결과를 패치에 더한다. `index.html` 은 `<contentPrefix>index.html`, 최상위 `package.json` 은 접두사 없이 `package.json`. `BuildResult` 에 `warnings: Warning[]` 를 더한다

**시험이 확인할 것:**
- 결정이 없으면 `ShowRecord 記録` 의 번역이 있어도 패치에 안 들어간다. `mv:ShowRecord` 를 `args 1/0` 번역함으로 하고 target 이 `ShowRecord 기록` 이면 들어간다. target 이 `기록 보기` 면(뼈대 깨짐) 안 들어간다
- 결정을 번역 안 함으로 되돌리면 번역표에 target 이 남아 있어도 패치에서 빠진다
- 메모란: `<SG説明:夜に光る草>` 가 `<SG説明:밤에 빛나는 풀>` 로 바뀌고 같은 note 의 다른 글은 그대로
- JS: 두 문자열 중 하나만 번역해도 파일의 나머지가 바이트 단위로 같다(바뀐 구간만 다름). 번역문의 `"` 가 `\"` 로 들어간다
- JS 원본 사본을 시험에서 고쳐 위치가 어긋나게 하면 그 파일은 패치에 없고 경고가 하나 온다. 다른 파일은 정상 적용
- 제목: `gameTitle` 을 `안개 약초원` 으로 번역하면 패치에 `index.html` 이 있고 `<title>안개 약초원</title>` 이다. 제목에 `&` 가 있으면 `&amp;`. `package.top.json` 의 `window.title` 이 빈 글이면 `package.json` 은 패치에 없다. `name` 값은 어떤 경우에도 원본과 같다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 결정에 따른 적용과 제목 파일"`

### Task 7: Claude에게 결정 추천 받기

**Files:** Create `src/main/translate/decide.ts` · Test `tests/main/decide.test.ts`

**Interfaces:**
- Consumes: `runClaudeJson`, `groupDecisions`, `autoDecide`, `mergeSuggestions`
- Produces: `DECIDE_SCHEMA`(`{ decisions: [{ key: string, translate: boolean, mode: 'whole' | 'args' | 'spans', from?: integer, dropLast?: integer, reason: string }] }`), `buildDecidePrompt(groups: DecisionGroup[]): { system: string; user: string }`, `class DecideJob`(모양은 `TranslateJob` 과 같고 `kind: 'decide'`. `JobKind` 에 `'decide'` 추가)

동작: 먼저 `autoDecide` 를 적용해 저장한다(호출 없음). 남은 묶음(결정이 없는 것)을 30개씩 묶어 호출한다. JS 묶음(`js:<파일>`)은 묶음 단위가 아니라 그 파일의 문자열을 하나씩(`unit:<id>` 키로, 앞뒤 60자 문맥과 함께) 최대 40개씩 보낸다. 결과는 `status: 'suggested'`, `by: 'claude'` 로 저장한다. `args` 인데 `from` 이 없으면 1, `dropLast` 가 없으면 0. 돌아온 키가 보낸 것에 없으면 버린다. 실패 처리는 `TranslateJob` 과 같되 `refused`/`invalid` 는 그 묶음을 건너뛰고 `errors` 를 올린다. 모델은 `settings.stageModels.decide`(새 항목, 기본 `'claude-fable-5-2'`).

프롬프트(system)에 꼭 들어갈 내용: "RPG Maker MV/MZ 게임의 플러그인 커맨드·스크립트·설정값 묶음을 보고, 화면에 보이는 글자인지 코드가 읽는 값인지 판단한다. 화면에 보이면 translate true. 그림·소리·영상 파일 이름, 스위치나 변수 이름, 코드가 비교하는 키, 태그 이름은 translate false. 값의 일부만 표시 글자면 mode 를 정한다: MV 커맨드에서 앞의 몇 조각과 뒤의 몇 조각이 설정값이면 args(from, dropLast), 문자열 안에 코드와 글자가 섞였으면 spans, 값 전체가 글자면 whole. 확신이 없으면 translate false 로 하고 reason 에 이유를 적는다(잘못 번역하면 게임이 깨지고, 안 번역하면 일본어가 남을 뿐이다)."

**시험이 확인할 것(가짜 호출로):**
- 자동 결정이 되는 묶음은 호출 없이 정해진다. 호출에 실린 묶음에 그 키가 없다
- 호출 결과가 `suggested`/`claude` 로 저장되고, 보낸 적 없는 키는 버려진다
- 이미 `confirmed` 인 키는 호출에 실리지 않고 바뀌지 않는다
- JS 파일의 문자열은 `unit:<id>` 키로 따로 정해진다
- `auth` 실패 → `failed` 와 로그인 메시지, `limit` → `paused-limit`

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 판단 필요 묶음 추천"`

### Task 8: 외부 번역용 내보내기와 가져오기

**Files:** Create `src/core/exchange/package.ts` · Test `tests/exchange/package.test.ts`

**Interfaces:**
- Produces: `buildPackage(o: { meta: ProjectMeta; units: TextUnit[]; entryOf; glossary: Glossary; decisions: Decisions; ids: string[] }): ExchangePackage`

```ts
export interface ExchangePackage {
  format: 'mvmz-exchange-1'; project: string; sourceLang: string; targetLang: string;
  instructions: string;       // 말투 지침 전체 + 형식 규칙을 글로 + 돌려줄 형식 설명
  terms: { source: string; target: string }[];        // 내보내는 항목들에 나오는 것만
  characters: { name: string; target: string; speech: string; moanStyle?: string }[];
  items: { id: string; kind: UnitKind; speaker: string | null; text: string; keep?: string[]; current?: string;
           before: { speaker: string | null; source: string; target: string | null }[]; after: 같은 모양 }[];
  replyFormat: '[{ "id": "...", "target": "..." }]';
}
```

`text` 는 화자 줄을 뗀 본문. `keep` 은 `keepPieces` 가 빈 글만이 아닐 때. `before`/`after` 는 같은 파일의 앞뒤 대사 2개씩. `moanStyle` 은 계획 3이 인물 카드에 더한 선택 필드로, 있으면 싣는다.
- Produces: `planImport(units, entryOf, glossary, decisions, items: { id: string; target: string }[]): { ok: { id: string; target: string; issues: Issue[] }[]; conflicts: { id: string; current: string; incoming: string }[]; unknownIds: string[]; invalid: number }` — 화자 줄이 있는 항목은 `composeSpeaker` 로 붙인 뒤 비교·검사한다. 지금 번역이 있고 들어온 것과 다르면 `conflicts`, 같으면 건너뛴다. `id`·`target` 이 글이 아닌 항목은 `invalid` 로 센다
- `TranslationEntry` 에 선택 필드 `external?: true`, `Origin` 에 `'external'`

**시험이 확인할 것:**
- 꾸러미의 `terms` 에는 내보낸 항목의 원문에 나오는 용어만 있다. `instructions` 에 말투 지침과 "제어문자" 규칙 글이 있다
- 화자 줄이 있는 항목의 `text` 에 화자 줄이 없고 `speaker` 가 채워진다. 결정이 `args 1/1` 인 항목에 `keep: ['D_TEXT ', ' 32']`
- `planImport`: 모르는 id → `unknownIds`, 기존 번역과 다름 → `conflicts`, 같음 → 어디에도 없음, 번역 없음 → `ok`. 제어문자를 빼먹은 번역은 `ok` 에 들어가되 `issues` 에 오류가 있다
- JSON 이 배열이 아니거나 항목 모양이 틀려도 예외 없이 `invalid` 로 센다

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 외부 번역용 꾸러미"`

### Task 9: ProjectService, IPC, 채팅 도구 연결

**Files:** Modify `src/main/projectService.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/api.ts`, `src/main/toolHandlers.ts`, `src/main/claude/args.ts`, `src/main/claude/prompt.ts`, `src/main/settings.ts`, `src/main/translate/batches.ts`·`job.ts`(판단 필요 항목 포함) · Test `tests/main/decisionOps.test.ts`

**Interfaces:**
- `ProjectService`: 열 때 `ensureOriginals` 를 부른다. `decisions()`, `decisionGroups(): DecisionGroup[]`, `setDecision(key, d: Omit<Decision, 'status' | 'by'>, by: 'user' | 'claude')`(→ `confirmed`), `confirmSuggestions(keys?: string[])`(제안을 확정으로), `clearDecision(key)`, `'decisions-changed'` 이벤트. 결정이 바뀌면 그 키의 항목들에 대해 변경 알림을 낸다(표의 상태 표시가 바뀌도록). `setGameTitle(target: string)`: `System.json` 의 `gameTitle` 항목 번역을 쓰고 `approved` 로. `exportPackage(ids, filePath)`, `importPackage(filePath)` → `planImport` 결과, `applyImport(plan, overwriteConflicts: boolean)` → 출처 `'external'`
- `Row` 에 `decision: 'none' | 'translate' | 'skip' | 'suggested-translate' | 'suggested-skip' | null`(판단 필요가 아니면 null), `external: boolean`. `StatusFilter` 에 `'external'`, `'skipped'`. `Stats` 에 `external`, `undecided`(결정이 없는 판단 필요 항목 수). 기존 `needsDecision` 통계와 필터는 그대로
- `planBatches`: 대상을 "`needsDecision` 이 아닌 것"에서 "`isTranslatable` 인 것"으로 바꾼다(확정된 결정만. 제안은 아직 번역하지 않는다). `BatchItem` 에 `keep?: string[]` 를 더해 프롬프트 user JSON 의 항목에 싣고, 시스템 글에 "keep 이 있으면 그 글들은 한 글자도 바꾸지 않고 같은 순서로 남긴다. text 전체를 돌려주되 그 사이의 글자만 번역한다"를 더한다. `TranslateJob` 은 쓰기 전에 `checkSkeleton` 을 적용한다(실패하면 다른 검사 오류와 같이 한 번 다시 보낸다)
- IPC(`window.api`): `decisions.groups()`, `decisions.set(key, d)`, `decisions.confirm(keys?)`, `decisions.clear(key)`, `job.decide()`, `project.setGameTitle(target)`, `exchange.export(ids)`(저장 창 → 경로 또는 null), `exchange.planImport()`(열기 창 → 계획 또는 null), `exchange.applyImport(overwrite)`, `on('decisions:changed')`
- 채팅 도구 2개 추가: `list_decisions`(`query?: string` → 묶음들: key, label, count, samples, hints, decision), `set_decision`(`key`, `translate`, `mode?`, `from?`, `dropLast?`, `reason?` → `by: 'claude'`, 바로 `confirmed`). 채팅 시스템 프롬프트에 "판단 필요 항목은 list_decisions 로 묶음을 보고 set_decision 으로 정한다. 화면에 보이는 글자라는 근거가 있을 때만 번역함으로 한다"를 더한다

**시험이 확인할 것:**
- 결정을 번역함으로 확정하면 그 키의 항목이 `planBatches` 에 들어오고 항목에 `keep` 이 실린다. 제안 상태일 때는 안 들어온다
- 번역 작업이 뼈대가 깨진 답을 받으면 한 번 다시 보내고, 또 깨지면 `error` 로 둔다
- `setGameTitle('안개 약초원')` 뒤 그 항목이 `approved` 이고, 빌드 결과에 `index.html` 이 있다
- `Row.decision` 이 결정 상태에 따라 다섯 값으로 바뀐다. `Stats.undecided` 가 줄어든다
- 내보낸 꾸러미 파일을 읽어 번역을 채워 다시 가져오면 `external: true` 로 들어가고, 충돌 항목은 `overwriteConflicts: false` 일 때 그대로다
- 채팅 도구: `set_decision` 뒤 `list_decisions` 가 그 결정을 보여준다. 모르는 키는 `ok: false`

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 결정과 꾸러미 연결"`

### Task 10: 판단 필요 화면

**Files:** Create `src/renderer/components/DecisionView.tsx` · Modify `Sidebar.tsx`(작업 메뉴 끝에 "판단 필요 <미결정 수>"), `App.tsx`, `state.ts` · Test `tests/renderer/decisions.test.tsx`

화면:
- 위: 제목 "판단 필요", 한 줄 설명 "플러그인이 쓰는 값 중 화면에 보이는 글자만 골라 번역해요. 같은 종류는 한 번만 정하면 돼요.", 버튼 "Claude에게 추천 받기"(`job.decide`), "추천 전부 받아들이기 (n)"(제안이 있을 때).
- 필터 칩: "정할 것 n", "추천 받음 n", "번역함 n", "번역 안 함 n".
- 묶음 카드(많은 순): 라벨(고정폭 글꼴), 종류, "n곳", 표본 최대 5개(`CodeText`. 결정이나 제안이 번역함이면 번역될 부분에 `--accent-bg` 배경, 그대로 둘 부분은 `--mute` 색), 힌트 줄("플러그인 설명: <metaText> · <metaDesc>", "표본 5개 중 4개가 그림·소리 파일 이름과 같아요"), 제안이 있으면 "추천: 번역 안 함 — <이유>"와 누가 추천했는지("플러그인 주석" / "Claude").
- 카드의 버튼: "번역함", "번역 안 함". "번역함"을 누르면 방식 고르기가 펼쳐진다: "전체", "일본어 부분만", "앞뒤 조각은 그대로"(MV 커맨드일 때만. 앞에서 그대로 둘 조각 수와 뒤에서 그대로 둘 조각 수를 숫자로 고르고, 표본에 바로 반영된다). 처음 값은 제안이 있으면 그것, MV 커맨드는 "앞 1개 그대로", 스크립트는 "일본어 부분만", 그 외는 "전체".
- 번역할 부분이 비는 표본(Review Focus 2)은 "이 줄은 번역할 부분이 없어 그대로 둬요"라고 흐리게 표시.
- "이 묶음의 줄 보기": 텍스트 화면으로 가서 그 키의 항목만 보이게 한다(`RowQuery` 에 선택 필드 `decisionKey?: string` 추가).
- JS 파일 묶음 카드는 펼치면 문자열이 하나씩 나오고 각각 번역함/안 함을 고른다.

**시험이 확인할 것:**
- 묶음 카드에 라벨, "225곳" 같은 개수, 표본이 보인다. 제안이 있으면 "추천: 번역 안 함"과 이유가 보인다
- "번역함"을 누르고 "앞뒤 조각은 그대로" 에서 뒤 1개를 고르면 `decisions.set('mv:D_TEXT', { translate: true, keep: { mode: 'args', from: 1, dropLast: 1 } })` 가 불린다
- 방식에 따라 표본의 강조 부분이 달라진다(`D_TEXT 筋力\V[22] 32` 에서 `筋力\V[22]` 만 강조)
- "추천 전부 받아들이기"가 `decisions.confirm()` 을 부른다. "Claude에게 추천 받기"가 `job.decide` 를 부른다
- 필터 칩이 묶음을 걸러낸다. 사이드바의 숫자가 `Stats.undecided` 다

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 판단 필요 화면"`

### Task 11: 게임 제목 칸, 내보내기·가져오기 화면, 표의 표시

**Files:** Create `src/renderer/components/TitleField.tsx`, `ExchangeDialog.tsx` · Modify `TopBar.tsx`, `TextTable.tsx`, `ItemPanel.tsx`, `SettingsView.tsx` · Test `tests/renderer/titleExchange.test.tsx`

화면:
- 위 막대의 게임 이름 자리: 원래 제목 아래에 번역 제목. 연필 버튼(`aria-label="게임 제목 고치기"`)을 누르면 입력 칸이 되고 `Enter` 로 저장(`project.setGameTitle`), `Esc` 로 취소. 번역 제목이 없으면 "제목 번역 없음". 아래에 작은 글 "작업표시줄과 타이틀 화면에 이 이름이 보여요".
- 텍스트 화면 위: "내보내기"(지금 필터에 걸린 항목 n개를 꾸러미로. 0개면 누를 수 없다), "가져오기". 가져오기를 누르면 파일을 고른 뒤 `ExchangeDialog`: "넣을 수 있는 번역 a개 · 그중 검사 오류 b개", "이미 번역이 있고 내용이 다른 항목 c개"(있으면 "덮어쓰기"/"건너뛰기" 고르기, 기본은 건너뛰기), "프로젝트에 없는 id d개", "모양이 틀린 항목 e개", 버튼 "가져오기".
- 상태 필터 칩에 "외부 번역 n", "번역 안 함 n" 추가(0이면 숨김).
- 표의 번역 칸: 결정이 번역 안 함인 판단 필요 줄은 "번역 안 함", 제안만 있는 줄은 "추천: 번역함"/"추천: 번역 안 함", 결정이 없으면 지금처럼 "판단 대기".
- 항목 탭: 판단 필요 항목이면 그 묶음의 라벨과 결정 상태, "이 줄만 따로 정하기"(번역함/안 함 → `decisions.set('unit:<id>', …)`), "묶음 보기"(판단 필요 화면의 그 카드로). 외부 번역이면 "외부에서 가져온 번역" 표시. 뼈대 검사 오류가 검사 결과에 보인다.
- 설정의 단계별 모델에 "판단 필요 추천" 칸.

**시험이 확인할 것:**
- 제목을 고치고 `Enter` → `project.setGameTitle('안개 약초원')`. `Esc` 는 부르지 않는다
- 내보내기가 지금 필터의 id 들로 `exchange.export` 를 부른다. 필터 결과가 0개면 버튼이 꺼져 있다
- 가져오기 대화상자가 네 가지 수를 보여주고, 기본 선택(건너뛰기)으로 `exchange.applyImport(false)` 를 부른다
- 결정 상태에 따라 번역 칸의 글이 다섯 가지로 나온다
- "이 줄만 따로 정하기"가 `unit:<id>` 키로 부른다

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 제목 칸과 내보내기·가져오기 화면"`

### Task 12: 전체 흐름 시험과 실제 CLI 확인

**Files:** Modify `tests/e2e/app.e2e.test.ts`, `tests/helpers/miniGame.ts`(메모란 태그, MZ 플러그인 커맨드, 주석이 달린 플러그인 JS 파일 하나, `index.html`, 최상위 `package.json`, `img/pictures` 의 빈 파일 몇 개를 더한다. 기존 시험이 기대는 값은 바꾸지 않는다), `README.md` · Create `tests/main/realDecide.test.ts`

- [ ] **연기 시험 추가**(가짜 JSON CLI): 가져오기 → 판단 필요 화면 → "Claude에게 추천 받기" → "추천 전부 받아들이기" → 용어집 확정 → 번역 맡기기 → 판단 필요였던 줄에 번역이 들어가고 그대로 둘 부분이 유지됨 → 게임 제목 고치기 → 패치 빌드 → zip 에 `index.html` 과 고친 플러그인 JS 가 있고, JS 의 바뀌지 않은 부분이 원본과 같음
- [ ] **`npm run build:app && npm run test:e2e` → 실패 확인 후 빠진 연결을 채워 통과**
- [ ] **실제 CLI 확인**(`MVMZ_REAL_CLI=1`, 로그인 상태에서만. 아니면 건너뛰고 보고에 적는다): 시험용 게임의 묶음들(표시 글자인 커맨드 하나, 파일 이름을 받는 커맨드 하나, 글자와 코드가 섞인 스크립트 하나)로 `DecideJob` 을 한 번 돌려, 결정과 이유를 보고에 그대로 붙인다. 표시 글자 묶음이 번역함으로, 파일 이름 묶음이 번역 안 함으로 나오는지 확인한다
- [ ] **전체 확인**: `npx vitest run`, 두 tsconfig 의 `tsc --noEmit`, `npm run test:e2e`
- [ ] **`README.md` 에 판단 필요 흐름과 새 파일(`decisions.json`)을 적고 `git commit -m "feat: 판단 필요 전체 흐름 시험"`**

---

## 이 계획이 끝난 뒤 사람이 확인할 것

- 실제 MV 게임(판단 필요 327개)과 MZ 게임(291개)에서 묶음이 몇 개로 줄어드는지, 자동 결정과 Claude 추천이 맞는지.
- 번역함으로 정한 커맨드가 게임 안에서 한글로 나오고, 번역 안 함으로 둔 것 때문에 그림이나 기능이 깨지지 않는지.
- 고친 플러그인 JS 가 게임에서 오류 없이 도는지.
