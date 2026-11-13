# MV/MZ 번역 작업실 · 계획 4: 미리보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 번역한 대사가 게임 대사창에서 어떻게 보일지 앱 안에서 바로 보여주고, 줄이 창을 넘치는지를 글자 수가 아니라 실제 폭(픽셀)으로 검사한다. 게임 폰트를 목록에서 골라 미리보기와 넘침 수를 바로 확인할 수 있고, 장면 단위로 대화를 읽는 스토리 보기를 더한다.

**Architecture:** 대사창 치수와 글 배치는 `src/core/preview` 의 순수 함수로 두고, 글자 폭을 재는 함수만 밖에서 넣는다. 메인 프로세스는 폰트 파일을 `opentype.js` 로 읽어 폭을 재고(검사와 넘침 세기), 렌더러는 같은 배치 결과를 실제 폰트(`FontFace`)로 그린다. 폰트를 게임에 넣는 일(패치에 폰트 파일 포함)은 계획 5에서 한다. 이 계획은 고르기, 미리보기, 검사까지다.

**Tech Stack:** 계획 3과 같고, 런타임 의존성 `opentype.js` 하나를 더한다.

**Spec:** `docs/2026-11-13-mvmz-번역작업실-기획서.md` (4.6의 폰트 고르기 부분, 5.1), 화면 기준 `docs/mockup/Main.dc.html`(항목 탭의 "게임 화면 미리보기", 설정의 "게임 폰트", 텍스트의 "스토리").

## 병렬 작업 규칙 (중요)

이 계획은 계획 3b(판단 필요 항목)와 **동시에, 서로 다른 작업 폴더에서** 구현된다. 나중에 합치기 쉽게:
- 이 계획이 주로 고치는 곳: `src/core/preview/*`(새로), `src/main/fonts/*`(새로), `src/main/preview.ts`(새로), `src/renderer/components/GamePreview.tsx`·`FontPicker.tsx`·`StoryView.tsx`(새로).
- 여러 계획이 같이 쓰는 파일(`src/shared/api.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/projectService.ts`, `src/renderer/state.ts`, `Sidebar.tsx`, `App.tsx`, `TextTable.tsx`, `ItemPanel.tsx`, `SettingsView.tsx`, `src/main/settings.ts`, `src/core/types.ts`, `src/core/check/format.ts`)은 **추가만** 한다. 기존 줄을 옮기거나 이름을 바꾸거나 정리하지 않는다. 새 항목은 관련 목록의 **맨 끝**에 붙인다.
- 계획 3b의 영역(`src/core/extract/*`, `src/core/decisions/*`, `src/core/build/*`, `src/core/exchange/*`, `DecisionView.tsx`, `TitleField.tsx`, `ExchangeDialog.tsx`)은 건드리지 않는다.
- 포매터나 정렬 도구를 저장소 전체에 돌리지 않는다.

## Global Constraints

- 계획 1~3의 공개 이름은 바꾸지 않고 추가만 한다. 기존 시험은 계속 통과해야 한다.
- 원본 게임 폴더는 읽기만 한다(폰트 파일, `img/system/Window.png`).
- 미리보기는 흉내다. 화면에 "프로그램이 흉내 내어 그린 화면이에요. 실제 확인은 게임에서 해요."를 항상 보인다.
- 폭 검사는 경고(`warning`)다. 넘쳐도 패치에는 들어간다.
- 폰트 파일은 프로젝트에 복사하지 않고 경로만 기억한다(복사와 게임 내장은 계획 5).
- `.ttc`(폰트 모음 파일)는 이 계획에서 지원하지 않는다. 목록에서 빼고, 폰트 고르기 화면 아래에 "모음 파일(.ttc) n개는 아직 쓸 수 없어요"를 보인다.
- 시스템에 프로그램 설치가 필요하거나 버전이 맞지 않으면 우회하지 말고 멈춰서 보고한다. `npm install opentype.js` 는 괜찮다.
- 커밋은 작업마다 한 번, 이 작업 폴더의 브랜치에.

## Review Focus

1. **폰트에 없는 글자**: 고른 폰트에 그 글자가 없으면(예: 일본어 폰트의 한글) 폭을 0으로 재지 않고 글자 크기만큼(전각 1칸)으로 재며, 미리보기에 "이 폰트에 없는 글자 n개"를 보인다. → 작업 3, 6
2. **제어문자가 폭에 주는 영향**: `\V[n]`, `\N[n]`, `\P[n]`, `\G` 는 실제 글자로 바뀌어 폭을 차지하고, `\I[n]` 은 아이콘 폭, `\{` `\}` 는 그 뒤 글자 크기를 바꾼다. `\C[n]` `\.` `\|` `\!` `\>` `\<` `\^` 는 폭이 0이다. → 작업 2
3. **얼굴 그림이 있는 대사**: 같은 문장이 얼굴 그림이 있는 대사와 없는 대사에 모두 쓰이면, 가장 좁은 폭(얼굴 있는 쪽)으로 검사한다. → 작업 4
4. **폰트 파일이 사라졌을 때**: 기억해둔 경로에 파일이 없으면 폭 검사를 끄고 글자 수 검사로 돌아가며, 설정에 "고른 폰트 파일을 찾을 수 없어요"를 보인다. 앱이 죽지 않는다. → 작업 5
5. **수천 줄의 넘침 세기**: 폰트를 바꿔 볼 때마다 전체 번역을 다시 재도 1초 안에 끝난다(글자별 폭을 기억해 둔다). 7,000개 대사 기준. → 작업 4

---

## 공용 타입 (작업 1에서 만든다)

```ts
// src/core/preview/types.ts
export interface WindowMetrics {
  engine: Engine;
  boxWidth: number;      // 대사창 바깥 폭
  padding: number;       // 창 안쪽 여백(한쪽)
  textPadding: number;   // 글 왼쪽 여백
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  faceIndent: number;    // 얼굴 그림이 있을 때 글이 밀리는 폭
  iconWidth: number;     // \I[n] 이 차지하는 폭
  sizeStep: number;      // \{ \} 한 번에 바뀌는 글자 크기
}
export interface PreviewSettings { fontPath: string | null; fontName: string | null; overrides: Partial<WindowMetrics> }
export type Run =
  | { type: 'text'; text: string; color: number; size: number }
  | { type: 'icon'; index: number; size: number };
export interface LaidLine { runs: Run[]; width: number; overflow: number }   // overflow = 넘친 픽셀(0 이상)
export interface Layout { lines: LaidLine[]; maxWidth: number; available: number; lineOverflow: number; missingGlyphs: number }  // lineOverflow = 넘친 줄 수(maxLines 초과)
export type Measure = (text: string, fontSize: number) => { width: number; missing: number };
export interface PreviewContext { actorNames: Record<number, string>; variables: Record<number, string>; currencyUnit: string; partyNames: Record<number, string> }

// src/core/types.ts 에 추가:  Issue.rule 에 'line-width-px'
```

---

### Task 1: 대사창 치수 알아내기

**Files:** Create `src/core/preview/types.ts`, `src/core/preview/metrics.ts` · Modify `src/core/index.ts` · Test `tests/preview/metrics.test.ts`

**Interfaces:**
- Produces: `DEFAULT_METRICS: Record<Engine, WindowMetrics>`

| | MV | MZ |
|---|---|---|
| boxWidth | 816 | 808 |
| padding | 18 | 12 |
| textPadding | 6 | 8 |
| fontSize | 28 | 26 |
| lineHeight | 36 | 36 |
| maxLines | 4 | 4 |
| faceIndent | 168 | 164 |
| iconWidth | 36 | 36 |
| sizeStep | 12 | 12 |

- Produces: `detectMetrics(projectDir): Promise<WindowMetrics>` — 기본값에서 시작해: MZ 는 `System.json` 의 `advanced.uiAreaWidth`(있으면 `boxWidth = uiAreaWidth - 8`), `advanced.fontSize`. MV 는 `plugins.js` 에서 켜져 있는 `YEP_CoreEngine` 의 `Screen Width`(→ `boxWidth`), `Font Size`, 켜져 있는 `Community_Basic` 의 `screenWidth`. 숫자가 아니거나 0 이하면 무시
- Produces: `availableWidth(m: WindowMetrics, withFace: boolean): number` → `boxWidth - padding * 2 - textPadding * 2 - (withFace ? faceIndent : 0)`
- Produces: `loadPreviewSettings(projectDir)`, `savePreviewSettings(projectDir, s)` → `preview.json`(없으면 `{ fontPath: null, fontName: null, overrides: {} }`), `effectiveMetrics(detected, overrides)`

**시험이 확인할 것:**
- MZ 시험용 게임에서 `System.json` 에 `advanced: { uiAreaWidth: 1280, fontSize: 24 }` 를 넣으면 `boxWidth 1272`, `fontSize 24`. `advanced` 가 없으면 기본값
- MV 에서 `YEP_CoreEngine` 이 `status: true` 이고 `Screen Width: "1280"`, `Font Size: "24"` 면 반영, `status: false` 면 무시, 값이 `"abc"` 면 무시
- `availableWidth(DEFAULT_METRICS.MV, false)` → `768`, `true` → `600`. MZ → `768`, `604`
- `effectiveMetrics` 가 `overrides` 의 값만 덮는다. 설정 저장 후 다시 읽으면 같다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 대사창 치수"`

### Task 2: 글 배치

**Files:** Create `src/core/preview/layout.ts` · Test `tests/preview/layout.test.ts`

**Interfaces:**
- Produces: `layoutMessage(text: string, m: WindowMetrics, measure: Measure, ctx: PreviewContext, o: { withFace: boolean }): Layout`

규칙(줄마다, 왼쪽부터):

| 제어문자 | 처리 |
|---|---|
| `\C[n]` | 그 뒤 글의 색 번호를 n 으로(폭 0). 줄이 바뀌어도 이어진다 |
| `\V[n]` | `ctx.variables[n]` 또는 없으면 `'0'` 으로 바꿔 글로 |
| `\N[n]` | `ctx.actorNames[n]` 또는 없으면 빈 글 |
| `\P[n]` | `ctx.partyNames[n]` 또는 없으면 빈 글 |
| `\G` | `ctx.currencyUnit` |
| `\I[n]` | 아이콘 run, 폭 `iconWidth` |
| `\{` / `\}` | 그 뒤 글자 크기를 `+sizeStep` / `-sizeStep`(MV 는 최소 24·최대 96, MZ 는 최소 12·최대 108). 메시지 끝까지 이어진다 |
| `\\` | 글자 `\` 하나 |
| `\.` `\|` `\!` `\>` `\<` `\^` `\$` 와 모르는 `\영문[…]` | 폭 0, 그리지 않음 |

대소문자를 가리지 않는다. 바꾼 글 안의 제어문자는 다시 풀지 않는다(`\V[1]` 의 값이 `\C[2]` 여도 그대로 글자). 색과 크기가 같은 이웃 글은 한 run 으로 합친다. 줄의 폭은 run 폭의 합, `overflow = max(0, width - availableWidth)`. `lineOverflow = max(0, 줄 수 - maxLines)`. `missingGlyphs` 는 `measure` 가 준 `missing` 의 합. 빈 줄은 run 이 없는 줄(폭 0)로 남긴다.

- Produces: `buildContext(projectDir, entryOf): Promise<PreviewContext>` — `actorNames` 는 `Actors.json` 의 이름(번역이 있으면 번역), `currencyUnit` 은 `System.json` 의 화폐 단위(번역이 있으면 번역), `variables` 는 빈 객체(화면에서 `'0'` 대신 `'123'` 을 넣어 보일 수 있게 호출 쪽이 채운다), `partyNames` 는 `System.json` 의 `partyMembers` 순서대로 그 액터 이름

**시험이 확인할 것**(`measure` 는 글자 하나를 `fontSize` 폭으로 재는 가짜, MV 기본 치수):
- `'가나다'` → 줄 1개, run 1개(color 0, size 28), 폭 84, overflow 0
- `'\\C[2]빨강\\C[0]보통'` → run 2개(color 2 `빨강`, color 0 `보통`), 폭 112
- `'\\V[1]골드'` 에 `variables: { 1: '150' }` → 글 `150골드`, 폭 140. 값이 없으면 `0골드`
- `'\\N[1]야!'` 에 `actorNames: { 1: '리나' }` → `리나야!`
- `'\\I[5]검'` → 아이콘 run 뒤에 글 run, 폭 `36 + 28`
- `'\\{크게\\}보통'` → `크게` 는 size 40, `보통` 은 28, 폭 `80 + 56`. `\{` 를 여섯 번 써도 size 가 96을 넘지 않는다
- `'대기\\.\\|\\!끝'` → 글 `대기끝`, 폭 84
- 28자짜리 줄(폭 784) → overflow 16(`784 - 768`), `withFace: true` 면 184
- 5줄 → `lineOverflow 1`. 빈 줄이 낀 3줄 → 줄 3개, 가운데 줄 폭 0
- 색은 다음 줄로 이어진다: `'\\C[3]첫\n둘'` 의 둘째 줄 run 의 color 가 3
- `measure` 가 `missing: 2` 를 주면 `missingGlyphs 2`

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 대사 배치"`

### Task 3: 폰트 읽기와 목록

**Files:** Create `src/main/fonts/fontFile.ts`, `src/main/fonts/catalog.ts` · Modify `package.json`(`opentype.js`) · Test `tests/main/fonts.test.ts`, `tests/fixtures/fonts/`(아래)

시험용 폰트: 저장소에 재배포할 수 있는 작은 폰트가 필요하다. `@fontsource/ibm-plex-sans-kr` 은 이미 의존성이지만 woff2 뿐이라 `opentype.js` 로 읽을 수 없다. 대신 시험 안에서 `opentype.js` 로 글리프 몇 개(`가`, `나`, `A`, 공백)만 가진 아주 작은 폰트를 만들어 임시 폴더에 `.ttf` 로 저장해 쓴다(`makeTestFont(dir, { name, nameKo?, glyphs })` 시험 도우미). 저장소에 폰트 파일을 넣지 않는다.

**Interfaces:**
- Produces: `interface FontInfo { path: string; family: string; displayName: string; style: string; hasHangul: boolean; source: 'system' | 'user' | 'game' | 'project' }`
- Produces: `readFontInfo(path): Promise<FontInfo | null>` — `displayName` 은 name 표의 한국어 이름(없으면 영어 가족 이름), `style` 은 하위 가족 이름(Regular, Bold 등), `hasHangul` 은 `가`(U+AC00), `힣`(U+D7A3), `뷁`(U+BDC1) 세 글자가 모두 있는지. 읽을 수 없으면 null
- Produces: `class LoadedFont { static load(path): Promise<LoadedFont>; measure: Measure; has(char: string): boolean }` — `measure` 는 글자별 폭(`advanceWidth / unitsPerEm`)을 기억해 두고 `fontSize` 를 곱한다. 없는 글자는 폭 `fontSize`, `missing` 1(공백과 제어 글자는 세지 않는다). 커닝은 적용하지 않는다(게임도 글자를 하나씩 그린다)
- Produces: `listFonts(o: { systemDirs: string[]; gameContentDir?: string; projectFontsDir?: string; cacheFile: string }): Promise<{ fonts: FontInfo[]; skippedCollections: number }>` — 각 폴더의 `.ttf`, `.otf` 를 읽고 `.ttc` 는 세기만 한다. 결과를 `cacheFile` 에 경로·크기·수정 시각과 함께 저장해, 다음에는 바뀐 파일만 다시 읽는다. `displayName` 순 정렬. 게임 폴더는 `fonts/` 아래
- Produces: `systemFontDirs(): string[]` — `%WINDIR%\Fonts`, `%LOCALAPPDATA%\Microsoft\Windows\Fonts`

**시험이 확인할 것:**
- 만든 시험 폰트에서 `displayName` 이 한국어 이름, `hasHangul` 이 false(세 글자가 다 없으므로). 세 글자를 넣어 만든 폰트는 true
- `measure('가A', 20)` 이 두 글자 폭의 합 × 20 / unitsPerEm. `measure('가힣', 20)` 에서 `힣` 이 없으면 그 글자는 폭 20, `missing 1`
- `listFonts` 가 `.ttf` 2개를 주고 `.ttc` 1개를 `skippedCollections` 로 센다. 깨진 파일(내용이 `'x'`)은 목록에 없고 예외도 없다
- 두 번째 호출은 파일을 다시 읽지 않는다(읽기 함수를 감싼 횟수로 확인). 파일 하나의 수정 시각을 바꾸면 그것만 다시 읽는다
- `source` 가 폴더에 따라 `system`/`game`/`project` 로 나온다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 폰트 읽기와 목록"`

### Task 4: 폭 검사와 넘침 세기

**Files:** Create `src/main/preview.ts` · Modify `src/core/check/format.ts`(선택 인자 추가) · Test `tests/main/previewCheck.test.ts`

**Interfaces:**
- `checkTranslation` 에 선택 인자 `px?: { layout: (text: string, withFace: boolean) => Layout; withFace: boolean }` 를 더한다. `dialogue` 종류에서만: 넘친 줄이 있으면 `{ rule: 'line-width-px', severity: 'warning', message: '<k>번째 줄이 창을 <n>px 넘어요' }`(가장 많이 넘친 줄 하나만), `px` 가 있으면 글자 수 검사(`line-width`)는 하지 않는다. 화자 줄 패턴이 있고 MV 면 첫 줄(화자 줄)도 한 줄로 센다(게임에서 실제로 한 줄을 차지한다)
- Produces: `class PreviewService { constructor(svc: ProjectService); init(): Promise<void>; settings(): PreviewSettings; metrics(): WindowMetrics; setFont(path: string | null): Promise<void>; setOverrides(o: Partial<WindowMetrics>): Promise<void>; layoutFor(id: string, text?: string): Layout | null; countOverflow(fontPath?: string | null): Promise<{ overflowing: number; checked: number; missingGlyphs: number }>; fontMissing: boolean }`
- `layoutFor` 는 그 항목의 지금 번역(또는 넘겨준 글)을 배치한다. 번역이 없으면 원문. `withFace` 는 그 항목의 ref 들 중 하나라도 얼굴 그림이 있는 대사면 참: `lines` ref 바로 앞 `101` 커맨드의 `parameters[0]` 이 빈 글이 아닌지를 원본 데이터에서 읽어 한 번 계산해 둔다(`faceMap(projectDir, units): Promise<Record<string, boolean>>`)
- `countOverflow` 는 번역이 있는 `dialogue` 전부를 재서, 넘친 줄이 하나라도 있는 항목 수를 준다. `fontPath` 를 주면 저장하지 않고 그 폰트로만 재 본다(목록에서 올려 볼 때)
- `ProjectService` 에 `setPxChecker(fn | null)` 을 더해, 폰트가 정해지면 `setTranslation` 과 `issues` 가 폭 검사를 쓰게 한다. 폰트를 바꾸면 영향받는 항목들의 변경 알림을 낸다(경고가 바뀌므로)

**시험이 확인할 것:**
- 폰트가 없으면 `layoutFor` 는 null, 검사는 글자 수 방식 그대로
- 폰트를 정한 뒤 창을 넘는 번역을 쓰면 `issues` 에 `line-width-px` 경고가 있고 메시지에 넘친 픽셀 수가 있다. 상태는 `needs-review`(오류가 아님)
- 얼굴 그림이 있는 대사(시험용 게임의 `101` 에 얼굴 이름을 넣은 것)에서는 같은 글이 더 일찍 넘친다. 같은 원문이 얼굴 있는 곳과 없는 곳에 모두 있으면 얼굴 있는 쪽 폭으로 검사한다
- `countOverflow()` 가 넘치는 항목 수를 주고, 더 넓은 글자 폭의 폰트 경로를 주면 수가 늘어난다. 이때 `settings().fontPath` 는 바뀌지 않는다
- 7,000개 대사(시험에서 만들어 낸다)에 대해 `countOverflow` 가 1초 안에 끝난다
- 폰트 파일을 지운 뒤 `init()` → `fontMissing` 이 참이고 검사는 글자 수 방식으로 돌아간다. 예외가 없다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 픽셀 폭 검사와 넘침 세기"`

### Task 5: IPC 연결

**Files:** Modify `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/api.ts`, `src/main/index.ts` · Test `tests/main/previewIpc.test.ts`

**Interfaces**(`window.api`, 모두 목록 끝에 추가):
- `preview.get()` → `{ settings: PreviewSettings; metrics: WindowMetrics; detected: WindowMetrics; fontMissing: boolean; context: PreviewContext }`
- `preview.layout(id, text?)` → `Layout | null`
- `preview.setFont(path | null)`, `preview.setOverrides(o)`, `preview.countOverflow(path?)`
- `preview.windowSkin()` → `Uint8Array | null`(게임의 `img/system/Window.png`. 암호화돼 있으면 풀어서. 없으면 null)
- `fonts.list()` → `{ fonts: FontInfo[]; skippedCollections: number }`, `fonts.bytes(path)` → `Uint8Array`(목록에 있는 경로만 허용. 아니면 오류 `'목록에 없는 폰트입니다'`), `fonts.pickFile()` → 파일 고르기 창으로 고른 폰트를 `user` 로 목록에 더하고 그 `FontInfo` 를 돌려준다(읽을 수 없으면 오류 `'폰트 파일을 읽을 수 없습니다'`)
- `story.scenes(file)` → `SceneInfo[]`, 작업 8에서 정의
- `on('preview:changed', cb)` → `preview.get()` 과 같은 모양

**시험이 확인할 것:**
- 폰트를 정하면 `preview:changed` 가 가고 `preview.layout(id)` 가 배치를 준다
- `fonts.bytes` 가 목록에 없는 경로를 거절한다
- `preview.windowSkin` 이 암호화된 시험용 게임(`makeMiniGame({ encrypted: true })` 에 `Window.png_` 를 `encryptAsset` 으로 만들어 넣는다)에서 PNG 머리 바이트로 시작하는 값을 준다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 미리보기 연결"`

### Task 6: 게임 화면 미리보기

**Files:** Create `src/renderer/components/GamePreview.tsx`, `src/renderer/preview/palette.ts`, `src/renderer/preview/fontFace.ts` · Modify `ItemPanel.tsx`(검사 결과 아래에 끼워 넣는다) · Test `tests/renderer/preview.test.tsx`

**Interfaces:**
- Produces: `DEFAULT_PALETTE: string[]`(32색) — `#ffffff #20a0d6 #ff784c #66cc40 #99ccff #ccc0ff #ffffa0 #808080 #c0c0c0 #2080cc #ff3810 #00a010 #3e9ade #a098ff #ffcc20 #000000 #84aaff #ffff40 #ff2020 #202040 #e08040 #f0c040 #4080c0 #40c0f0 #80ff80 #c08080 #8080ff #ff80ff #00a040 #00e060 #a060e0 #c080ff`
- Produces: `paletteFromSkin(png: Uint8Array): Promise<string[]>` — 캔버스에 그려 색 n 의 위치 `(96 + (n % 8) * 12 + 6, 144 + Math.floor(n / 8) * 12 + 6)` 의 픽셀을 읽는다. 실패하면 `DEFAULT_PALETTE`
- Produces: `ensureFontFace(path: string): Promise<string>` — `fonts.bytes` 로 받아 `FontFace` 로 등록하고 CSS 가족 이름(경로의 해시로 만든 이름)을 돌려준다. 같은 경로는 한 번만 등록
- `<GamePreview unitId text />` — 항목 탭에서 편집 중인 글(`text`)을 150ms 늦춰 `preview.layout(unitId, text)` 로 배치를 받아 그린다

화면(시안의 "게임 화면 미리보기"를 따른다):
- 대사창 상자: 배경 `#141A33`, 테두리 2px `#C9CED8`, 모서리 8px. 안쪽 폭은 실제 `availableWidth` 에 맞춰 항목 탭 폭 안으로 비율을 줄여 그린다(CSS `transform: scale`). 얼굴 그림이 있는 대사면 왼쪽에 `faceIndent` 폭의 회색 네모(얼굴 자리)를 둔다.
- 줄마다 run 을 그 색(팔레트)과 크기로. 아이콘은 테두리만 있는 네모. 넘친 줄은 창 오른쪽 끝에 `--err` 색 세로 점선을 긋고 넘친 부분이 창 밖으로 보이게 한다(잘라내지 않는다).
- `maxLines` 를 넘는 줄은 창 아래에 흐리게(투명도 대신 `--mute` 색) 그리고 "다음 창으로 넘어가요" 표시.
- 아래: 폭 막대(가장 긴 줄 / 쓸 수 있는 폭, 100% 넘으면 `--warn` 색)와 `566 / 540px`, 줄 수 `3 / 4줄`, 없는 글자가 있으면 `이 폰트에 없는 글자 2개`(`--warn`).
- 폰트가 정해지지 않았으면 미리보기 대신 "게임 폰트를 고르면 실제 폭으로 볼 수 있어요"와 "폰트 고르기" 버튼(작업 7의 폰트 고르기를 연다). 폰트 파일이 없어졌으면 "고른 폰트 파일을 찾을 수 없어요".
- 항상 맨 아래 작은 글 "프로그램이 흉내 내어 그린 화면이에요. 실제 확인은 게임에서 해요."
- 변수 예시 값: `\V[n]` 은 `123` 으로 보인다(`context.variables` 가 비어 있으므로 렌더러가 배치를 요청할 때가 아니라, 메인의 `layoutFor` 가 값이 없는 변수를 `'123'` 으로 채워 준다. 작업 4의 `layoutFor` 에 이 규칙을 넣는다. 폭 검사(`countOverflow`, `issues`)에도 같은 값을 쓴다).

**시험이 확인할 것**(jsdom 에는 `FontFace` 와 캔버스가 없으므로 `ensureFontFace` 와 `paletteFromSkin` 은 가짜로 바꾼다):
- 배치의 run 이 색과 크기대로 그려진다(색 2 run 의 글자색이 팔레트 2번)
- 넘친 줄이 있으면 폭 줄에 `566 / 540px` 과 경고 색, 넘침 표시 요소가 있다
- 5줄이면 `5 / 4줄` 과 "다음 창으로 넘어가요"
- `missingGlyphs: 2` 면 "이 폰트에 없는 글자 2개"
- 폰트가 없으면 "폰트 고르기" 버튼이 보이고 미리보기 상자는 없다
- 편집 칸의 글을 바꾸면 그 글로 `preview.layout` 을 다시 부른다(150ms 뒤 한 번)
- 흉내 안내 글이 항상 보인다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 게임 화면 미리보기"`

### Task 7: 폰트 고르기

**Files:** Create `src/renderer/components/FontPicker.tsx` · Modify `SettingsView.tsx`("게임 폰트" 구역을 끝에 추가), `state.ts` · Test `tests/renderer/fontPicker.test.tsx`

화면(시안의 설정 "게임 폰트"와 "인게임 미리보기"를 따른다):
- 왼쪽: 검색 칸(`aria-label="폰트 검색"`), "한글 있는 폰트만"(기본 켜짐), 분류 칩("전체", "게임에 든 폰트", "설치된 폰트", "직접 고른 파일"), 폰트 목록(가상 스크롤). 줄마다 이름을 그 폰트 모양으로 보인다: 줄이 화면에 들어올 때 `ensureFontFace` 로 불러오고, 불러오기 전에는 기본 글꼴로 보인다. 한글이 없는 폰트에는 "한글 없음" 표시. 지금 고른 폰트에 `--accent` 테두리. 아래에 "폰트 파일 직접 고르기"(`fonts.pickFile`), `.ttc` 를 건너뛴 수가 0이 아니면 "모음 파일(.ttc) n개는 아직 쓸 수 없어요".
- 오른쪽: 인게임 미리보기. 대사창(예시 대사 2줄: 프로젝트에서 번역이 있는 대사 중 가장 긴 것 하나를 쓰고, 없으면 "월광초를 3개 모아다 줄래?" / "보답으로 150골드 줄게."), 선택지 창 2개("좋아", "다음에" 또는 프로젝트의 번역된 선택지 2개). 그 아래 "이 폰트로 바꾸면 넘치는 줄 n개"(0이면 "이 폰트로는 넘치는 줄이 없어요"), 없는 글자 안내, 흉내 안내 글.
- 목록의 줄에 마우스를 올리거나 키보드로 옮기면(200ms 늦춰) 오른쪽 미리보기가 그 폰트로 바뀌고 `preview.countOverflow(path)` 결과를 보인다. 누르면 `preview.setFont(path)` 로 정한다. "폰트 정하지 않기"로 되돌릴 수 있다.
- 치수 고치기(접혀 있음, "대사창 치수 고치기"): 대사창 폭, 글자 크기, 줄 높이, 최대 줄 수, 얼굴 그림 밀림 폭. 칸마다 자동으로 알아낸 값을 흐리게 보이고, 고치면 `preview.setOverrides`. "자동 값으로 되돌리기".
- 맨 위 안내: "여기서 고른 폰트는 미리보기와 폭 검사에 쓰여요. 게임에 넣는 기능은 아직 없어요."(계획 5에서 이 글을 바꾼다)

**시험이 확인할 것:**
- "한글 있는 폰트만"이 켜져 있으면 `hasHangul: false` 인 폰트가 목록에 없고, 끄면 "한글 없음" 표시와 함께 나온다
- 검색이 `displayName` 과 `family` 에서 대소문자 무시로 찾는다
- 줄에 마우스를 올리면 200ms 뒤 `preview.countOverflow(그 경로)` 가 불리고 "이 폰트로 바꾸면 넘치는 줄 17개"가 보인다. 이때 `preview.setFont` 는 불리지 않는다
- 줄을 누르면 `preview.setFont(경로)` 가 불린다
- `skippedCollections: 3` 이면 "모음 파일(.ttc) 3개는 아직 쓸 수 없어요"
- 치수 칸을 고치면 `preview.setOverrides({ fontSize: 24 })`, 되돌리기는 `preview.setOverrides({})`

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 폰트 고르기"`

### Task 8: 스토리 보기

**Files:** Create `src/main/story.ts`, `src/renderer/components/StoryView.tsx` · Modify `TextTable.tsx`(위에 "표 | 스토리" 전환을 더하고, 스토리일 때 표 대신 `StoryView` 를 그린다), `state.ts`(`textMode: 'table' | 'story'`) · Test `tests/main/story.test.ts`, `tests/renderer/story.test.tsx`

**Interfaces:**
- Produces(`src/shared/api.ts` 끝에): `interface SceneLine { id: string; kind: UnitKind; order: number; speaker: string | null; choiceGroup?: number }`, `interface SceneInfo { key: string; file: string; label: string; condition: string | null; lines: SceneLine[] }`
- Produces: `buildScenes(projectDir, units: TextUnit[], file: string, pattern: string | null): Promise<SceneInfo[]>` — 그 파일의 항목을 커맨드 목록(`listPath`)별로 묶는다. 한 장면 = 이벤트 페이지 하나(또는 커먼이벤트 하나, 전투 이벤트 페이지 하나). `lines` 는 목록 안의 위치 순(`lines` ref 의 `start`, `choice` ref 의 `index` 와 `choice`, `value` ref 는 경로에 있는 커맨드 번호). 같은 `102` 의 선택지들은 같은 `choiceGroup`. `speaker` 는 `unit.speaker` 또는 화자 줄 패턴에서. 한 항목이 같은 파일의 여러 장면에 쓰이면 장면마다 나온다. `label` 은 `locationLabel` 과 같은 규칙(예 `맵4 · 이벤트3 · 2페이지`)
- `condition`: 맵 이벤트 페이지의 `conditions` 를 글로. `switch1Valid` → `스위치 12 [이름] 켜짐`, `switch2Valid` 도 같게, `variableValid` → `변수 5 [이름] ≥ 3`, `selfSwitchValid` → `셀프 스위치 A 켜짐`, `itemValid` → `아이템 [이름] 가짐`, `actorValid` → `액터 [이름] 있음`. 여러 개면 ` · ` 로 잇는다. 이름은 `System.json` 의 `switches`/`variables` 와 Items/Actors 에서. 조건이 없으면 null. 커먼이벤트는 `trigger` 가 1·2 이고 `switchId` 가 있으면 `스위치 n [이름] 켜짐일 때 자동 실행`

화면(시안의 스토리 보기를 따른다):
- 왼쪽 범위(사이드바)에서 고른 파일의 장면들을 위에서 아래로. 파일을 고르지 않았으면 "왼쪽에서 범위를 고르면 장면이 나와요". 장면이 많으면 가상 스크롤(장면 단위).
- 장면 머리: 라벨, 조건(있으면 고정폭 글꼴로 `조건: …`), 그 장면의 진행(`번역 n / m`), 버튼 "이 장면 다시 번역"(`job.translate(ids)`: 그 장면의 번역 가능한 항목들. 계획 3의 `job.translate` 를 쓴다), "장면 승인"(번역이 있고 오류가 아닌 항목을 모두 `approved` 로. 대상이 없으면 누를 수 없다).
- 줄: 화자 머리글자 동그라미(화자가 없으면 "지문"), 화자 이름(용어집에 번역이 있으면 번역), 원문(작게, `--sub`), 번역(`CodeText`. 없으면 "번역 전"), 상태가 `needs-review`·`error`·`declined` 면 오른쪽에 상태 칩. 고른 줄에 `--accent` 테두리. 누르면 그 항목이 선택되고 오른쪽 항목 탭에 뜬다.
- 선택지: 같은 `choiceGroup` 의 항목을 한 줄에 점선 테두리 칩으로 나란히(번역, 아래에 작게 원문).
- 상태 필터와 검색은 스토리 보기에서도 적용된다: 걸러진 줄이 하나도 없는 장면은 숨긴다.

**시험이 확인할 것:**
- `buildScenes`: 시험용 게임의 맵에서 장면 1개, 줄 순서가 대사 → 선택지 2개(같은 `choiceGroup`) → 대사. `label` 이 `맵1 · 이벤트1`
- 페이지 조건에 `switch1Valid: true, switch1Id: 12` 를 넣고 `System.json` 의 `switches[12]` 가 `森の入口到着` 이면 `condition` 이 `스위치 12 [森の入口到着] 켜짐`. 두 조건이면 ` · ` 로 이어진다
- 화면: 전환 버튼으로 표와 스토리가 바뀌고, 범위를 고르지 않았으면 안내 글이 보인다
- 장면 머리에 조건과 `번역 1 / 4` 가 보인다. 줄을 누르면 그 id 가 선택된다
- 선택지 두 개가 한 묶음 안에 나란히 있다
- "장면 승인"이 번역이 있고 오류가 아닌 항목들에 대해서만 `unit.setStatus(id, 'approved')` 를 부른다. "이 장면 다시 번역"이 그 장면의 id 들로 `job.translate` 를 부른다
- 상태 필터를 "미번역"으로 하면 미번역 줄이 없는 장면이 사라진다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 스토리 보기"`

### Task 9: 전체 흐름 시험과 화면 확인

**Files:** Modify `tests/e2e/app.e2e.test.ts`, `README.md`

- [x] **연기 시험 추가**: 시험 안에서 `opentype.js` 로 한글 몇 글자가 든 시험 폰트를 만들어 임시 폴더에 두고(`MVMZ_FONT_DIRS` 환경 변수가 있으면 `systemFontDirs` 대신 그 폴더들을 쓴다), 가져오기 → 설정의 게임 폰트에서 그 폰트 고르기 → 텍스트 화면에서 긴 번역 쓰기 → 항목 탭 미리보기에 넘침 표시와 `px` 수치가 보임 → 검사 결과에 "창을 …px 넘어요" → 스토리로 전환 → 장면과 선택지가 보임
- [x] **`npm run build:app && npm run test:e2e` → 실패 확인 후 빠진 연결을 채워 통과**
- [x] **실제 폰트로 눈 확인**: 앱을 띄워 이 컴퓨터에 설치된 한글 폰트 하나(예: 맑은 고딕 `malgun.ttf`)를 고르고, 미리보기 화면과 폰트 고르기 화면, 스토리 보기 화면을 캡처해 공유 노트 폴더에 저장한다. 미리보기의 글자 폭이 폭 수치와 눈으로 맞는지(막대가 100%일 때 글이 창 끝에 닿는지) 확인하고, 어긋나면 원인을 찾아 고친다
- [x] **전체 확인**: `npx vitest run`, 두 tsconfig 의 `tsc --noEmit`, `npm run test:e2e`
- [x] **`README.md` 에 미리보기와 폰트, 새 파일(`preview.json`)을 적고 `git commit -m "feat: 미리보기 전체 흐름 시험"`**

---

## 이 계획이 끝난 뒤 사람이 확인할 것

- 실제 게임에서 같은 대사를 게임 화면과 미리보기로 나란히 놓고, 줄이 끝나는 자리가 비슷한지(기본 대사창을 쓰는 게임 기준).
- 대사창을 바꾸는 플러그인을 쓰는 게임에서 치수를 손으로 고쳐 맞출 수 있는지.
- 폰트 목록에 쓰고 싶은 폰트가 나오는지(`.ttc` 로만 깔린 폰트가 많은지).
