# MV/MZ 번역 작업실 · 계획 5: 이벤트와 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임의 이벤트를 읽기 쉬운 글로 보고, 스위치·변수가 어디서 쓰이는지 찾고, 버그 수정과 기능 추가를 "원본 대비 바뀐 점"으로 기록해 패치에 넣는다. 고른 폰트를 게임에 내장하고, 패치를 적용한 게임을 앱에서 바로 실행해 본다.

**Architecture:** 수정은 `patches.json` 에 목록으로 쌓인다. 이벤트 수정은 원본 커맨드 목록에 대한 연산(끼워 넣기, 지우기, 바꾸기)으로 저장하고, 빌드 때 원본 커맨드마다 "원래 번호" 꼬리표를 붙인 뒤 수정을 먼저 적용하고 번역을 꼬리표로 찾아 적용한다(수정으로 번호가 밀려도 번역이 제자리에 들어간다). 폰트 내장과 새 파일 추가는 빌드 기여자(`ProjectService.buildContributors`)로 들어간다.

**Tech Stack:** 계획 4와 같고, 런타임 의존성 `subset-font` 하나를 더한다(폰트에서 쓰는 글자만 남기기).

**Spec:** `docs/2026-11-13-mvmz-번역작업실-기획서.md` (4.7, 4.9의 게임 실행), 화면 기준 `docs/mockup/Main.dc.html`(이벤트 화면, 수정 내역 화면). 먼저 `CLAUDE.md` 를 읽는다.

## 병렬 작업 규칙 (중요)

이 계획은 계획 7(이미지와 패치노트)과 **동시에, 서로 다른 작업 폴더에서** 구현된다.
- 이 계획이 주로 고치는 곳: `src/core/events/*`(새로), `src/core/patches/*`(새로), `src/core/build/apply.ts`, `src/main/gameRun.ts`·`src/main/fontEmbed.ts`(새로), `src/renderer/components/EventView.tsx`·`PatchView.tsx`(새로).
- `src/core/build/patch.ts` 는 건드리지 않는다. 패치에 파일을 더할 때는 `ProjectService.buildContributors` 에 등록한다.
- 여러 계획이 같이 쓰는 파일(`src/shared/api.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/main/projectService.ts`, `src/main/toolHandlers.ts`, `src/main/claude/args.ts`, `src/main/claude/prompt.ts`, `src/renderer/state.ts`, `Sidebar.tsx`, `App.tsx`, `TopBar.tsx`, `SettingsView.tsx`, `theme.css`, `tests/renderer/fakeApi.tsx`, `tests/e2e/app.e2e.test.ts`, `README.md`, `CHANGELOG.md`)은 **추가만** 한다. 기존 줄을 옮기거나 정리하지 않는다. 새 항목은 관련 목록의 **맨 끝**에 붙인다. 목록 중간의 닫는 괄호 앞에 끼워 넣어야 할 때는 자기 블록을 통째로(여는 줄부터 닫는 줄까지) 넣어, 다른 쪽이 같은 자리에 넣은 블록과 줄이 섞이지 않게 한다.
- 계획 7의 영역(`src/core/images/*`, `src/core/notes/*`, `src/main/render/*`, `ImageView.tsx`, `BuildsView.tsx`)은 만들거나 건드리지 않는다.
- 포매터나 정렬 도구를 저장소 전체에 돌리지 않는다.

## Global Constraints

- 계획 1~4의 공개 이름은 바꾸지 않고 추가만 한다. 기존 시험(372개)은 계속 통과해야 한다. 도구 목록을 전부 나열한 기존 단언은 늘어난 만큼 고쳐도 된다.
- 원본 게임 폴더에는 쓰지 않는다. 게임 실행은 프로젝트 폴더 안의 시험용 사본에서만 한다. 사본을 만들 때 원본 파일을 지우거나 고치지 않는다.
- 수정이 하나도 없으면 빌드 결과는 지금과 바이트 단위로 같아야 한다.
- 수정의 대상(이벤트 페이지의 원본 목록, 원본 파일)이 기록했을 때와 달라졌으면 그 수정은 적용하지 않고 "충돌"로 표시한다. 엉뚱한 자리에 끼워 넣지 않는다.
- 사용자에게 보이는 글과 마지막 보고는 한국어. 코드 식별자와 주석은 영어, 커밋 메시지는 한국어.
- 시스템에 프로그램 설치가 필요하거나 버전이 맞지 않으면 우회하지 말고 멈춰서 보고한다. `npm install` 로 프로젝트 안에 들어가는 것은 괜찮다.
- 커밋은 작업마다 한 번, 이 작업 폴더의 브랜치에.

## Review Focus

1. **수정으로 번호가 밀린 뒤의 번역 적용**: 대사 앞에 커맨드를 끼워 넣거나 앞의 커맨드를 지워도, 그 뒤 대사의 번역과 선택지 번역이 제자리에 들어간다. 번역이 걸린 커맨드 자체를 지운 수정이면 그 번역은 조용히 건너뛴다. → 작업 3
2. **게임이 업데이트되지 않았는데 충돌로 뜨는 일**: 원본 목록의 비교는 JSON 의 공백이나 키 순서가 아니라 내용으로 한다(같은 내용이면 같은 해시). → 작업 2
3. **시험용 사본이 원본을 바꾸는 일**: 사본의 세이브, 설정 파일은 원본과 이어지지 않은 독립 파일이다. 게임이 사본에서 세이브를 써도 원본 폴더의 해시는 그대로다. → 작업 6
4. **폰트에 없는 글자**: 쓰는 글자만 남길 때, 번역문뿐 아니라 숫자·영문·문장부호·전각 기호와 수정으로 넣은 글자도 포함한다. 폰트에 원래 없는 글자는 건너뛰고 몇 개인지 알린다. → 작업 5
5. **모르는 커맨드 코드**: 풀어쓰기 표에 없는 코드(플러그인이 쓰는 값 포함)는 `코드 999 [원래 인자]` 로 보이고 예외가 나지 않는다. 그런 커맨드가 있는 목록도 수정할 수 있다. → 작업 1

---

## 공용 타입 (작업 2에서 만든다)

```ts
// src/core/patches/types.ts
export type ListOp =
  | { op: 'insert'; after: number; commands: EventCommand[] }   // after: 원본 번호. -1 이면 맨 앞
  | { op: 'delete'; at: number }                                  // at: 원본 번호
  | { op: 'replace'; at: number; commands: EventCommand[] };
export interface EventCommand { code: number; indent: number; parameters: unknown[] }
export type PatchBody =
  | { kind: 'event'; file: string; listPath: PathSeg[]; baseHash: string; ops: ListOp[] }
  | { kind: 'json'; file: string; path: PathSeg[]; baseValue: unknown; value: unknown }
  | { kind: 'plugin'; name: string; js: string; parameters: Record<string, string>; description: string }  // 새 플러그인 파일 + plugins.js 끝에 등록
  | { kind: 'font'; fontPath: string; subset: boolean };
export interface Patch {
  id: string; title: string; note: string; enabled: boolean; originalBug: boolean;
  createdBy: 'user' | 'claude'; createdAt: string; body: PatchBody;
}
export type PatchState = 'applied' | 'disabled' | 'conflict';
export interface PatchStatus { id: string; state: PatchState; reason?: string }
```

---

### Task 1: 이벤트 풀어쓰기

**Files:** Create `src/core/events/describe.ts`, `src/core/events/names.ts` · Test `tests/events/describe.test.ts`

**Interfaces:**
- Produces: `interface NameTable { switches: string[]; variables: string[]; actors: string[]; items: string[]; weapons: string[]; armors: string[]; skills: string[]; states: string[]; commonEvents: string[]; maps: Record<number, string>; troops: string[]; enemies: string[] }`, `loadNames(projectDir): Promise<NameTable>`(원본 사본에서. 없는 파일은 빈 목록)
- Produces: `describeCommand(cmd: EventCommand, n: NameTable): string`, `describeList(list: EventCommand[], n: NameTable): { index: number; indent: number; text: string; code: number }[]`
- `describeList` 는 이어지는 줄을 합친다: `101` 뒤의 `401` 들은 한 줄(`대사 [화자] 첫 줄 / 둘째 줄`. 화자는 MZ 의 `parameters[4]`), `105`+`405`, `355`+`655`, `108`+`408`, `357`+`657`(657 은 버린다). 합친 줄의 `index` 는 첫 커맨드의 번호. `code 0`(빈 줄)은 내보내지 않는다

풀어쓰기 문구(이름이 있으면 `번호 [이름]`, 없으면 번호만):

| code | 문구 예 |
|---|---|
| 101+401 | `대사 [리나] 첫 줄 / 둘째 줄` |
| 102 | `선택지: 좋아 / 다음에` |
| 402 | `└ "좋아" 를 고르면` · 403 `└ 취소하면` · 404 `선택지 끝` |
| 103 | `숫자 입력 → 변수 5 [이름], 3자리` · 104 `아이템 고르기 → 변수 5 [이름]` |
| 105+405 | `스크롤 문장: 첫 줄 / 둘째 줄` |
| 108+408 | `주석: …` |
| 111 | `만약 스위치 12 [이름] 이 켜짐이면` / `만약 변수 5 [이름] ≥ 3 이면`(비교: `=` `≥` `≤` `>` `<` `≠`) / `만약 셀프 스위치 A 가 켜짐이면` / `만약 액터 1 [이름] 이 파티에 있으면` / `만약 아이템 3 [이름] 을 가졌으면` / `만약 스크립트: …` / 그 외 `만약 (조건 종류 n)` |
| 411 | `아니면` · 412 `조건 끝` |
| 112 | `반복` · 413 `반복 끝` · 113 `반복 빠져나가기` · 115 `이벤트 처리 끝내기` |
| 117 | `커먼이벤트 4 [이름] 실행` |
| 118 | `라벨 "이름"` · 119 `라벨 "이름" 으로 이동` |
| 121 | `스위치 12 [이름] = 켬`(범위면 `스위치 12~14 = 끔`) |
| 122 | `변수 5 [이름] = 3` / `+= 1` / `-=` `*=` `/=` `%=`. 값이 변수면 `변수 6 [이름]`, 난수면 `난수 1~6`, 스크립트면 `스크립트: …`, 그 외 `(게임 데이터)` |
| 123 | `셀프 스위치 A = 켬` |
| 125 | `소지금 +100` · 126 `아이템 3 [이름] +1` · 127 무기 · 128 방어구 · 129 `파티에 액터 1 [이름] 넣기`/`빼기` |
| 201 | `장소 이동 맵 5 [이름] (12, 8)`(변수 지정이면 `장소 이동 (변수로 지정)`) |
| 203 | `이벤트 위치 바꾸기` · 205 `이동 경로 설정` · 210 `이동 끝날 때까지 기다리기` |
| 211 | `투명 상태 켬/끔` · 214 `이벤트 일시 삭제` |
| 221 | `화면 페이드아웃` · 222 `화면 페이드인` · 223 `화면 색조 바꾸기` · 224 `화면 번쩍임` · 225 `화면 흔들기` |
| 230 | `기다리기 60프레임` |
| 231 | `그림 표시 1번: 파일이름` · 232 `그림 이동 1번` · 235 `그림 지우기 1번` |
| 241 | `BGM 재생: 이름` · 242 `BGM 페이드아웃` · 245 `BGS 재생: 이름` · 249 `ME 재생: 이름` · 250 `SE 재생: 이름` · 261 `영상 재생: 이름` |
| 301 | `전투: 적 무리 3 [이름]` · 302 `상점 열기` · 303 `이름 입력: 액터 1 [이름]` |
| 311~318 | `HP 증감` `MP 증감` `상태 변경` `전체 회복` `경험치 증감` `레벨 증감` `능력치 증감` `스킬 증감` (대상은 생략) |
| 320 | `액터 1 [이름] 의 이름을 "…" 로` · 322 `액터 그림 바꾸기` |
| 351 | `메뉴 열기` · 352 `저장 화면 열기` · 353 `게임 오버` · 354 `타이틀로 돌아가기` |
| 355+655 | `스크립트: 첫 줄 / 둘째 줄` |
| 356 | `플러그인 커맨드: …` |
| 357 | `플러그인 커맨드: 플러그인이름 · 커맨드이름 { 인자: 값, … }` |
| 그 외 | `코드 999 [JSON 으로 쓴 인자]`(120자에서 자르고 `…`) |

**시험이 확인할 것:**
- 시험용 게임의 맵 이벤트 목록 → `['대사 [リナ] あれ？\\N[1]じゃない！ / こんな夜に来るなんて', '선택지: いいよ / また今度', '└ "いいよ" 를 고르면', '대사 [リナ] やった！', '└ "また今度" 를 고르면', '선택지 끝', '플러그인 커맨드: ShowRecord 記録']`(MZ). 번호는 `[0, 3, 4, 5, 8, 10, 11]`, 들여쓰기는 원본 그대로
- `{ code: 121, parameters: [45, 45, 0] }` 에 `switches[45] = '기록1 완료'` → `스위치 45 [기록1 완료] = 켬`. `[12, 14, 1]` → `스위치 12~14 = 끔`
- `{ code: 122, parameters: [12, 12, 1, 0, 1] }` 에 `variables[12] = '시간대'` → `변수 12 [시간대] += 1`
- `{ code: 111, parameters: [1, 5, 0, 3, 1] }` → `만약 변수 5 ≥ 3 이면`. `{ code: 111, parameters: [0, 12, 0] }` → `만약 스위치 12 이 켜짐이면`
- `{ code: 201, parameters: [0, 5, 12, 8, 0, 0] }` 에 `maps[5] = '숲'` → `장소 이동 맵 5 [숲] (12, 8)`
- `{ code: 999, parameters: ['x', 1] }` → `코드 999 ["x",1]`. 인자가 배열이 아니어도 예외가 없다
- 이름이 빈 글이면 대괄호를 붙이지 않는다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 이벤트 풀어쓰기"`

### Task 2: 수정 저장과 목록 연산

**Files:** Create `src/core/patches/types.ts`, `store.ts`, `listOps.ts`, `hash.ts` · Modify `src/core/index.ts` · Test `tests/patches/listOps.test.ts`

**Interfaces:**
- Produces: `listHash(list: unknown): string` — 내용 기준 sha1(객체의 키를 정렬해 직렬화). 공백과 키 순서에 영향받지 않는다
- Produces: `tagList(list: EventCommand[]): TaggedCommand[]`(각 커맨드에 숨은 꼬리표 `__o: 원본 번호`), `untagList(list): EventCommand[]`, `indexOfOrigin(list: TaggedCommand[], origin: number): number`(없으면 -1)
- Produces: `applyOps(tagged: TaggedCommand[], ops: ListOp[]): TaggedCommand[]` — 원본 번호로 자리를 찾는다. 끼워 넣은 커맨드에는 꼬리표가 없다. 같은 `after` 에 여러 번 끼워 넣으면 적힌 순서대로 놓인다. 없는 번호를 가리키는 연산은 `Error('수정이 가리키는 줄이 없습니다: <번호>')`
- Produces: `validateOps(list: EventCommand[], ops: ListOp[]): string | null` — 문제를 한국어 한 줄로(범위 밖 번호, 같은 번호를 지우고 또 바꿈, `commands` 의 모양이 틀림). 문제없으면 null
- Produces: `loadPatches(projectDir): Promise<Patch[]>`, `savePatches(projectDir, p)` → `patches.json`, `newPatchId(): string`

**시험이 확인할 것:**
- `listHash` 가 키 순서만 다른 두 목록에 같은 값을, 인자 하나가 다른 목록에 다른 값을 준다
- 5개짜리 목록에 `insert after 1`(2개) → 길이 7, 순서 `[0,1,새,새,2,3,4]`. `indexOfOrigin(결과, 3)` → 5
- `delete at 2` → 길이 4, `indexOfOrigin(결과, 2)` → -1, `indexOfOrigin(결과, 4)` → 3
- `replace at 0` 으로 2개 → 맨 앞 2개가 새 것, 꼬리표 없음
- `insert after -1` → 맨 앞. 같은 `after` 두 번 → 적힌 순서
- 연산 여러 개가 서로의 번호에 영향을 주지 않는다(`insert after 1` 과 `delete at 3` 을 어느 순서로 적어도 결과가 같다)
- `validateOps`: `at: 99` → 범위 밖 메시지, 같은 번호 `delete` + `replace` → 메시지, 정상 → null
- `untagList` 뒤에 `__o` 가 어디에도 없다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 수정 저장과 목록 연산"`

### Task 3: 수정을 빌드에 적용

**Files:** Create `src/core/patches/apply.ts` · Modify `src/core/build/apply.ts` · Test `tests/patches/applyPatches.test.ts`

**Interfaces:**
- Produces: `patchStatuses(projectDir, patches: Patch[]): Promise<PatchStatus[]>` — 꺼져 있으면 `disabled`. `event`: 원본의 그 목록이 없거나 `listHash` 가 `baseHash` 와 다르면 `conflict`(이유 `원본 이벤트가 기록했을 때와 달라졌어요` / `원본에 그 이벤트가 없어요`), `validateOps` 가 문제를 주면 `conflict`. `json`: 원본의 그 값이 `baseValue` 와 내용이 다르면 `conflict`. `plugin`: 같은 이름의 플러그인 파일이 원본에 이미 있으면 `conflict`(`같은 이름의 플러그인이 이미 있어요`). `font`: 파일이 없으면 `conflict`(`폰트 파일을 찾을 수 없어요`)
- `applyTranslationsDetailed(projectDir, units, store, o?: { decisions?; patches?: Patch[] })` 를 넓힌다:
  1. 데이터 파일을 읽은 뒤, 그 파일의 모든 이벤트 커맨드 목록에 꼬리표를 붙인다(`patches` 가 있고 그 파일을 건드리는 `applied` 상태의 수정이 하나라도 있을 때만. 없으면 지금 경로 그대로).
  2. `applied` 상태의 `event` 수정을 `applyOps` 로 적용한다.
  3. 번역의 `lines` ref 와 `choice` ref 는 번호 대신 `indexOfOrigin` 으로 자리를 찾는다. 찾지 못하면(지워졌거나 바뀜) 그 ref 는 건너뛴다. `lines` 묶음의 줄 일부만 남았으면 그 묶음도 건너뛴다. `value` ref 가 이벤트 목록 안을 가리키면(경로에 `list` 다음 번호) 그 번호도 꼬리표로 바꿔 찾는다.
  4. `applied` 상태의 `json` 수정을 `setAtPath` 로 적용한다(번역 적용 뒤. 같은 자리에 번역이 있어도 수정 값이 이긴다).
  5. 꼬리표를 뗀 뒤 직렬화한다.
  - 수정만 있고 번역이 없는 파일도 결과에 들어간다.
  - `plugin` 수정: `js/plugins.js` 의 목록 끝에 `{ name, status: true, description, parameters }` 를 더한 글을 결과에 넣는다(플러그인 설정 번역이 이미 그 파일을 바꿨으면 그 위에). 플러그인 JS 파일 자체는 작업 5의 기여자가 넣는다.
- `buildPatch` 는 `patches.json` 을 직접 읽지 않는다. `ProjectService.build()` 가 수정 목록을 넘기도록 **작업 4에서** 연결한다. 이 작업에서는 `applyTranslationsDetailed` 의 선택 인자까지만 만든다. `buildPatch` 가 그 인자를 넘길 수 있게 `BuildOptions` 에 `patches?: Patch[]` 를 더하는 일은 `src/core/build/patch.ts` 를 고쳐야 하므로, 대신 `src/core/patches/apply.ts` 에 `withPatches(patches: Patch[]): void`/전역 상태 같은 우회를 만들지 말고 **여기서 멈추고 보고하지도 말고**, 다음 방법을 쓴다: `applyTranslationsDetailed` 가 `o.patches` 가 없을 때 `<projectDir>/patches.json` 을 스스로 읽는다(`o.patches` 가 주어지면 그것을 쓴다). 이러면 `patch.ts` 를 고칠 필요가 없다

**시험이 확인할 것**(시험용 게임의 맵 이벤트 목록):
- 수정이 없으면 결과가 지금과 글자 하나까지 같다(번역만 있는 경우를 수정 전후로 비교)
- 대사 앞(`after: -1`)에 커맨드 2개를 끼워 넣어도 대사·선택지 번역이 제자리에 들어간다(계획 1의 "줄 수가 늘어도" 시험과 같은 번역을 쓰고, 결과 목록의 맨 앞에 새 커맨드 2개가 있는지와 그 뒤가 그 시험의 기대값과 같은지 본다)
- 목록 끝에 `{ code: 121, parameters: [45, 45, 0] }` 를 끼워 넣는 수정만 있고 번역이 없어도 `data/Map001.json` 이 결과에 있다
- 번역이 걸린 대사의 `401` 을 `delete` 하면 그 대사 번역은 건너뛰고 다른 번역은 들어간다. 예외가 없다
- `baseHash` 가 다른 수정은 적용되지 않고(`patchStatuses` 가 `conflict`), 결과는 수정이 없는 것과 같다
- `json` 수정으로 `System.json` 의 `advanced.fontSize` 를 바꾸면 결과에 반영되고, `baseValue` 가 원본과 다르면 `conflict`
- `plugin` 수정 → `js/plugins.js` 의 목록 끝에 새 항목이 있고 앞부분(`var $plugins =` 와 기존 항목들)은 그대로
- 꺼진 수정은 적용되지 않는다
- 결과 어디에도 `__o` 가 없다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 수정을 빌드에 적용"`

### Task 4: 사용처 검색과 이벤트 읽기

**Files:** Create `src/core/events/usage.ts`, `src/core/events/browse.ts` · Test `tests/events/usage.test.ts`

**Interfaces:**
- Produces: `interface EventRef { file: string; listPath: PathSeg[]; label: string; index: number; text: string; access: 'read' | 'write' }`
- Produces: `findUsage(projectDir, target: { type: 'switch' | 'variable' | 'commonEvent' | 'item' | 'picture'; id: number | string }): Promise<EventRef[]>` — 맵, 커먼이벤트, 전투 이벤트의 모든 목록과 이벤트 페이지 조건, 커먼이벤트의 자동 실행 스위치를 훑는다. 스위치: `121` 은 write, `111`(종류 0)과 페이지 조건·커먼이벤트 스위치는 read(조건은 `index: -1`, `text: '페이지 조건'`). 변수: `122`(대상 범위에 들면 write, 값으로 쓰면 read), `111`(종류 1), `103`·`104`(write), 페이지 조건. 커먼이벤트: `117`. 아이템: `126`(write), `111`(종류 8), 페이지 조건. 그림: `231` 의 파일 이름이 `id` 와 같은 것. `text` 는 `describeCommand` 의 글, `label` 은 `맵4 · 이벤트3 · 2페이지` 같은 위치
- Produces: `listEvents(projectDir, file: string): Promise<{ key: string; label: string; listPath: PathSeg[]; pages?: number; condition: string | null; commandCount: number }[]>`(맵은 이벤트의 페이지마다 하나, 커먼이벤트·전투 이벤트는 항목마다), `readEvent(projectDir, file, listPath): Promise<{ label: string; condition: string | null; hash: string; lines: { index: number; indent: number; text: string; code: number }[]; raw: EventCommand[] }>`, `eventFiles(projectDir): Promise<{ file: string; label: string; events: number }[]>`(맵은 `MapInfos` 의 이름과 함께 `맵4 [이름]`)
- 페이지 조건의 글은 계획 4의 `src/main/story.ts` 에 이미 있다. 그 로직을 `src/core/events/names.ts` 로 **복사**해 쓰고(`describeConditions(conditions, n: NameTable): string | null`), `story.ts` 는 건드리지 않는다(계획 4 영역은 아니지만 같이 쓰는 파일도 아니므로 그대로 둔다). 두 곳이 같은 글을 내는지 시험 하나로 확인한다

**시험이 확인할 것:**
- 시험용 게임에 `121 [45,45,0]`(맵1 이벤트1), `111 [0,45,0]`(커먼이벤트1), 페이지 조건 `switch1Id: 45`(맵1 이벤트 2)를 넣으면 `findUsage({ type: 'switch', id: 45 })` 가 3개를 주고 `access` 가 `write`, `read`, `read`, 라벨이 각각 맞다
- 변수: `122 [12,12,1,0,1]` → write, `122 [5,5,0,1,12]`(값이 변수 12) → read
- `findUsage({ type: 'picture', id: '立ち絵' })` 가 `231` 을 찾는다
- `listEvents('data/Map001.json')` 이 페이지마다 한 줄, `readEvent` 의 `hash` 가 `listHash(raw)` 와 같다
- `null` 이벤트와 빈 목록에서 예외가 없다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 사용처 검색과 이벤트 읽기"`

### Task 5: 폰트 내장

**Files:** Create `src/main/fontEmbed.ts` · Modify `package.json`(`subset-font`) · Test `tests/main/fontEmbed.test.ts`

**Interfaces:**
- Produces: `usedCharacters(units, entryOf, patches: Patch[], extra?: string): string` — 번역문 전부 + 수정으로 넣은 커맨드의 문자열 인자 + 기본 글자(ASCII 0x20~0x7E, `0-9`, 자주 쓰는 문장부호와 전각 기호 `…―—─“”‘’「」『』【】（）〈〉《》！？～・♥❤♡★☆♪→←↑↓○●◎△▲▽▼□■※×÷＋－＝％＆＠＃` 와 전각 공백) + `extra`. 중복 없이, 제어문자(`\C[2]` 등)의 글자는 그대로 포함(영문·숫자·기호라 문제없다)
- Produces: `fontPatchFiles(o: { engine: Engine; contentPrefix: string; projectDir: string; fontPath: string; subset: boolean; chars: string }): Promise<{ files: Map<string, string | Uint8Array>; jsonPatch?: { file: string; path: PathSeg[]; value: unknown }; missing: number; bytes: number }>`
  - 폰트 파일 이름은 `mvmz-game-font.<원래 확장자>`(ttf/otf). `subset: true` 면 `subset-font` 로 `chars` 만 남긴다(출력 형식은 원래와 같은 sfnt). 폰트에 없는 글자 수가 `missing`
  - MZ: `<contentPrefix>fonts/mvmz-game-font.ttf` 를 넣고, `System.json` 의 `advanced.mainFontFilename` 을 그 이름으로 바꾸는 `jsonPatch` 를 돌려준다(`numberFontFilename` 은 그대로)
  - MV: 폰트 파일과 함께 `<contentPrefix>fonts/gamefont.css` 를 넣는다: 원본 사본에 `fonts/gamefont.css` 가 있으면 그 안의 `GameFont` `@font-face` 블록의 `src` 만 `url("mvmz-game-font.ttf")` 로 바꾸고, 없으면 `@font-face { font-family: GameFont; src: url("mvmz-game-font.ttf"); }` 한 블록을 쓴다. 원본 사본에 그 파일이 없을 수 있으므로 `ensureOriginals`(계획 3b)가 `fonts/gamefont.css` 도 챙기게 `src/core/project/originals.ts` 에 한 줄을 더한다
- Produces: `registerFontContributor(svc: ProjectService): void` — `svc.buildContributors` 에 기여자를 더한다. `applied` 상태의 `font` 수정이 있을 때만 파일을 주고, MZ 의 `jsonPatch` 는 그 빌드의 `changed` 에 있는 `data/System.json`(없으면 원본 사본)에 적용해 `<contentPrefix>data/System.json` 으로 덮어쓴다. `plugin` 수정의 JS 파일(`<contentPrefix>js/plugins/<name>.js`)도 이 기여자가 넣는다

**시험이 확인할 것**(계획 4의 `makeTestFont` 로 만든 작은 폰트):
- `usedCharacters` 에 번역문의 한글, `0-9`, `…`, `♥`, 수정으로 넣은 대사의 글자가 있다. 중복이 없다
- `subset: true` → 결과 폰트를 `opentype.js` 로 읽으면 `chars` 에 있던 글자만 있고, 파일이 원본보다 작다. `subset: false` → 바이트가 원본과 같다
- 폰트에 없는 글자 3개를 `chars` 에 넣으면 `missing: 3`
- MZ: 파일 키가 `fonts/mvmz-game-font.ttf`, `jsonPatch` 가 `advanced.mainFontFilename`. 기여자를 거친 빌드의 zip 에서 `System.json` 의 그 값이 바뀌어 있고, 같은 빌드의 `gameTitle` 번역도 살아 있다
- MV(`www`): 키가 `www/fonts/…`, `gamefont.css` 의 `GameFont` 블록 `src` 만 바뀌고 다른 `@font-face` 블록은 그대로. 원본에 css 가 없으면 한 블록짜리 파일
- `font` 수정이 꺼져 있거나 없으면 기여자가 빈 Map 을 준다
- `plugin` 수정의 JS 가 `js/plugins/<name>.js` 로 들어간다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 폰트 내장"`

### Task 6: 게임 실행

**Files:** Create `src/main/gameRun.ts` · Test `tests/main/gameRun.test.ts`

**Interfaces:**
- Produces: `class GameRunner { constructor(o: { projectDir: string; gameDir: string; spawn?: typeof import('node:child_process').spawn }); prepare(patchDir: string, onProgress?: (done: number, total: number) => void): Promise<{ copied: number; linked: number; patched: number }>; launch(): Promise<void>; readonly running: boolean; stop(): void; on('exit', cb) }`
- 사본 위치: `<projectDir>/testplay/`. `prepare` 의 규칙:
  - 원본 게임 폴더의 파일마다: `img/`, `audio/`, `movies/`, `effects/` 아래와 최상위의 `.exe`·`.dll`·`.pak`·`.bin`·`.dat` 와 `locales/`·`swiftshader/` 아래 파일은 하드 링크(`fs.link`)로 만든다. 하드 링크가 실패하면(다른 드라이브 등) 복사한다
  - 그 외(`data/`, `js/`, `fonts/`, `css/`, `save/`, 설정 파일, `index.html`, `package.json` 등)는 복사한다. `save/` 는 사본에 이미 있으면 덮어쓰지 않는다(시험 플레이의 세이브를 지키려고). 원본의 세이브를 사본으로 가져오는 것은 처음 만들 때 한 번만
  - 이미 사본에 있고 크기와 수정 시각이 원본과 같은 파일은 건너뛴다
  - 그다음 `patchDir`(가장 최근 빌드의 `patch/`) 의 파일을 사본 위에 복사해 덮어쓴다. 하드 링크로 이어진 파일 위에 덮어쓸 때는 **먼저 사본 쪽 파일을 지운 뒤** 새로 쓴다(원본까지 바뀌지 않게)
  - 지난번 `prepare` 가 덮어쓴 파일 중 이번 패치에 없는 것은 원본에서 다시 가져온다(`testplay/.patched.json` 에 지난 목록을 적어 둔다)
- `launch`: 사본의 `Game.exe`(없으면 최상위의 `nw.exe`, 그것도 없으면 `Error('실행 파일을 찾을 수 없습니다(Game.exe)')`)를 사본 폴더를 작업 폴더로 해 실행한다. 이미 실행 중이면 `Error('게임이 이미 실행 중입니다')`

**시험이 확인할 것**(가짜 `spawn`, 임시 폴더의 가짜 게임):
- `prepare` 뒤 사본에 모든 파일이 있고, `img/` 아래 파일은 원본과 같은 inode(하드 링크), `data/` 아래는 다른 파일이다
- 패치의 `data/Items.json` 이 사본에 덮어써지고 원본은 그대로다
- 패치에 `img/pictures/a.png` 가 있으면 사본의 그 파일만 바뀌고 원본의 `a.png` 는 바이트가 그대로다(링크를 끊고 썼는지)
- 사본의 `save/file1.rpgsave` 를 고친 뒤 다시 `prepare` 해도 그 세이브가 유지된다. 원본의 세이브는 바뀌지 않는다
- 두 번째 `prepare` 는 바뀌지 않은 파일을 다시 복사하지 않는다(`copied` 가 0에 가깝다)
- 지난 패치에 있던 파일이 이번 패치에 없으면 사본의 그 파일이 원본 내용으로 돌아온다
- `prepare` 전후로 원본 폴더의 해시가 같다
- `launch` 가 사본의 `Game.exe` 를 사본 폴더에서 실행한다. 두 번 부르면 두 번째는 오류. `Game.exe` 가 없으면 오류 글자

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 게임 실행"`

### Task 7: ProjectService, IPC, 채팅 도구 연결

**Files:** Modify `src/main/projectService.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/api.ts`, `src/main/toolHandlers.ts`, `src/main/claude/args.ts`, `src/main/claude/prompt.ts` · Test `tests/main/patchOps.test.ts`

**Interfaces:**
- `ProjectService`: `patches(): Patch[]`, `patchStatuses(): Promise<PatchStatus[]>`, `addPatch(p: { title: string; note?: string; originalBug?: boolean; body: PatchBody }, by: 'user' | 'claude'): Promise<Patch>`(검증: `event` 는 지금 원본으로 `validateOps` 와 `baseHash` 를 확인하고, `baseHash` 가 비어 있으면 지금 값으로 채운다. 같은 목록에 켜진 `event` 수정이 이미 있으면 `Error('이 이벤트에는 이미 수정이 있습니다. 그 수정을 고치세요')`), `updatePatch(id, patch: Partial<Pick<Patch, 'title' | 'note' | 'enabled' | 'originalBug'>> & { body?: PatchBody })`, `removePatch(id)`, `setGameFontPatch(fontPath: string | null, subset: boolean)`(`font` 수정은 프로젝트에 하나만. null 이면 지운다), `'patches-changed'` 이벤트. 열 때 `registerFontContributor(this)` 를 부른다
- IPC(`window.api`, 목록 끝에): `events.files()`, `events.list(file)`, `events.read(file, listPath)`, `events.usage(target)`, `patches.list()` → `{ patches: Patch[]; statuses: PatchStatus[] }`, `patches.add(p)`, `patches.update(id, p)`, `patches.remove(id)`, `patches.setGameFont(fontPath, subset)`, `patches.creatorReport()` → 원본 버그로 표시된 수정들을 마크다운 글로(제목, 위치, 무엇을 왜 바꿨는지, 풀어쓴 연산), `game.run()`(가장 최근 빌드가 없으면 `Error('먼저 패치를 빌드하세요')`. 있으면 `prepare` → `launch`), `game.stop()`, `on('patches:changed')`, `on('game:state')` → `{ state: 'idle' | 'preparing' | 'running'; done?: number; total?: number }`
- 채팅 도구 5개 추가(끝에): `event_files`(없음 → 파일 목록), `event_list`(`file`), `event_read`(`file`, `listPath` → 라벨, 조건, 해시, 풀어쓴 줄들. 원본 JSON 은 주지 않는다. `raw: true` 를 주면 `index` 범위(`from`, `to`, 최대 30줄)의 원본 커맨드를 준다), `usage_search`(`type`, `id`), `event_patch`(`title`, `file`, `listPath`, `baseHash`, `ops`, `note?`, `originalBug?` → 수정을 `by: 'claude'` 로 더한다. 같은 목록에 수정이 있으면 그 수정의 `ops` 를 바꾼다). 채팅 시스템 프롬프트에 더할 글: "이벤트를 고칠 때는 event_read 로 풀어쓴 글과 해시를 받고, 필요한 줄만 raw 로 원본을 본 뒤, event_patch 로 원본 번호 기준의 연산을 낸다. 원본을 통째로 다시 쓰지 않는다. 버그의 원인을 찾을 때는 usage_search 로 스위치와 변수가 어디서 켜지고 읽히는지부터 본다. 게임 원본의 결함을 고친 것이면 originalBug 를 true 로 한다."

**시험이 확인할 것:**
- `addPatch` 로 `event` 수정을 넣으면 `patches.json` 에 저장되고, 빌드 결과의 그 맵 파일에 끼워 넣은 커맨드가 있다. `'patches-changed'` 가 나간다
- 틀린 `baseHash` → `Error('원본 이벤트가 기록했을 때와 달라졌어요')` 로 거절. `baseHash` 를 비우면 채워진다
- 같은 목록에 두 번째 수정 → 오류. 첫 수정을 끄면 두 번째를 넣을 수 있다
- 수정을 끄면 다음 빌드에서 빠진다
- `setGameFontPatch` 가 `font` 수정을 하나만 유지한다(두 번 부르면 바뀐다, null 이면 없어진다)
- 채팅 도구: `event_read` 가 풀어쓴 줄과 해시를 주고 `raw` 없이 원본 JSON 이 없다. `event_patch` 뒤 `patches()` 에 `createdBy: 'claude'` 인 수정이 있다. 같은 목록에 다시 `event_patch` 하면 수정이 늘지 않고 `ops` 가 바뀐다
- `creatorReport` 가 `originalBug` 인 수정만 담고, 풀어쓴 연산 글(`+ 스위치 45 [기록1 완료] = 켬`)이 들어 있다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 수정과 이벤트 연결"`

### Task 8: 이벤트 화면

**Files:** Create `src/renderer/components/EventView.tsx` · Modify `Sidebar.tsx`(작업 메뉴 끝에 "이벤트"), `App.tsx`, `state.ts` · Test `tests/renderer/events.test.tsx`

화면(시안의 이벤트 화면을 따른다):
- 왼쪽: 파일 고르기(`맵4 [이름] · 이벤트 12개`, 커먼이벤트, 전투 이벤트), 그 아래 그 파일의 이벤트 목록(`이벤트 12 · 2페이지`, 조건이 있으면 작게). 검색 칸으로 라벨을 거른다.
- 가운데: 고른 이벤트의 머리(라벨, `조건: …`), 풀어쓴 줄들(고정폭 글꼴, 줄 번호는 원본 번호, 들여쓰기는 `indent` 만큼). 수정이 걸려 있으면: 끼워 넣은 줄은 `--accent-bg` 배경에 앞에 `+`, 지운 줄은 `--err-bg` 배경에 취소선과 `−`, 바꾼 줄은 둘 다 보인다. 아래에 "초록색 줄은 원본에 없던 줄이에요. 수정 내역 '<제목>'으로 기록됐어요."와 그 수정으로 가는 버튼.
- 줄의 스위치·변수·커먼이벤트 이름 부분은 버튼이다: 누르면 오른쪽에 사용처가 뜬다.
- 오른쪽(사용처): `스위치 45 [이름] 를 쓰는 곳 3`, 줄마다 위치 라벨과 `켬`/`조건`(write/read), 누르면 그 이벤트로 이동해 그 줄을 강조한다.
- 줄에 마우스를 올리면 나오는 작은 버튼: "이 줄 아래에 끼워 넣기", "이 줄 지우기". 끼워 넣기는 자주 쓰는 것만 고르는 작은 양식이다: 스위치 켬/끔(번호 고르기), 변수 대입/더하기(번호와 값), 셀프 스위치, 장소 이동(맵, x, y), 화면 페이드인/아웃, 그림 지우기(번호), 커먼이벤트 실행. 고르면 수정 제목을 묻고(`aria-label="수정 제목"`) `patches.add` 또는 같은 목록의 기존 수정에 연산을 더한다(`patches.update`). 그 밖의 수정은 채팅으로 한다는 안내("복잡한 수정은 채팅에서 말로 시키세요")와 "채팅으로 말하기" 버튼(오른쪽 탭을 채팅으로 바꾸고 `이벤트: <라벨>` 을 붙인다. 붙은 이벤트는 채팅 글 앞에 `[이벤트] file=… listPath=… 라벨=…` 로 들어간다)

**시험이 확인할 것:**
- 파일과 이벤트를 고르면 풀어쓴 줄이 원본 번호와 함께 보인다
- 수정이 걸린 이벤트에서 끼워 넣은 줄에 `+` 와 강조가, 지운 줄에 취소선이 있다
- 스위치 이름을 누르면 `events.usage({ type: 'switch', id: 45 })` 가 불리고 결과 3줄이 `켬`/`조건` 과 함께 보인다. 결과를 누르면 그 이벤트가 열린다
- "이 줄 아래에 끼워 넣기" → 스위치 45 켬 → 제목 입력 → `patches.add` 가 `{ kind: 'event', ops: [{ op: 'insert', after: <그 줄 번호>, commands: [{ code: 121, indent: <그 줄의 indent>, parameters: [45, 45, 0] }] }] }` 로 불린다
- 이미 수정이 있는 목록에서는 `patches.update` 로 연산이 더해진다
- "이 줄 지우기" → `{ op: 'delete', at: n }`. 합쳐진 줄(대사)을 지우면 그 묶음의 커맨드가 모두 지워진다(`101` 과 그 `401` 들)

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 이벤트 화면"`

### Task 9: 수정 내역 화면, 폰트 넣기, 게임 실행 버튼

**Files:** Create `src/renderer/components/PatchView.tsx` · Modify `Sidebar.tsx`(끝에 "수정 내역 <수>"), `TopBar.tsx`("게임 실행" 버튼을 "패치 빌드" 왼쪽 옆에 자기 블록으로), `SettingsView.tsx`(게임 폰트 구역 **아래에** 새 구역 "폰트를 게임에 넣기"를 더한다. 계획 4가 만든 구역의 줄은 바꾸지 않는다), `state.ts` · Test `tests/renderer/patches.test.tsx`

화면(시안의 수정 내역 화면을 따른다):
- 수정 내역: 제목, 한 줄 설명, 버튼 "제작자 전달용 목록"(`patches.creatorReport` → 글을 보여 주는 창, "복사"). 목록의 줄마다: 제목(고칠 수 있다), 위치와 요약(`맵3 이벤트12 2페이지 · 줄 1개 추가`, `System.json · advanced.fontSize`, `새 플러그인 KoreanFont.js`, `게임 폰트: <이름>`), 상태 칩(`적용됨` / `꺼짐` / `충돌 · <이유>`), "원본 버그" 체크, 켜고 끄기, "이벤트 보기"(이벤트 수정일 때), 삭제(확인 후). 충돌이면 "Claude에게 맡기기"(채팅 탭으로 가서 `이 수정이 충돌났어: <제목>` 과 그 이벤트를 붙인다).
- 수정이 없으면 "아직 수정이 없어요. 이벤트 화면에서 줄을 끼워 넣거나, 채팅에서 버그를 설명해 보세요."
- 설정의 "폰트를 게임에 넣기": 계획 4에서 고른 폰트가 있으면 그 이름과 "이 폰트를 패치에 넣기" 스위치, "쓰는 글자만 남겨 용량 줄이기"(기본 켜짐), 안내 글 "폰트 파일이 패치에 들어가요. 배포해도 되는 폰트인지 확인하세요(본명조, 본고딕, 나눔 계열, Pretendard 등은 괜찮아요. 윈도우 기본 폰트나 유료 폰트는 안 돼요)." 폰트를 고르지 않았으면 "위에서 게임 폰트를 먼저 고르세요". 스위치를 켜면 `patches.setGameFont(path, subset)`, 끄면 `patches.setGameFont(null, …)`.
- 위 막대 "게임 실행": 누르면 `game.run()`. `preparing` 이면 "게임 준비 중 n / m", `running` 이면 "게임 실행 중"과 "끝내기". 오류(`먼저 패치를 빌드하세요` 등)는 버튼 아래 한 줄. 첫 실행 때는 "시험용 사본을 만들어요. 처음 한 번은 시간이 걸려요."를 준비 중 글 옆에 보인다.

**시험이 확인할 것:**
- 목록에 세 가지 상태 칩이 각각 보이고, 충돌에는 이유가 있다
- 켜고 끄기 → `patches.update(id, { enabled: false })`. "원본 버그" → `{ originalBug: true }`
- "제작자 전달용 목록" → 받은 글이 창에 보인다
- 삭제는 확인을 누른 뒤에만 `patches.remove`
- 폰트 스위치 → `patches.setGameFont('<경로>', true)`. 줄이기를 끄고 켜면 `false`. 폰트가 없으면 스위치가 없고 안내 글이 있다
- "게임 실행" → `game.run`. `game:state` 가 `preparing` 3/10 이면 "게임 준비 중 3 / 10", `running` 이면 "끝내기" 버튼. 오류 글자가 보인다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 수정 내역 화면과 게임 실행"`

### Task 10: 전체 흐름 시험과 실제 CLI 확인

**Files:** Modify `tests/e2e/app.e2e.test.ts`(자기 `test(…)` 블록을 파일 끝에 통째로 더한다. 임시 게임 폴더 이름은 `game5`), `README.md`, `CHANGELOG.md`("준비 중" 아래에 "이벤트와 수정" 묶음을 더하고 알려진 한계의 해당 줄을 고친다) · Create `tests/main/realEventPatch.test.ts`

- [ ] **연기 시험**: 가져오기 → 이벤트 화면에서 맵1 이벤트1 → 풀어쓴 줄 확인 → 한 줄 아래에 "스위치 45 켬" 끼워 넣기 → 수정 내역에 `적용됨` → 패치 빌드 → zip 의 `data/Map001.json` 에 그 커맨드가 있음 → (게임 실행은 `MVMZ_GAME_SPAWN_FAKE=1` 이면 실제로 띄우지 않고 실행한 것으로 친다) 게임 실행 → "게임 실행 중" → 사본 폴더에 패치가 적용돼 있음
- [ ] **`npm run build:app && npm run test:e2e` → 실패 확인 후 빠진 연결을 채워 통과**
- [ ] **실제 CLI 확인**(`MVMZ_REAL_CLI=1`, 로그인 상태에서만, 모델 `claude-haiku-5-5`, 시험용 게임만): 시험용 게임에 "이벤트1이 끝나도 스위치 45를 켜지 않아 이벤트2(조건: 스위치 45)가 시작되지 않는" 상황을 만들고, 채팅 한 번으로 "이벤트1이 끝나도 이벤트2로 안 넘어가. 고쳐줘"를 보낸다. 확인: Claude가 `usage_search` 나 `event_read` 를 부르고 `event_patch` 로 스위치를 켜는 줄을 넣는지, 빌드 결과에 반영되는지. 부른 도구의 순서와 만든 수정, 쓴 토큰을 보고에 그대로 붙인다. 로그인이 아니면 건너뛰고 보고에 적는다
- [ ] **전체 확인**: `npx vitest run`, 두 tsconfig 의 `tsc --noEmit`, `npm run test:e2e`
- [ ] **`git commit -m "feat: 이벤트와 수정 전체 흐름 시험"`**

---

## 이 계획이 끝난 뒤 사람이 확인할 것

- 실제 게임에서 버그 하나를 채팅으로 설명해 고치고, 패치를 빌드해 "게임 실행"으로 확인.
- 폰트를 넣은 패치로 게임을 켜서 한글이 그 폰트로 나오는지, 줄인 폰트에 빠진 글자가 없는지.
- 시험용 사본을 처음 만드는 데 걸리는 시간과, 원본 게임의 세이브가 그대로인지.
