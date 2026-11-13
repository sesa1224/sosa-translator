# MV/MZ 번역 작업실 · 계획 6: 게임 업데이트 대응 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임의 새 버전이 나오면 새 폴더를 가져와, 원문이 그대로인 문장은 번역을 그대로 이어받고, 새로 생기거나 바뀐 문장만 번역 대상으로 올린다. 버그 수정은 자동으로 다시 얹고, 자리가 달라진 수정은 옮길 수 있으면 옮기고 안 되면 충돌로 알린다. 무엇이 바뀌었는지 한 화면에 보여 준다.

**Architecture:** 번역표는 원문으로 만든 id 가 열쇠라서, 새 버전에서 다시 추출하면 원문이 같은 문장은 번역이 저절로 붙는다. 이 계획은 그 위에 (1) 바뀐 문장을 이전 문장과 짝지어 이전 번역을 참고로 붙이고, (2) 수정의 원본 번호를 새 목록으로 옮기고, (3) 가져오기 전 상태를 통째로 남겨 되돌릴 수 있게 한다. 비교와 옮기기는 `src/core/update` 의 순수 함수로 둔다.

**Tech Stack:** 지금과 같다. 새 런타임 의존성 없음.

**Spec:** `docs/2026-11-13-mvmz-번역작업실-기획서.md` (4.8). 먼저 `CLAUDE.md` 를 읽는다.

## Global Constraints

- 지금까지의 공개 이름은 바꾸지 않고 추가만 한다. 기존 시험(517개)과 앱 연기 시험(14개)은 계속 통과해야 한다.
- 원본 게임 폴더(옛 버전, 새 버전 모두)에는 쓰지 않는다.
- 새 버전을 가져와도 번역표의 항목은 하나도 지우지 않는다. 새 버전에 없는 문장의 번역은 번역표에 남고 화면에서만 안 보인다(문장이 되살아나면 번역도 되살아난다).
- 가져오기는 되돌릴 수 있어야 한다. 가져오기 직전의 상태를 남기고, 되돌리면 그 시점과 글자 하나까지 같아야 한다.
- 가져오기 도중 실패하면 프로젝트는 가져오기 전 상태 그대로여야 한다(반쯤 바뀐 상태로 남지 않는다).
- 사용자에게 보이는 글과 마지막 보고는 한국어. 코드 식별자와 주석은 영어, 커밋 메시지는 한국어.
- 시스템에 프로그램 설치가 필요하거나 버전이 맞지 않으면 우회하지 말고 멈춰서 보고한다.
- 커밋은 작업마다 한 번, `master` 에 직접.

## Review Focus

1. **다른 게임의 폴더를 넣었을 때**: 엔진이 다르거나 데이터 파일 이름이 거의 겹치지 않으면 가져오기 전에 "다른 게임 같아요"라고 경고하고, 사용자가 그래도 진행을 누르기 전에는 아무것도 바꾸지 않는다. → 작업 4, 7
2. **같은 문장이 자리만 옮겨졌을 때**: 원문이 그대로면 어느 맵으로 옮겨 가든 번역이 그대로 붙는다. "바뀐 문장"으로 세지 않는다. → 작업 1
3. **문장부호나 공백만 바뀌었을 때**: 원문에서 공백과 문장부호를 빼면 같은 문장은 이전 번역을 미리 채워 "검토 필요"로 두고, 그 사실을 표시한다. 말없이 승인 상태로 두지 않는다. → 작업 2
4. **수정이 가리키던 줄이 사라졌을 때**: 그 수정은 자동으로 옮기지 않고 충돌로 남긴다. 비슷한 줄에 대충 붙이지 않는다. → 작업 3
5. **두 번 연속 업데이트**: v1 → v2 → v3 로 가져와도 번역 승계, 수정 옮기기, 되돌리기(v3 → v2)가 동작한다. → 작업 4

---

## 공용 타입 (작업 1에서 만든다)

```ts
// src/core/update/types.ts
export interface VersionInfo { id: string; label: string; importedAt: string; gameDir: string }   // ProjectMeta.versions 의 항목(기존 { id, importedAt } 에 label, gameDir 를 더한다. 옛 프로젝트는 label 이 없으면 id, gameDir 이 없으면 meta.gameDir)
export interface ChangedPair { oldId: string; newId: string; similarity: number; punctuationOnly: boolean }
export interface UnitDiff { kept: string[]; added: string[]; removed: string[]; changed: ChangedPair[] }   // added 와 removed 는 짝지어지지 않은 것만
export interface PatchMove { id: string; title: string; result: 'unchanged' | 'moved' | 'conflict'; reason?: string }
export interface UpdateSummary {
  from: string; to: string; fromLabel: string; toLabel: string;
  kept: number; keptTranslated: number;                      // 그대로인 문장, 그중 번역이 있는 수
  added: number; changed: number; carried: number;           // carried = 문장부호만 달라 이전 번역을 미리 채운 수
  removed: number; removedTranslated: number;
  patches: PatchMove[];
  images: { changed: string[]; added: number; removed: number };   // changed = 지시서가 있는데 원본 그림이 바뀐 것
  decisions: { newGroups: number };                          // 결정이 없는 새 판단 필요 묶음 수
  warnings: Warning[];
}
// src/core/types.ts 의 TranslationEntry 에 선택 필드 추가:
//   previous?: { source: string; target: string | null; version: string }   // 바뀐 문장의 이전 원문과 이전 번역
//   carried?: true                                                           // 이전 번역을 미리 채운 것
```

---

### Task 1: 문장 비교

**Files:** Create `src/core/update/types.ts`, `src/core/update/diff.ts` · Modify `src/core/index.ts` · Test `tests/update/diff.test.ts`

**Interfaces:**
- Produces: `similarity(a: string, b: string): number` — 글자 2개씩 묶음(bigram)의 Dice 계수, 0~1. 제어문자는 빼고 비교. 둘 다 2글자 미만이면 같을 때 1, 다를 때 0
- Produces: `stripPunctuation(s: string): string` — 공백, 줄바꿈, 일본어·영문 문장부호와 기호(`、。！？…・「」『』（）〜ー―—♥❤♪` 와 ASCII 문장부호, 전각 공백)를 뺀 글. 제어문자는 남긴다
- Produces: `diffUnits(oldUnits: TextUnit[], newUnits: TextUnit[]): UnitDiff`
  1. id 가 양쪽에 있으면 `kept`.
  2. 남은 옛 항목과 새 항목을 짝짓는다. 먼저 **같은 자리**: 종류가 같고, ref 중 하나가 같은 파일·같은 `listPath`·같은 `start`(`lines`), 같은 `index`·`choice`(`choice`), 같은 `path`(`value`), 같은 `path`·`tag`·`index`(`note`)인 것. 한 옛 항목은 한 새 항목과만 짝짓는다(여럿이면 비슷한 정도가 가장 높은 것).
  3. 그래도 남은 것은 **같은 파일 안에서** 종류가 같고 `similarity` 가 0.75 이상인 것 중 가장 높은 것끼리(높은 순으로 하나씩 가져간다).
  4. `punctuationOnly` 는 `stripPunctuation` 결과가 같을 때.
  5. `plugin-js` 항목은 따로: id 가 파일 안의 위치에 기대어 만들어지는지 먼저 코드(`src/core/extract/pluginJs.ts`, `src/core/extract/index.ts`)에서 확인한다. 위치에 기대면 같은 파일에서 같은 원문의 n번째끼리 짝지어 `similarity 1` 의 `changed` 가 아니라 **id 옮기기 목록**으로 따로 돌려준다(`UnitDiff` 에 `moved: { oldId: string; newId: string }[]` 를 더한다). 원문에만 기대면 이 처리는 필요 없고 `moved` 는 늘 빈 배열이다

**시험이 확인할 것:**
- `similarity('月光草を集める', '月光草を三本集める')` 가 0.75 이상, 완전히 다른 두 문장은 0.3 미만, 같은 글은 1, `'\\C[2]あ\\C[0]い'` 와 `'あい'` 는 1
- `stripPunctuation('あれ？ \\N[1]じゃない！')` → `'あれ\\N[1]じゃない'`
- 원문이 같은 문장이 다른 맵으로 옮겨 가면 `kept`(자리와 상관없다)
- 같은 자리의 대사가 고쳐지면 `changed` 한 쌍, `punctuationOnly: false`
- `'やった！'` → `'やった！！'` 은 `punctuationOnly: true`
- 대사 앞에 새 대사가 끼어들어 번호가 밀려도, 밀린 대사들은 원문이 같으므로 `kept`. 끼어든 것만 `added`
- 같은 파일에서 자리는 다르지만 0.8쯤 비슷한 문장 → `changed`. 다른 파일의 비슷한 문장 → 짝짓지 않고 `added` 와 `removed`
- 옛 항목 하나가 새 항목 둘과 비슷하면 더 비슷한 쪽과만 짝지어지고 나머지는 `added`
- 종류가 다르면(대사와 선택지) 짝짓지 않는다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 버전 사이 문장 비교"`

### Task 2: 번역 이어받기

**Files:** Create `src/core/update/carry.ts` · Test `tests/update/carry.test.ts`

**Interfaces:**
- Produces: `carryTranslations(o: { diff: UnitDiff; oldUnits: TextUnit[]; newUnits: TextUnit[]; entries: Record<string, TranslationEntry>; decisions: Decisions; fromVersion: string; speakerPattern: string | null }): { entries: Record<string, TranslationEntry>; decisions: Decisions; carried: number }` — 받은 것을 고치지 않고 새 객체를 돌려준다
  - `kept`: 그대로.
  - `changed`: 새 id 의 항목에 `previous: { source: 옛 원문, target: 옛 번역, version: fromVersion }` 를 붙인다. 새 id 에 이미 번역이 있으면(예전에 번역한 적 있는 문장) 그 번역을 두고 `previous` 만 붙인다. `punctuationOnly` 이고 옛 번역이 있으며 새 id 에 번역이 없으면: 옛 번역을 `target` 으로, `status: 'needs-review'`, `carried: true`. 화자 줄이 있는 대사에서 화자 이름만 바뀐 경우(본문이 같음)도 같은 방식으로 본문 번역을 옮기되 화자 줄은 새 원문 기준으로 다시 만든다(`composeSpeaker`)
  - `moved`: 옛 id 의 번역 항목을 새 id 로 복사하고(옛 것은 남긴다), `unit:<옛 id>` 결정이 있으면 `unit:<새 id>` 로 복사한다
  - `removed`, `added`: 손대지 않는다(옛 항목의 번역은 번역표에 남는다)
- Produces: `changedWords(oldSource: string, newSource: string): { old: { text: string; changed: boolean }[]; new: { text: string; changed: boolean }[] }` — 화면에서 바뀐 부분을 강조하려고 글자 단위 LCS 로 나눈 조각(이웃한 같은 종류는 합친다)

**시험이 확인할 것:**
- 바뀐 문장의 새 항목에 `previous` 가 붙고 `target` 은 null, 상태는 `untranslated`
- 문장부호만 바뀐 문장: 옛 번역이 `target` 으로, `needs-review`, `carried: true`, 돌려준 `carried` 가 1
- 옛 번역이 없으면 미리 채우지 않는다. 새 id 에 번역이 이미 있으면 덮지 않는다
- 화자 줄 `【アーテル】` → `【アーテル（怒）】` 로만 바뀌고 본문이 같으면 본문 번역이 옮겨지고 화자 줄은 새 이름으로 다시 만들어진다(용어집에 그 이름이 없으면 원문 이름)
- `moved`: 새 id 로 번역과 `unit:` 결정이 복사되고 옛 id 의 것도 남아 있다
- 받은 `entries` 객체가 바뀌지 않는다
- `changedWords('月光草を3本', '月光草を5本')` → 새 쪽 조각 중 `5` 만 `changed`

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 번역 이어받기"`

### Task 3: 수정 옮기기

**Files:** Create `src/core/update/rebase.ts` · Test `tests/update/rebase.test.ts`

**Interfaces:**
- Produces: `alignLists(oldList: EventCommand[], newList: EventCommand[]): (number | null)[]` — 옛 번호 → 새 번호(없어졌으면 null). 커맨드 내용(코드, 들여쓰기, 인자)이 같은 것끼리 LCS 로 맞춘다
- Produces: `rebaseOps(oldList, newList, ops: ListOp[]): { ok: true; ops: ListOp[] } | { ok: false; reason: string }` — 모든 연산이 가리키는 옛 번호가 새 번호로 옮겨질 때만 성공. `insert after -1` 은 그대로. `insert after i` 는 옛 i 번 커맨드가 남아 있어야 하고, **그리고** 그 바로 다음 옛 커맨드(있으면)도 새 목록에서 바로 다음에 있어야 한다(끼워 넣을 자리의 앞뒤가 그대로일 때만 같은 자리로 본다). `delete`·`replace at i` 는 옛 i 번이 남아 있어야 한다. 실패 이유: `수정이 가리키던 줄이 새 버전에 없어요(<옛 번호>번: <풀어쓴 글>)` / `끼워 넣을 자리의 앞뒤가 바뀌었어요(<옛 번호>번 뒤)`. 풀어쓴 글은 호출 쪽이 주는 `describe: (cmd) => string` 으로
- Produces: `rebasePatch(patch: Patch, o: { oldList?: EventCommand[]; newList?: EventCommand[]; oldJson?: unknown; newJson?: unknown; describe }): { result: 'unchanged' | 'moved' | 'conflict'; patch: Patch; reason?: string }` — `event`: 새 목록의 `listHash` 가 `baseHash` 와 같으면 `unchanged`, 다르면 `rebaseOps` 해서 성공하면 `moved`(새 `ops` 와 새 `baseHash`), 실패하면 `conflict`(patch 는 그대로). 새 목록이 없으면 `conflict`(`원본에 그 이벤트가 없어요`). `json`: 새 값이 `baseValue` 와 내용이 같으면 `unchanged`, 다르면 `conflict`(`원본 값이 바뀌었어요`). `plugin`, `font`: `unchanged`

**시험이 확인할 것:**
- 목록 앞에 커맨드 2개가 더해진 새 버전 → `alignLists` 가 `[2,3,4,…]`. 가운데 하나가 지워지면 그 자리가 null
- 옛 5번 뒤에 끼워 넣던 수정 → 새 7번 뒤로 옮겨진다(`moved`, `baseHash` 가 새 목록의 해시)
- 수정이 지우던 줄이 새 버전에서 사라졌으면 `conflict` 와 이유(풀어쓴 글 포함)
- 끼워 넣을 자리 바로 뒤의 커맨드가 바뀌었으면 `conflict`(`끼워 넣을 자리의 앞뒤가 바뀌었어요`)
- 목록이 그대로면 `unchanged` 이고 patch 가 같은 객체 내용이다
- `json` 수정: 값이 그대로면 `unchanged`, 바뀌었으면 `conflict`
- 같은 커맨드가 목록에 여러 번 나와도(같은 대사 반복) 순서를 지켜 맞춘다

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 수정 옮기기"`

### Task 4: 새 버전 가져오기와 되돌리기

**Files:** Create `src/core/update/importVersion.ts` · Modify `src/core/project/project.ts`(버전 항목에 `label`, `gameDir`. 옛 형식도 읽는다) · Test `tests/update/importVersion.test.ts`

**Interfaces:**
- Produces: `inspectNewVersion(projectDir, gameDir): Promise<{ ok: true; engine: Engine; title: string; suggestedLabel: string; sameGame: boolean; overlap: number; reason?: string } | { ok: false; error: string }>` — `detectGame`. `overlap` 은 지금 버전과 새 폴더의 `data/*.json` 파일 이름이 겹치는 비율(작은 쪽 기준). 엔진이 다르면 `sameGame: false`(`엔진이 달라요(지금 MV, 새 폴더 MZ)`), `overlap < 0.5` 면 `sameGame: false`(`데이터 파일이 거의 겹치지 않아요`). `suggestedLabel` 은 게임 제목이나 폴더 이름에서 `ver1.03`, `v1.2`, `1.0.3` 꼴을 찾은 것(없으면 `v<다음 번호>`). 지금 버전과 같은 폴더면 `ok: false`(`지금 버전과 같은 폴더예요`)
- Produces: `importVersion(projectDir, gameDir, label: string): Promise<UpdateSummary>`
  1. `backups/before-<새 id>/` 에 `project.json`, `units.json`, `translations.json`, `glossary.json`, `decisions.json`, `patches.json`, `images.json`, `preview.json` 중 있는 것을 복사한다.
  2. `original/<새 id>/` 를 **임시 이름**(`original/<새 id>.tmp`)으로 만든다(`createProject` 가 원본을 복사하는 것과 같은 범위. 계획 3b 의 `files.json`, `index.html`, `package.top.json`, 계획 5 의 `fonts/gamefont.css` 포함. 그 코드를 다시 쓰도록 필요한 만큼만 함수로 떼어 낸다. 기존 함수의 이름과 동작은 그대로 둔다).
  3. 임시 폴더에서 새 항목을 추출한다(메모리에서. 아직 `units.json` 을 쓰지 않는다).
  4. `diffUnits`, `carryTranslations`, 수정마다 `rebasePatch`(옛 목록은 `original/<옛 id>` 에서, 새 목록은 임시 폴더에서)를 계산한다.
  5. 여기까지 오류 없이 끝나면 한꺼번에 적용한다: 임시 폴더를 제 이름으로 바꾸고, `units.json`, `translations.json`, `decisions.json`, `patches.json`(옮겨진 수정) 을 쓰고, `project.json` 의 `versions` 에 새 항목을 더하고 `current` 와 `gameDir` 를 바꾼다. 도중에 실패하면 1의 백업으로 되돌리고 임시 폴더와 새 원본 폴더를 지운 뒤 오류를 다시 던진다.
  6. `updates/<새 id>.json` 에 `UpdateSummary` 를 쓴다.
  - 그림: `images.json` 의 지시서마다 새 게임의 그 그림을 읽어(없으면 `removed` 로 센다) 해시가 `baseHash` 와 다르면 `images.changed` 에 넣는다. 지시서는 고치지 않는다(계획 7이 `base-changed` 로 표시한다). `added` 는 대상 폴더의 그림 중 옛 `files.json` 에 없던 것의 수
  - `decisions.newGroups`: 새 항목의 `decisionKey` 중 결정이 없고 옛 항목에는 없던 키의 수
- Produces: `rollbackVersion(projectDir): Promise<{ restored: string }>` — `current` 가 가장 최근에 가져온 버전일 때만(아니면 `Error('되돌릴 수 있는 업데이트가 없어요')`). `backups/before-<current>/` 의 파일들을 제자리에 되돌리고, `original/<current>/` 와 `updates/<current>.json` 을 지운다. 백업 폴더는 `backups/rolled-back-<current>-<시각>/` 로 이름을 바꿔 남긴다. 되돌린 뒤에는 한 번 더 되돌릴 수 없다(그 전 업데이트의 백업이 있으면 그것으로는 가능: v3 를 되돌려 v2 가 되면, v2 의 백업으로 다시 되돌릴 수 있다)
- Produces: `readUpdateSummary(projectDir, versionId?): Promise<UpdateSummary | null>`(기본은 `current`)

`makeMiniGame` 에 선택 인자 `variant: 'v2'` 를 더한다(기존 호출과 결과는 그대로): v2 는 (a) 맵 이벤트의 첫 대사 둘째 줄을 `こんな夜更けに来るなんて` 로 고치고, (b) `やった！` 를 `やった！！` 로, (c) 목록 맨 앞에 `{ code: 230, indent: 0, parameters: [30] }`(기다리기)를 더하고, (d) `Items.json` 에 2번 아이템 `{ id: 2, name: '星の砂', description: '光る砂', note: '' }` 을 더하고, (e) 커먼이벤트의 스크롤 문장을 지우고, (f) `System.json` 의 `gameTitle` 을 `霧の薬草園 ver1.1` 로 한다.

**시험이 확인할 것**(v1 프로젝트를 만들어 몇 문장을 번역하고, 맵 이벤트 목록 끝에 스위치를 켜는 수정을 하나 넣은 뒤 v2 를 가져온다):
- `inspectNewVersion` 이 `sameGame: true`, `suggestedLabel: '1.1'`(또는 `ver1.1` 에서 뽑은 값. 어느 쪽인지 정해 단언한다). 빈 폴더 → `ok: false`. 엔진이 다른 게임 → `sameGame: false` 와 이유. 같은 폴더 → `ok: false`
- 가져온 뒤: `いいよ` 의 번역이 그대로 있다(`kept`). 고쳐진 대사의 새 항목에 `previous` 가 있고 번역은 없다. `やった！！` 에 옛 번역이 채워지고 `carried`, `needs-review`. `星の砂` 가 새 항목이다. 스크롤 문장의 번역은 `translations.json` 에 남아 있지만 `units.json` 에는 그 항목이 없다
- 요약의 숫자: `added`, `changed`, `carried`, `removed`, `removedTranslated` 가 위와 맞다
- 수정: 목록 앞에 커맨드가 하나 더해졌으므로 `moved` 이고, 가져온 뒤 빌드한 `Map001.json` 에서 스위치 커맨드가 여전히 목록 끝(마지막 대사 뒤)에 있다
- `project.json`: `current` 가 `v2`, `versions` 에 `label` 과 `gameDir`, `gameDir` 가 새 폴더
- `rollbackVersion` 뒤 `project.json`, `units.json`, `translations.json`, `patches.json` 이 가져오기 전과 글자 하나까지 같고 `original/v2` 가 없다
- 가져오기 도중 실패하게 만들면(추출 함수를 한 번 던지게 한다) 프로젝트 파일이 전과 같고 `original/v2`·`original/v2.tmp` 가 없다
- v2 뒤에 v3(v2 에서 문장 하나를 더 고친 것)를 가져오고 되돌리면 v2 상태로 돌아온다
- `versions` 가 옛 형식(`{ id, importedAt }` 만)인 프로젝트도 열리고 가져오기가 된다
- 두 게임 폴더의 해시가 전후로 같다

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 새 버전 가져오기와 되돌리기"`

### Task 5: 서비스 연결과 번역 프롬프트

**Files:** Modify `src/main/projectService.ts`, `src/main/translate/batches.ts`, `src/shared/api.ts`, `src/shared/rows.ts`, `src/main/gameRun.ts` · Test `tests/main/updateOps.test.ts`

**Interfaces:**
- `ProjectService.importVersion(gameDir, label): Promise<UpdateSummary>` — 진행 중인 작업이 있으면 `Error('다른 작업이 진행 중입니다')`. 큐에서 실행하고, 끝나면 메모리의 항목·번역표·결정·수정을 다시 읽고 `'reloaded'` 이벤트를 낸다(화면은 스냅숏을 통째로 다시 받는다). `rollbackVersion()` 도 같다. `updateSummary(): Promise<UpdateSummary | null>`, `versions(): VersionInfo[]`
- 미리보기(계획 4), 이미지(계획 7), 이벤트 이름 표(계획 5)처럼 게임 폴더나 원본에 기대는 서비스는 `'reloaded'` 때 다시 만들어지게 `src/main/ipc.ts` 에서 프로젝트를 닫았다 여는 것과 같은 경로를 태운다(채팅과 진행 중이 아닌 작업 상태는 유지하지 않아도 된다)
- 시험용 사본(`testplay/`): 버전이 바뀌면 다음 `prepare` 때 사본을 새로 만든다. `save/` 는 `testplay-saves-<옛 id>/` 로 옮겨 남기고 새 사본에는 새 게임의 세이브를 처음 한 번 가져온다. `GameRunner` 가 `testplay/.version` 에 버전 id 를 적어 두고 다르면 이 처리를 한다
- `Row` 에 `previous?: { source: string; target: string | null }`, `carried?: boolean`. `StatusFilter` 에 `'changed'`(previous 가 있음). `Stats` 에 `changed`, `carried`
- `planBatches`/`buildTranslatePrompt`: 항목에 `previous` 가 있으면 user JSON 의 그 항목에 `previous: { source, target }` 을 싣고(화자 줄은 뗀 본문으로), 시스템 글에 "previous 가 있으면 원문이 조금 바뀐 문장이다. 바뀐 부분만 반영하고 나머지는 이전 번역의 표현과 말투를 그대로 둔다"를 더한다
- 사용자가 그 항목을 번역하거나 승인하면 `carried` 표시는 지운다. `previous` 는 남긴다

**시험이 확인할 것:**
- `svc.importVersion` 뒤 `svc.units()` 가 새 항목이고 `'reloaded'` 가 한 번 나간다. 작업이 도는 중이면 거절
- `toRow` 가 `previous` 와 `carried` 를 싣고, `filterRows(rows, { status: 'changed' })` 가 그 줄들만, `computeStats` 의 `changed`·`carried` 가 맞다
- 번역 프롬프트의 그 항목에 `previous` 가 실리고(화자 줄 없이) 시스템 글에 그 문장이 있다. `previous` 가 없는 묶음의 프롬프트는 전과 글자 하나까지 같다
- `carried` 항목을 승인하면 `carried` 가 없어지고 `previous` 는 남는다
- 버전이 바뀐 뒤 `prepare` 하면 사본의 옛 세이브가 `testplay-saves-v1/` 에 있고 새 사본의 데이터가 새 게임 것이다

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 업데이트 연결과 이전 번역 참고"`

### Task 6: IPC 와 채팅 도구

**Files:** Modify `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/api.ts`, `src/main/toolHandlers.ts`, `src/main/claude/args.ts`, `src/main/claude/prompt.ts`, `tests/renderer/fakeApi.tsx` · Test `tests/main/updateIpc.test.ts`

**Interfaces**(`window.api`):
- `update.inspect(gameDir)`, `update.pickGameDir()`(폴더 고르기 창 → 경로 또는 null. 시험에서는 `MVMZ_PICK_DIR2`), `update.import(gameDir, label)`, `update.rollback()`, `update.summary()`, `update.versions()`, `on('project:reloaded')` → 새 스냅숏
- `events.read` 에 선택 인자 `version?: string` 을 더해 옛 버전의 이벤트도 읽을 수 있게 한다(충돌난 수정을 볼 때 쓴다)
- 채팅 도구 2개 추가: `update_summary`(없음 → 가장 최근 업데이트의 요약. 충돌난 수정은 제목, 이유, 파일, `listPath` 와 함께), 그리고 기존 `event_read` 에 `version?` 입력을 더한다. 채팅 시스템 프롬프트에 더할 글: "게임이 업데이트된 뒤 충돌난 수정은 update_summary 로 목록을 보고, event_read 로 옛 버전(version)과 지금 버전을 각각 읽어 같은 뜻의 수정을 지금 버전의 번호로 다시 낸다(event_patch). 원래 수정의 의도를 바꾸지 않는다."
- 도구 목록을 전부 나열한 시험 단언은 늘어난 만큼 고친다

**시험이 확인할 것:**
- `update:import` 뒤 `project:reloaded` 가 새 스냅숏과 함께 온다. `update:summary` 가 요약을 준다. `update:rollback` 뒤 스냅숏이 전과 같다
- `events:read` 에 `version: 'v1'` 을 주면 옛 목록이 온다(v2 에서 앞에 더해진 커맨드가 없다)
- 채팅 도구 `update_summary` 가 충돌난 수정의 `listPath` 를 준다. 업데이트가 없으면 `ok: false`(`가져온 업데이트가 없습니다`)

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 업데이트 IPC 와 채팅 도구"`

### Task 7: 화면 — 새 버전 가져오기, 결과, 이전 번역

**Files:** Create `src/renderer/components/UpdateDialog.tsx`, `UpdateView.tsx` · Modify `TopBar.tsx`("새 버전 가져오기" 버튼), `Sidebar.tsx`(업데이트 결과가 있으면 작업 메뉴 끝에 "업데이트 결과"), `App.tsx`, `state.ts`, `TextTable.tsx`(필터 칩 "바뀐 문장 n", 0이면 숨김), `ItemPanel.tsx`, `theme.css` · Test `tests/renderer/update.test.tsx`

화면:
- 위 막대 "새 버전 가져오기" → `UpdateDialog`: "게임의 새 버전 폴더를 고르거나 여기에 끌어다 놓으세요"(끌어다 놓기는 프로젝트 고르기 화면과 같은 방식으로 경로를 얻는다. 이 창이 열려 있을 때만 받는다) → `update.inspect` 결과: 엔진과 제목, 버전 이름 칸(`suggestedLabel` 로 채움, `aria-label="버전 이름"`), "지금 버전: <label>". `sameGame: false` 면 `--warn` 색으로 이유와 "그래도 가져오기" 체크(체크해야 버튼이 켜진다). 안내 "가져오기 전 상태를 남겨 두어서 되돌릴 수 있어요. 원본 게임 폴더는 바꾸지 않아요." → "가져오기". 진행 중에는 "가져오는 중…"과 버튼 잠금. 실패하면 오류 글자와 "프로젝트는 그대로예요".
- 끝나면 `UpdateView`(사이드바의 "업데이트 결과"로도 다시 볼 수 있다): 제목 `<fromLabel> → <toLabel>`, 카드들:
  - "그대로인 문장 n개 · 번역 m개를 이어받았어요"
  - "새 문장 n개"와 "보기"(텍스트 화면, 미번역 필터)
  - "바뀐 문장 n개 · 이전 번역을 참고로 붙였어요"와 "보기"(텍스트 화면, 바뀐 문장 필터). `carried` 가 있으면 "그중 k개는 문장부호만 달라서 이전 번역을 미리 넣었어요(검토 필요)"
  - "사라진 문장 n개 · 번역 m개는 보관했어요"
  - 수정: "그대로 n · 자리를 옮김 n · 충돌 n". 충돌이 있으면 목록(제목과 이유)과 "Claude에게 맡기기"(채팅 탭으로 가서 `업데이트 뒤 충돌난 수정을 고쳐줘` 를 입력칸에 채운다)
  - 그림: "원본이 바뀐 그림 n장"과 "보기"(이미지 화면, 문제 있음 필터), "새 그림 n장"
  - 판단 필요: "새 묶음 n개"와 "보기"
  - 경고가 있으면 목록
  - 아래: "새·바뀐 문장 번역 맡기기"(용어집이 확정돼 있으면 `job.translate()`), "이 업데이트 되돌리기"(확인 창 "이 업데이트 뒤에 한 번역과 수정도 함께 사라져요" → `update.rollback`)
- 항목 탭: `previous` 가 있으면 "이전 버전의 문장" 상자: 이전 원문과 지금 원문을 위아래로 놓고 바뀐 부분을 강조(`changedWords`. 지워진 부분은 `--err-bg`, 더해진 부분은 `--accent-bg`), 이전 번역, 버튼 "이전 번역 가져오기"(편집 칸에 넣는다. 저장은 사용자가 한다). `carried` 면 "문장부호만 달라서 이전 번역을 넣어 뒀어요. 확인하고 승인하세요."
- `project:reloaded` 를 받으면 상태를 새 스냅숏으로 통째로 바꾸고 선택과 필터를 비운다.

**시험이 확인할 것:**
- 대화상자: 폴더를 고르면 `update.inspect` 가 불리고 버전 이름 칸이 채워진다. `sameGame: false` 면 이유가 보이고 체크 전에는 "가져오기"가 꺼져 있다
- "가져오기" → `update.import('<경로>', '1.1')`. 실패하면 오류 글자와 "프로젝트는 그대로예요"
- 결과 화면에 일곱 카드의 숫자가 요약대로 나온다. 충돌 목록에 제목과 이유가 있다
- "바뀐 문장 보기" → 텍스트 화면이고 필터가 `changed`
- "이 업데이트 되돌리기"는 확인을 누른 뒤에만 `update.rollback`
- 항목 탭: `previous` 가 있는 줄에 이전 원문과 이전 번역이 보이고, 바뀐 글자만 강조 요소 안에 있다. "이전 번역 가져오기"가 편집 칸을 그 글로 채우되 `unit.setTranslation` 은 부르지 않는다
- `project:reloaded` 뒤 표의 줄이 새 스냅숏의 것이다

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 새 버전 가져오기 화면"`

### Task 8: 남겨 둔 것 마무리

**Files:** Modify `src/renderer/components/ChatPanel.tsx`, `StatusBar.tsx`, `SettingsView.tsx`, `src/main/ipc.ts`, `src/shared/api.ts`, `src/main/buildNotes.ts` · Test `tests/renderer/claudeGuide.test.tsx`, 기존 시험에 추가

- **Claude CLI 안내**(이 앱을 받은 다른 사람을 위해): `app.claudeStatus()` → `{ found: boolean; path: string | null; loggedIn: boolean | null }`(`claude auth status` 를 실행해 JSON 의 `loggedIn` 을 읽는다. 실행에 실패하거나 5초 안에 안 끝나면 `loggedIn: null`). 채팅 탭에 CLI 가 없으면 안내 상자: "채팅과 자동 번역은 Claude CLI 가 있어야 해요. 본인의 Claude 구독으로 동작해요." / 1. 터미널에서 `winget install Anthropic.ClaudeCode` / 2. 터미널에서 `claude` 를 실행해 로그인 / "다시 확인" 버튼. CLI 는 있는데 `loggedIn: false` 면 2번만 보인다. 추출, 손 번역, 빌드는 CLI 없이도 된다는 한 줄. 아래 상태 줄의 글도 `Claude CLI 없음` / `로그인 필요` / `Claude CLI 연결됨` 세 가지로
- **폰트에 없는 글자 수**: 계획 5가 계산만 하고 보여 주지 않는 값(`lastFontEmbed`)을 설정의 "폰트를 게임에 넣기" 구역에 "지난 빌드: 폰트 n KB · 이 폰트에 없는 글자 k개"로 보인다(k 가 0이 아니면 `--warn`)
- **빌드가 실패했을 때 남는 폴더**: 계획 7의 패치노트 기여자가 `builds/NNN/` 에 먼저 써서, 그 뒤 빌드가 실패하면 manifest 없는 폴더가 남는다. `ProjectService.build()` 가 실패하면 manifest 가 없는 그 번호의 폴더를 지운다. `builds.list` 는 manifest 가 없는 폴더를 건너뛴다(이미 그렇다면 시험만 더한다)
- **패치노트에 게임 버전**: `formatNotes` 의 머리에 지금 버전의 `label` 을 넣는다(`<이름> 한국어 패치 빌드 3 (게임 1.1)`). 지난 빌드와 게임 버전이 다르면 첫 줄에 "게임 <label> 에 맞춤"을 더한다

**시험이 확인할 것:**
- CLI 가 없을 때 안내 상자와 두 단계가 보이고 "다시 확인"이 `app.claudeStatus` 를 부른다. `loggedIn: false` 면 로그인 단계만, 다 되면 상자가 없다
- 상태 줄의 세 가지 글
- 설정에 "이 폰트에 없는 글자 3개"가 보인다
- 빌드가 실패하면(기여자 하나가 던지게 한다) 그 번호의 폴더가 없고, 다음 빌드가 같은 번호를 쓴다
- 패치노트 머리에 `(게임 1.1)`, 버전이 바뀐 빌드에 "게임 1.1 에 맞춤"

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: Claude CLI 안내와 남은 마무리"`

### Task 9: 전체 흐름 시험과 문서

**Files:** Modify `tests/e2e/app.e2e.test.ts`, `README.md`, `CHANGELOG.md`, `CLAUDE.md`("아직 없는 것"에서 끝난 항목을 지운다)

- [ ] **연기 시험**: v1 게임 가져오기 → 문장 두 개 손으로 번역 → 이벤트 화면에서 한 줄 끼워 넣기 → 패치 빌드 → "새 버전 가져오기"로 v2 폴더(`MVMZ_PICK_DIR2`) → 버전 이름 확인 → 가져오기 → 결과 화면의 숫자 확인 → "바뀐 문장 보기" → 그 줄에 이전 번역이 보임 → 수정 내역에서 그 수정이 `적용됨` → 패치 빌드 → zip 의 맵 파일에 수정과 이어받은 번역이 둘 다 있음 → "이 업데이트 되돌리기" → 표가 v1 의 문장으로 돌아옴
- [ ] **`npm run build:app && npm run test:e2e` → 실패 확인 후 빠진 연결을 채워 통과**
- [ ] **전체 확인**: `npx vitest run`, 두 tsconfig 의 `tsc --noEmit`, `npm run test:e2e`
- [ ] **문서**: `README.md` 에 "게임 업데이트" 절(흐름, `backups/`, `updates/`, `original/<버전>/`), `CHANGELOG.md` 의 "준비 중" 아래에 "게임 업데이트" 묶음과 "Claude CLI 안내", 알려진 한계에서 해당 줄 지우기, `CLAUDE.md` 의 "아직 없는 것" 갱신
- [ ] **`git commit -m "feat: 게임 업데이트 전체 흐름 시험"`**

---

## 이 계획이 끝난 뒤 사람이 확인할 것

- 실제 게임의 두 버전(예: ver1.02 와 ver1.03)으로 가져와 보고, "바뀐 문장"으로 잡힌 것이 실제로 바뀐 문장인지, 놓친 것은 없는지.
- 업데이트 전에 넣은 버그 수정이 새 버전에서 제자리에 들어가는지 게임을 켜서 확인.
- 되돌리기를 한 번 해 보고 번역이 그대로인지.
