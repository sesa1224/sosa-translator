# MV/MZ 번역 작업실 · 계획 7: 이미지와 패치노트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게임 그림 속 글자를 번역한다. 프로그램이 글자가 있을 만한 그림을 추려 모음판으로 보여 주면 Claude가 골라 "작업 지시서"(지울 영역, 넣을 문장, 폰트, 크기, 색)를 쓰고, 프로그램이 그 지시서대로 그림을 찍어 패치에 넣는다. 폰트나 문장을 바꾸면 Claude 없이 다시 찍힌다. 빌드마다 패치노트를 자동으로 기록한다.

**Architecture:** 그림을 그리는 일은 화면에 보이지 않는 Electron 창(렌더 작업 창)의 캔버스로 한다(네이티브 이미지 라이브러리를 쓰지 않는다). 지시서는 `images.json` 에 저장하고, 빌드 기여자가 지시서대로 찍은 PNG(원본이 암호화돼 있었으면 같은 키로 다시 암호화)를 패치에 넣는다. 패치노트는 빌드 때마다 번역표의 요약본을 남겨 지난 빌드와 비교해 만든다.

**Tech Stack:** 계획 4와 같다. 새 런타임 의존성 없음.

**Spec:** `docs/2026-11-13-mvmz-번역작업실-기획서.md` (4.6, 4.9), 화면 기준 `docs/mockup/Main.dc.html`(이미지 화면, 수정 내역 화면 아래의 패치노트 상자). 먼저 `CLAUDE.md` 를 읽는다.

## 병렬 작업 규칙 (중요)

이 계획은 계획 5(이벤트와 수정)와 **동시에, 서로 다른 작업 폴더에서** 구현된다.
- 이 계획이 주로 고치는 곳: `src/core/images/*`(새로), `src/core/notes/*`(새로), `src/main/render/*`(새로), `src/main/images.ts`·`src/main/buildNotes.ts`(새로), `src/renderer/render-worker/*`(새로), `src/renderer/components/ImageView.tsx`·`BuildsView.tsx`(새로).
- `src/core/build/patch.ts` 와 `src/core/build/apply.ts` 는 건드리지 않는다. 패치에 파일을 더할 때는 `ProjectService.buildContributors` 에 등록한다.
- 여러 계획이 같이 쓰는 파일(`src/shared/api.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/main/projectService.ts`, `src/main/toolHandlers.ts`, `src/main/claude/args.ts`, `src/main/claude/prompt.ts`, `src/main/bridge.ts`, `src/mcp/server.ts`, `src/renderer/state.ts`, `Sidebar.tsx`, `App.tsx`, `TopBar.tsx`, `SettingsView.tsx`, `theme.css`, `electron.vite.config.ts`, `tests/renderer/fakeApi.tsx`, `tests/e2e/app.e2e.test.ts`, `README.md`, `CHANGELOG.md`)은 **추가만** 한다. 기존 줄을 옮기거나 정리하지 않는다. 새 항목은 관련 목록의 **맨 끝**에 붙인다. 목록 중간의 닫는 괄호 앞에 끼워 넣어야 할 때는 자기 블록을 통째로 넣어 다른 쪽 블록과 줄이 섞이지 않게 한다.
- 계획 5의 영역(`src/core/events/*`, `src/core/patches/*`, `src/main/gameRun.ts`, `src/main/fontEmbed.ts`, `EventView.tsx`, `PatchView.tsx`)은 만들거나 건드리지 않는다.
- 포매터나 정렬 도구를 저장소 전체에 돌리지 않는다.

## Global Constraints

- 계획 1~4의 공개 이름은 바꾸지 않고 추가만 한다. 기존 시험(372개)은 계속 통과해야 한다. 도구 목록을 전부 나열한 기존 단언은 늘어난 만큼 고쳐도 된다.
- 원본 게임 폴더는 읽기만 한다. 푼 그림과 찍은 그림은 프로젝트 폴더 안(`images/`)에만 둔다.
- 지시서가 없는 그림은 패치에 들어가지 않는다. 그림이 하나도 없으면 빌드 결과는 지금과 같다.
- 찍은 그림은 원본과 같은 가로세로 크기, PNG. 원본이 암호화 파일이었으면 같은 확장자와 키로 다시 암호화해 같은 경로에 넣는다.
- Claude에게 그림을 보낼 때는 긴 변이 1,568px 을 넘지 않게 줄인다(토큰을 아끼려고). 모음판 한 장도 같다.
- 사용자에게 보이는 글과 마지막 보고는 한국어. 코드 식별자와 주석은 영어, 커밋 메시지는 한국어.
- 시스템에 프로그램 설치가 필요하거나 버전이 맞지 않으면 우회하지 말고 멈춰서 보고한다.
- 커밋은 작업마다 한 번, 이 작업 폴더의 브랜치에.

## Review Focus

1. **원본 그림이 바뀌었을 때**: 지시서를 쓴 뒤 원본 그림의 내용이 달라지면(게임 업데이트) 그 그림은 "원본이 바뀜"으로 표시하고, 사용자가 확인하기 전에는 패치에 넣지 않는다. → 작업 2, 6
2. **폰트 파일이 없어졌을 때**: 지시서의 폰트가 없으면 그 그림은 찍지 않고 "폰트 없음"으로 표시하며, 다른 그림과 빌드는 계속된다. → 작업 4, 6
3. **아주 큰 그림과 아주 많은 그림**: 4096×4096 그림 한 장, 그림 3,000장인 게임에서 목록이 멈추지 않는다(썸네일은 필요할 때 만들고 디스크에 남긴다. 한 번에 다 읽지 않는다). → 작업 1, 8
4. **글이 영역보다 클 때**: 문장이 영역 폭을 넘으면 자동으로 줄을 바꾸고, 그래도 높이를 넘으면 넘친 채로 찍되 화면에 "영역을 넘쳐요"를 보인다(글자를 몰래 줄이지 않는다). → 작업 3
5. **렌더 작업 창이 죽었을 때**: 찍는 도중 창이 죽으면 다시 띄워 한 번 더 시도하고, 또 실패하면 그 그림만 실패로 남긴다. 앱이 멈추지 않는다. → 작업 4

---

## 공용 타입 (작업 2에서 만든다)

```ts
// src/core/images/types.ts
export interface Rect { x: number; y: number; w: number; h: number }      // 원본 그림의 픽셀 좌표
export interface Region {
  id: string;
  rect: Rect;
  erase: 'none' | 'fill' | 'sample';      // sample = 영역 테두리 바로 바깥의 색을 평균 내 채운다
  fillColor?: string;                      // erase 'fill' 일 때 '#rrggbb' 또는 '#rrggbbaa'
  text: string;                            // '\n' 으로 줄바꿈. 빈 글이면 지우기만 한다
  fontPath: string | null;                 // null = 프로젝트 기본 이미지 폰트
  size: number;                            // px
  color: string;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  lineHeight: number;                      // 배수. 기본 1.25
  bold: boolean;
  stroke: { color: string; width: number } | null;   // 글자 테두리
  shadow: { color: string; dx: number; dy: number; blur: number } | null;
  source?: string;                         // 원래 적혀 있던 글(Claude가 읽은 것). 용어집 검사와 기록용
}
export type ImageStatus = 'todo' | 'done' | 'manual' | 'skip';   // manual = 사용자가 직접 고친 PNG 를 쓴다
export interface ImageRecipe { file: string; baseHash: string; regions: Region[]; status: ImageStatus; manualFile?: string; note?: string }
export interface ImagesFile { defaultFontPath: string | null; recipes: Record<string, ImageRecipe> }   // 키 = file
export interface ImageEntry {
  file: string;                // contentDir 기준, 풀린 이름으로. 예 'img/pictures/menu.png'
  sourceFile: string;          // 실제 파일. 예 'img/pictures/menu.png_'
  encrypted: boolean; width: number; height: number; bytes: number; hash: string;   // hash = 풀린 PNG 의 sha1
  usedByEvents: number;        // 그림 표시(231) 커맨드에서 쓰인 횟수
  status: ImageStatus | 'none'; problem?: 'base-changed' | 'font-missing' | 'render-failed';
}
```

---

### Task 1: 그림 목록과 풀기

**Files:** Create `src/core/images/types.ts`, `src/core/images/catalog.ts` · Modify `src/core/index.ts` · Test `tests/images/catalog.test.ts`

**Interfaces:**
- Produces: `IMAGE_FOLDERS = ['img/pictures', 'img/titles1', 'img/titles2', 'img/system', 'img/parallaxes']`(기본 대상. 설정으로 바꿀 수 있게 인자로도 받는다)
- Produces: `scanImages(game: GameInfo, o?: { folders?: string[] }): Promise<{ file: string; sourceFile: string; encrypted: boolean; bytes: number; mtimeMs: number }[]>` — `.png`, `.png_`, `.rpgmvp` 를 찾고 하위 폴더도 본다. `file` 은 `.png` 로 끝나는 풀린 이름. 파일 내용은 읽지 않는다
- Produces: `readImage(game: GameInfo, sourceFile: string): Promise<Uint8Array>` — 암호화돼 있으면 풀어서 PNG 바이트로. PNG 머리 바이트가 아니면 `Error('PNG 파일이 아닙니다: <파일>')`
- Produces: `pngSize(png: Uint8Array): { width: number; height: number }`(IHDR 에서 읽는다)
- Produces: `pictureUsage(projectDir): Promise<Record<string, number>>` — 원본 사본의 모든 이벤트 목록에서 `231` 의 파일 이름별 횟수. 키는 `img/pictures/<이름>.png`
- Produces: `class ImageCatalog { constructor(projectDir: string, game: GameInfo); list(): Promise<ImageEntry[]>; bytes(file: string): Promise<Uint8Array> }` — `list` 는 `scanImages` 결과에 크기·해시를 붙이되, `<projectDir>/images/catalog.json` 에 경로·크기·수정 시각별로 기억해 두고 바뀐 파일만 다시 읽는다. 한 번에 8개씩만 읽는다

**시험이 확인할 것:**
- 시험용 게임에 `img/pictures/a.png`, `img/pictures/sub/b.png`, 암호화한 `img/titles1/c.png_`(`encryptAsset` 으로 만든다), `img/pictures/readme.txt` 를 두면 3개가 나오고 `file` 이 각각 `.png` 이름, `encrypted` 가 맞다
- `readImage` 가 암호화 파일을 풀어 PNG 머리 바이트로 시작하는 값을 준다. 글 파일을 주면 오류
- `pngSize` 가 1×1, 640×480 PNG 에서 맞는 값을 준다(시험 안에서 작은 PNG 를 직접 만든다: `makePng(w, h, rgba)` 도우미를 `tests/helpers/png.ts` 에. `zlib` 로 만든다)
- `pictureUsage` 가 `231` 을 두 번 쓴 그림에 2를 준다
- `list()` 두 번째 호출은 파일을 다시 읽지 않는다. 파일 하나를 바꾸면 그것만 다시 읽고 해시가 달라진다
- 폴더가 없어도 예외 없이 빈 목록

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 그림 목록과 풀기"`

### Task 2: 지시서 저장

**Files:** Create `src/core/images/store.ts` · Test `tests/images/store.test.ts`

**Interfaces:**
- Produces: `loadImages(projectDir): Promise<ImagesFile>`(없으면 `{ defaultFontPath: null, recipes: {} }`), `saveImages(projectDir, f)` → `images.json`
- Produces: `normalizeRegion(r: Partial<Region> & { rect: Rect }, image: { width: number; height: number }): Region` — 빠진 값을 기본값으로(`erase 'sample'`, `text ''`, `fontPath null`, `size 24`, `color '#ffffff'`, `align 'center'`, `valign 'middle'`, `lineHeight 1.25`, `bold false`, `stroke null`, `shadow null`), `id` 가 없으면 만든다, `rect` 를 그림 안으로 자른다(폭이나 높이가 1 미만이 되면 `Error('영역이 그림 밖에 있습니다')`), `size` 는 6~512, 색은 `#rgb`/`#rrggbb`/`#rrggbbaa` 만(아니면 `Error('색 값이 올바르지 않습니다: <값>')`)
- Produces: `recipeProblem(recipe: ImageRecipe, entry: { hash: string } | undefined, fontExists: (path: string) => boolean, defaultFontPath: string | null): ImageEntry['problem'] | undefined` — 그림이 목록에 없거나 `hash` 가 `baseHash` 와 다르면 `'base-changed'`, 글이 있는 영역의 폰트(없으면 기본 폰트)가 null 이거나 파일이 없으면 `'font-missing'`
- Produces: `isBuildable(recipe, problem): boolean` — `status` 가 `done` 이고 문제가 없을 때, 또는 `manual` 이고 `manualFile` 이 있을 때

**시험이 확인할 것:**
- `normalizeRegion({ rect: { x: -5, y: 0, w: 50, h: 20 } }, { width: 30, height: 10 })` → `rect { x: 0, y: 0, w: 30, h: 10 }` 과 위 기본값들
- 그림 밖의 영역, 틀린 색(`'red'`), 범위 밖 크기(3 → 6, 9999 → 512)
- `recipeProblem`: 해시가 다르면 `base-changed`, 폰트 파일이 없으면 `font-missing`, 글이 없는 영역만 있으면 폰트가 없어도 문제없음
- `isBuildable`: `todo` 는 false, `done` + 문제없음은 true, `done` + `base-changed` 는 false, `manual` + `manualFile` 은 true, `skip` 은 false
- 저장하고 다시 읽으면 같다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 이미지 지시서 저장"`

### Task 3: 그리기 계획 (순수 계산)

**Files:** Create `src/core/images/layoutText.ts` · Test `tests/images/layoutText.test.ts`

**Interfaces:**
- Produces: `layoutRegionText(region: Region, measure: (text: string) => number): { lines: { text: string; x: number; y: number; width: number }[]; overflowX: boolean; overflowY: boolean; lineHeightPx: number }` — `measure` 는 그 영역의 폰트·크기·굵기로 잰 폭. 줄바꿈 규칙: `\n` 에서 먼저 나누고, 영역 폭을 넘는 줄은 공백에서 나누되 공백이 없으면(한글 문장) 글자 단위로 나눈다. 닫는 문장부호(`.,!?…」』）)]` 와 조사 한 글자짜리가 아닌 일반 글자)는 줄 맨 앞에 오지 않게 앞 줄에 붙인다(문장부호만. 조사는 처리하지 않는다). `x`, `y` 는 그림 좌표의 기준점(`align` 에 따라 왼쪽·가운데·오른쪽, `y` 는 글자 줄의 가운데). `valign` 에 따라 줄 묶음 전체를 위·가운데·아래에 놓는다. 한 글자가 영역 폭보다 넓으면 `overflowX`, 줄 묶음 높이가 영역 높이보다 크면 `overflowY`
- Produces: `sampleBorderColor(rgba: Uint8ClampedArray, width: number, height: number, rect: Rect): string` — 영역 테두리 바로 바깥 1픽셀 띠의 평균 색을 `#rrggbbaa` 로. 영역이 그림 가장자리에 닿아 바깥이 없는 변은 뺀다. 네 변이 모두 없으면 영역 안쪽 테두리의 평균

**시험이 확인할 것**(`measure` 는 글자당 10):
- 폭 100 영역에 `'가나다라마'` → 한 줄, 가운데 정렬이면 `x = rect.x + 50`
- `'가나다라마바사아자차카타'`(120) → 두 줄(`가나다라마바사아자차`, `카타`)
- `'안녕하세요, 반갑습니다.'` 가 폭에 걸려 `.` 이 다음 줄 맨 앞에 올 상황이면 앞 줄 끝에 붙는다
- `'ab cd ef'` 는 공백에서 나뉜다. 줄 끝의 공백은 버린다
- `'첫\n둘'` → 두 줄. `valign: 'middle'`, 영역 높이 100, 크기 20, 줄 높이 1.5 면 줄 중심이 `rect.y + 35`, `rect.y + 65`
- `align: 'right'` → `x = rect.x + rect.w`
- 줄이 5개인데 높이가 3줄분이면 `overflowY`
- `sampleBorderColor`: 온통 빨강 바탕의 그림에서 가운데 영역 → `#ff0000ff`. 왼쪽 위 구석에 붙은 영역은 오른쪽과 아래 띠만 쓴다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 이미지 글 배치 계산"`

### Task 4: 렌더 작업 창

**Files:** Create `src/renderer/render-worker/index.html`, `src/renderer/render-worker/worker.ts`, `src/main/render/renderService.ts`, `src/preload/render.ts` · Modify `electron.vite.config.ts`(렌더러 입력에 `render-worker`, preload 입력에 `render` 를 끝에 더한다) · Test `tests/main/renderService.test.ts`, `tests/e2e/render.e2e.test.ts`

**Interfaces:**
- Produces: `class RenderService { constructor(o: { createWindow: () => RenderWindowLike }); render(job: RenderJob): Promise<Uint8Array>; sheet(job: SheetJob): Promise<Uint8Array>; thumbnail(png: Uint8Array, maxSide: number): Promise<Uint8Array>; dispose(): void }`
- `RenderJob`: `{ base: Uint8Array; regions: Region[]; fonts: Record<string, Uint8Array>; defaultFontPath: string | null }` → 원본과 같은 크기의 PNG. `SheetJob`: `{ cells: { label: string; png: Uint8Array }[]; columns: number; cellSize: number }` → 격자로 놓은 모음판(칸마다 그림을 비율 유지로 줄여 넣고, 아래에 번호와 라벨을 적는다. 바탕은 어두운 체크무늬라 투명한 그림도 보인다). 모음판의 긴 변이 1,568 을 넘으면 통째로 줄인다
- 작업 창: `show: false`, `webPreferences: { offscreen: false, contextIsolation: true, preload: render.cjs }`. 메인이 `render:job` 을 보내면 작업 창이 캔버스(`OffscreenCanvas`)로 그려 `render:done`(바이트 또는 오류 글자)을 돌려준다. 한 번에 하나씩 차례로. 응답이 30초 안에 없거나 창이 죽으면 창을 새로 만들어 한 번 더 시도하고, 또 실패하면 `Error('그림을 찍지 못했습니다: <이유>')`
- 그리는 순서(`worker.ts`): 원본을 그린다 → 영역마다 지우기(`fill` 은 그 색으로, `sample` 은 `sampleBorderColor` 로 채운다. 채우기 전에 그 영역을 `clearRect` 해서 반투명 색도 정확히 들어가게 한다) → 글(`layoutRegionText` 로 줄을 얻고, 폰트는 `FontFace` 로 바이트에서 불러온다. 그림자 → 테두리(`strokeText`, `lineJoin: 'round'`) → 채우기 순서). 글은 영역 밖으로 넘쳐도 자르지 않는다
- 시험에서는 `createWindow` 를 가짜로 바꿔 메인 쪽 차례·재시도·시간 초과만 확인하고, 실제 그리기는 e2e 에서 확인한다

**시험이 확인할 것:**
- (단위) 작업 두 개를 동시에 넣으면 차례로 하나씩 보내진다. 첫 응답이 오류면 그 작업만 실패한다
- (단위) 창이 응답 없이 죽으면(가짜가 `closed` 를 낸다) 새 창을 만들어 다시 보내고, 두 번째도 죽으면 `그림을 찍지 못했습니다` 오류. 그 뒤의 작업은 정상 처리된다
- (e2e, 앱을 띄워) 빨강 100×60 PNG 에 영역 `{ rect: {10,10,80,40}, erase: 'fill', fillColor: '#0000ff', text: '' }` → 결과 PNG 의 (50,30) 픽셀이 파랑, (2,2) 는 빨강, 크기는 100×60
- (e2e) `erase: 'sample'` → 영역 안이 빨강(바깥 색)으로 채워진다
- (e2e) 시험 폰트(계획 4의 `makeTestFont`, 네모 글리프)로 흰 글 `'가'` 를 찍으면 영역 가운데 픽셀이 흰색이다. `align: 'left'` 면 영역 왼쪽에 흰 픽셀이 있고 오른쪽 끝은 아니다
- (e2e) 모음판: 그림 5장, 3열 → 가로 3칸 세로 2줄 크기의 PNG, 긴 변이 1,568 이하
- e2e 는 결과 PNG 를 `zlib` 로 풀어 픽셀을 읽는다(`tests/helpers/png.ts` 에 `readPng`)

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 렌더 작업 창"`

### Task 5: 이미지 서비스

**Files:** Create `src/main/images.ts` · Test `tests/main/images.test.ts`

**Interfaces:**
- Produces: `class ImageService extends EventEmitter` (`'changed'` → 바뀐 `file` 들)

```ts
constructor(o: { svc: ProjectService; game: GameInfo | null; render: Pick<RenderService, 'render' | 'sheet' | 'thumbnail'>; fontExists?: (p: string) => boolean; readFont?: (p: string) => Promise<Uint8Array> });
list(): Promise<ImageEntry[]>;                         // 목록 + 지시서 상태와 문제
recipe(file: string): ImageRecipe | null;
original(file: string): Promise<Uint8Array>;           // 풀린 원본 PNG
rendered(file: string): Promise<Uint8Array | null>;    // 지시서대로 찍은 것(캐시: images/rendered/<해시>.png, 키 = 원본 해시 + 지시서 내용 + 폰트 경로들의 해시). manual 이면 그 파일
thumbnail(file: string, which: 'original' | 'rendered'): Promise<Uint8Array>;   // 긴 변 256, images/thumbs/ 에 캐시
setRecipe(file: string, regions: (Partial<Region> & { rect: Rect })[], by: 'user' | 'claude'): Promise<ImageRecipe>;   // 정리해 저장, baseHash 는 지금 원본, status 는 지금 값 유지(없으면 'todo')
setStatus(file: string, status: ImageStatus): Promise<void>;
setManual(file: string, pngPath: string | null): Promise<void>;   // 크기가 원본과 다르면 Error('직접 고친 그림의 크기가 원본과 달라요(원본 WxH)'). 프로젝트의 images/manual/ 로 복사한다
acceptBase(file: string): Promise<void>;               // 'base-changed' 를 확인하고 baseHash 를 지금 원본으로
setDefaultFont(path: string | null): Promise<void>;
sheet(o: { folder?: string; status?: ImageEntry['status']; page: number; perPage?: number }): Promise<{ png: Uint8Array; items: { n: number; file: string; width: number; height: number; status: string }[]; pages: number }>;   // perPage 기본 20, 5열
view(file: string, which: 'original' | 'rendered'): Promise<{ png: Uint8Array; scale: number }>;   // 긴 변 1,568 이하로 줄인 것. scale = 줄인 비율(지시서 좌표는 원본 기준이라 Claude에게 알려 준다)
buildFiles(contentPrefix: string): Promise<{ files: Map<string, Uint8Array>; skipped: { file: string; reason: string }[] }>;
```

- `buildFiles`: `isBuildable` 인 그림을 찍어(또는 캐시에서) `<contentPrefix><sourceFile>` 키로. 원본이 암호화 파일이었으면 `encryptAsset` 으로 다시 암호화한다. 찍기에 실패한 그림은 `skipped` 로 돌려주고 나머지는 계속한다
- `registerImageContributor(svc, images)`: `svc.buildContributors` 에 `buildFiles` 를 부르는 기여자를 더한다
- 그림 속 글의 용어 검사: `setRecipe` 때 영역의 `source` 가 있으면 계획 3의 `checkGlossary(source, text, terms)` 를 돌려 결과를 지시서의 `note` 에 한 줄로 남긴다(막지는 않는다)

**시험이 확인할 것**(가짜 `render`: 받은 작업을 기록하고 정해진 바이트를 돌려준다):
- `setRecipe` 뒤 `list()` 의 그 그림 `status` 가 `todo`, 지시서의 `baseHash` 가 원본 해시. `'changed'` 가 그 파일로 나간다
- `rendered` 를 두 번 불러도 렌더는 한 번(캐시). 지시서의 글을 바꾸면 다시 찍는다
- 원본 파일을 바꾸면 `list()` 에서 `problem: 'base-changed'`, `buildFiles` 에서 빠지고 `skipped` 에도 없다(문제 있는 것은 처음부터 대상이 아니다). `acceptBase` 뒤에는 들어간다
- 폰트가 없으면 `problem: 'font-missing'` 이고 빌드에서 빠진다. 기본 폰트를 정하면 풀린다
- `status: 'done'` 인 암호화 그림 → `buildFiles` 의 키가 `img/titles1/c.png_` 이고, 값을 `decryptAsset` 하면 렌더가 준 바이트다. MV `www` 면 키 앞에 `www/`
- `setManual` 에 크기가 다른 PNG → 오류 글자에 원본 크기. 같은 크기면 `status` 가 `manual` 이 되고 `buildFiles` 에 그 바이트가 들어간다
- 렌더가 한 그림에서 오류를 내면 그 그림만 `skipped`(이유 포함)이고 다른 그림은 들어간다
- `sheet` 가 20개씩 나누고 `pages` 를 준다. `view` 가 3000×1000 그림에 `scale` 약 0.52 를 준다
- 기여자를 등록한 빌드의 zip 에 그 그림이 들어 있다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 이미지 서비스"`

### Task 6: 채팅 도구에 그림 보내기

**Files:** Modify `src/main/toolHandlers.ts`, `src/main/bridge.ts`, `src/mcp/server.ts`, `src/main/claude/args.ts`, `src/main/claude/prompt.ts` · Test `tests/main/imageTools.test.ts`, `tests/main/realImageTool.test.ts`

**Interfaces:**
- 도구 결과에 그림을 실을 수 있게 넓힌다: `callTool` 의 성공 값에 선택 필드 `images?: { mediaType: 'image/png'; base64: string }[]` 를 더하고, MCP 서버는 그것을 `content` 에 `{ type: 'image', data, mimeType }` 블록으로(글 블록 뒤에) 싣는다. 기존 도구의 결과는 그대로다
- 채팅 도구 5개 추가(목록 끝에): `image_sheet`(`folder?`, `status?`, `page?` → 모음판 그림 1장 + `items`·`pages`), `image_view`(`file`, `which?: 'original' | 'rendered'` → 그림 1장 + `{ width, height, scale }` 원본 크기와 줄인 비율), `image_set_recipe`(`file`, `regions`(원본 픽셀 좌표), `done?: boolean` → 저장하고, `done` 이면 `status: 'done'`. 결과에 정리된 영역과 넘침 여부, 용어 검사 메모), `image_set_status`(`file`, `status: 'todo' | 'done' | 'skip'`), `image_list`(`status?`, `folder?`, `limit?` → 글 목록만. 그림 없음)
- 채팅 시스템 프롬프트에 더할 글: "그림 속 글자를 번역할 때는 image_sheet 로 모음판을 보고 글자가 있는 그림을 고른다. 글자가 없는 그림은 image_set_status 로 skip 한다. 고른 그림은 image_view 로 크게 보고, 글자마다 영역(원본 픽셀 좌표. 받은 그림은 scale 만큼 줄어 있으니 좌표를 scale 로 나눈다), 지우는 방식, 번역문, 크기, 색, 정렬을 image_set_recipe 로 낸다. 낸 뒤 image_view 의 rendered 로 결과를 확인하고 어긋나면 고친다. 배경이 복잡해 깔끔히 지울 수 없는 그림은 억지로 하지 말고 사용자에게 직접 고칠 그림이라고 알린다. 폰트는 사용자가 정한 기본 폰트를 쓰고 fontPath 를 지어내지 않는다."

**시험이 확인할 것:**
- `callTool(svc, 'image_sheet', {})` 의 결과에 `images` 가 1장, `data.items` 에 번호와 파일이 있다
- MCP 클라이언트로 `image_view` 를 부르면 `content` 가 글 블록 다음에 그림 블록(`mimeType: 'image/png'`)이다. 기존 도구 `project_status` 의 `content` 는 글 블록 하나 그대로다
- `image_set_recipe` 에 그림 밖 영역 → `ok: false` 와 오류 글자. 정상이면 지시서가 저장되고 `done: true` 면 상태가 `done`
- `image_set_recipe` 에 `fontPath` 를 줘도 목록(계획 4의 폰트 목록 + 기본 폰트)에 없는 경로면 무시하고 null 로 저장한다
- (실제 CLI, `MVMZ_REAL_CLI=1`, 로그인 상태에서만, 모델 `claude-haiku-5-5`) 시험 안에서 만든 그림(단색 바탕에 큰 흰 네모 하나)을 `image_view` 로 받게 하고 "이 그림에 흰 네모가 몇 개 보여?"에 숫자로 답하게 해, 도구 결과의 그림이 실제로 모델에게 보이는지 확인한다. 보이지 않으면(모델이 그림이 없다고 답하거나 CLI 가 그림 블록을 떨어뜨리면) **여기서 멈추고 보고한다**. 이 계획의 채팅 쪽 전체가 여기에 기댄다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인(실제 CLI 확인 포함) → `git commit -m "feat: 채팅 도구로 그림 보기와 지시서 쓰기"`

### Task 7: 패치노트 기록

**Files:** Create `src/core/notes/snapshot.ts`, `src/core/notes/diff.ts`, `src/main/buildNotes.ts` · Test `tests/notes/diff.test.ts`, `tests/main/buildNotes.test.ts`

**Interfaces:**
- Produces: `interface BuildSnapshot { number: number; createdAt: string; version: string; translations: Record<string, string>; images: Record<string, string>; files: string[]; extras: Record<string, string[]> }` — `translations` 는 id → 번역문 sha1 앞 12자(패치에 들어갈 수 있는 것만: target 이 있고 `error`·`declined` 가 아님), `images` 는 file → 찍은 그림의 해시, `extras` 는 다른 계획이 넣는 요약(키별 글 목록. 예 `patches: ['이벤트1 끝나면 …']`). `takeSnapshot(...)` 과 저장 위치 `builds/NNN/snapshot.json`
- Produces: `diffSnapshots(prev: BuildSnapshot | null, cur: BuildSnapshot, units: TextUnit[]): BuildDiff`

```ts
export interface BuildDiff {
  number: number; previous: number | null;
  newTranslations: number; changedTranslations: number; removedTranslations: number;
  byScope: { label: string; added: number; changed: number }[];      // scopeLabel 별, 많은 순 10개
  newImages: string[]; changedImages: string[];
  addedFiles: string[]; removedFiles: string[];
  extras: Record<string, { added: string[]; removed: string[] }>;
}
```

- Produces: `formatNotes(diff: BuildDiff, meta: { name: string; version: string }): string` — 사람이 읽는 글(한국어). 첫 빌드면 "첫 빌드", 아니면 지난 빌드 대비. 0인 항목은 줄을 내지 않는다
- Produces: `INSTALL_TEXT(o: { contentPrefix: string; name: string }): string` — 설치 방법(압축을 풀어 게임 폴더에 덮어쓰기, 덮어쓰기 전에 원본을 백업, 패치를 지우려면 백업을 되돌리기). MV `www` 면 그 폴더 구조를 설명에 반영
- Produces: `registerNotesContributor(svc, o: { images: ImageService | null })` — 기여자: 스냅숏을 만들고 지난 빌드의 스냅숏과 비교해 `패치노트.txt`(`formatNotes` + 지난 빌드들의 노트를 최신순으로 이어 붙임. 사용자가 다듬은 글이 있으면 그것을 쓴다)와 `설치 방법.txt` 를 zip 최상위에 넣는다. 스냅숏과 `diff.json`, `notes.txt` 를 `builds/NNN/` 에 쓴다. 다른 기여자의 요약을 받을 수 있게 `svc` 에 `buildSummaries: (() => Promise<Record<string, string[]>>)[]`(끝에 추가만 하는 목록)를 더하고 그것들을 `extras` 로 모은다
- Produces: `class NotesJob`(모양은 `TranslateJob` 과 같고 `kind: 'notes'`. `JobKind` 에 `'notes'` 추가): `diff.json` 과 자동 노트를 주고 `runClaudeJson` 으로 다듬은 글을 받아 `builds/NNN/notes.txt` 에 쓴다. 스키마 `{ notes: string }`. 프롬프트: "게임 한국어 패치의 패치노트를 쓴다. 받은 숫자와 목록에 있는 사실만 쓴다. 지어내지 않는다. 사용자가 읽는 짧은 글로, 항목은 줄마다 '- ' 로 시작한다. 버전 제목은 '<이름> 한국어 패치 빌드 <번호>'." 모델은 `settings.stageModels.patchNotes`. 노트가 바뀌면 그 빌드의 zip 을 다시 묶는다(`rezipBuild(projectDir, number, replace: Record<string, string>)` — zip 안의 그 파일만 바꾸고 `manifest.json` 의 sha1 을 맞춘다. `src/main/buildNotes.ts` 안에 둔다)

**시험이 확인할 것:**
- 첫 빌드: `previous: null`, `newTranslations` = 번역 수, 노트에 "첫 빌드"
- 둘째 빌드에서 번역 2개 추가, 1개 수정, 그림 1장 추가 → `newTranslations 2`, `changedTranslations 1`, `newImages` 1개, `byScope` 에 그 파일 라벨
- 0인 항목은 노트에 줄이 없다
- 기여자를 등록한 빌드의 zip 에 `패치노트.txt`, `설치 방법.txt` 가 최상위에 있고, 둘째 빌드의 `패치노트.txt` 에 빌드 2의 글 다음에 빌드 1의 글이 있다
- `buildSummaries` 에 `async () => ({ patches: ['수정 A'] })` 를 넣으면 `extras.patches.added` 에 나온다
- `NotesJob`(가짜 호출)이 받은 글을 `notes.txt` 에 쓰고, zip 을 다시 묶은 뒤에도 zip 검증(파일별 sha1)이 맞다
- MV `www` 의 설치 방법 글에 `www` 가 나온다

- [x] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 패치노트 기록"`

### Task 8: IPC 연결

**Files:** Modify `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/api.ts`, `src/main/projectService.ts` · Test `tests/main/imagesIpc.test.ts`

**Interfaces**(`window.api`, 목록 끝에):
- `images.list()`, `images.recipe(file)`, `images.thumb(file, which)` → `Uint8Array`, `images.full(file, which)` → `Uint8Array | null`, `images.setRecipe(file, regions)`, `images.setStatus(file, status)`, `images.pickManual(file)`(파일 고르기 창 → `setManual`), `images.clearManual(file)`, `images.acceptBase(file)`, `images.setDefaultFont(path | null)`, `images.rerenderAll()`(캐시를 비우고 `done` 인 것을 다시 찍는다. 진행은 `job:progress` 의 `kind: 'images'` 로. `JobKind` 에 추가), `on('images:changed')` → 바뀐 `ImageEntry[]`
- `builds.list()` → `{ number: number; createdAt: string; zipPath: string; files: number; notes: string; diff: BuildDiff | null }[]`(최신순), `builds.setNotes(number, text)`(zip 다시 묶기 포함), `builds.polishNotes(number)`(`NotesJob`), `builds.openFolder(number)`
- 프로젝트를 열 때 `ImageService` 를 만들고 `registerImageContributor`, `registerNotesContributor` 를 부른다. 닫을 때 정리한다. 렌더 작업 창은 처음 필요할 때 만든다

**시험이 확인할 것:**
- 프로젝트를 열고 `images.list` 가 목록을 준다. `images.setRecipe` 뒤 `images:changed` 가 그 그림으로 온다
- `builds.list` 가 빌드 두 번 뒤 2개를 최신순으로 주고 `notes` 와 `diff` 가 있다. `builds.setNotes(2, '고친 글')` 뒤 zip 의 `패치노트.txt` 가 그 글로 시작한다
- 게임 폴더가 없어졌으면(`detectGame` 실패) `images.list` 가 빈 목록과 함께 오류 없이 돌아오고, 빌드는 그림 없이 된다

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 전체 `npx vitest run` 통과 → `git commit -m "feat: 이미지와 빌드 기록 연결"`

### Task 9: 이미지 화면

**Files:** Create `src/renderer/components/ImageView.tsx` · Modify `Sidebar.tsx`(작업 메뉴 끝에 "이미지 <할 것 수>"), `App.tsx`, `state.ts` · Test `tests/renderer/images.test.tsx`

화면(시안의 이미지 화면을 따른다):
- 왼쪽: 필터 칩("전체", "안 본 것", "할 것", "끝남", "직접 고침", "건너뜀", "문제 있음"), 폴더 고르기, 썸네일 격자(가상 스크롤, 화면에 들어올 때 `images.thumb` 로 불러온다). 칸마다 썸네일, 파일 이름, 상태 칩, 이벤트에서 쓰인 횟수(0이 아니면 `이벤트 3곳`).
- 가운데: 고른 그림의 "원본"과 "번역본"을 나란히(창이 좁으면 위아래). 번역본에는 영역마다 점선 테두리(고른 영역은 `--warn` 색). 원본 위에서 끌면 새 영역이 생긴다(그림 좌표로 바꿔 저장). 영역의 모서리를 끌어 크기를, 안쪽을 끌어 위치를 바꾼다. 확대 버튼(맞춤 / 100% / 200%).
- 오른쪽 아래(영역 설정): `선택한 글자 영역 2 / 9`, 문장(여러 줄 입력), 원래 글(`source`, 있으면 흐리게), 지우기 방식(안 지움 / 색으로 채움 / 주변 색으로 채움, 색 채움이면 색 고르기), 폰트(계획 4의 `FontPicker` 를 작은 창으로 띄워 고른다. "기본 폰트 쓰기" 포함), 크기(조절 막대 6~200 과 숫자 칸), 색(색 고르기 + 값), 정렬(왼쪽/가운데/오른쪽, 위/가운데/아래), 줄 높이, 굵게, 테두리(색, 두께), 그림자. 값을 바꾸면 300ms 뒤 저장되고 번역본이 다시 찍힌다. "영역 지우기". 글이 영역을 넘치면 "영역을 넘쳐요"(`--warn`).
- 그림 단위 버튼: "끝남으로 표시"/"다시 할 것으로", "건너뛰기"(글자 없는 그림), "직접 고친 그림 넣기"(`images.pickManual`)와 "직접 고친 그림 빼기", "채팅으로 말하기"(채팅 탭으로 가서 `이미지: <파일>` 을 붙인다. 붙은 그림은 채팅 글 앞에 `[이미지] file=…` 로 들어간다).
- 문제 표시: `base-changed` → "원본 그림이 바뀌었어요. 지시서가 맞는지 확인하세요"와 "확인했어요"(`images.acceptBase`). `font-missing` → "폰트를 찾을 수 없어요"와 폰트 고르기. `render-failed` → 오류 글자와 "다시 찍기".
- 위: "기본 이미지 폰트: <이름>"(바꾸기), "전체 이미지 다시 찍기", 한 줄 안내 "완성된 그림이 아니라 설정을 저장해요. 값을 바꾸면 바로 다시 찍혀요."
- 그림이 하나도 없으면 "이 게임에는 글자가 있을 만한 그림 폴더가 없어요".

**시험이 확인할 것**(썸네일과 그림은 가짜 바이트, `URL.createObjectURL` 은 가짜):
- 필터 칩이 격자를 거른다. 사이드바의 숫자가 `todo` 수다
- 그림을 고르면 원본과 번역본이 보이고 영역 수가 `1 / 2` 처럼 나온다
- 문장을 바꾸면 300ms 뒤 `images.setRecipe(file, [...])` 가 그 글로 한 번 불린다
- 크기 조절 막대, 정렬 버튼, 지우기 방식이 각각 그 값으로 저장을 부른다
- 원본 위에서 (10,10)→(60,40) 으로 끌면(그림이 화면에 0.5 배로 보일 때) 영역 `{ x: 20, y: 20, w: 100, h: 60 }` 이 더해진다
- "끝남으로 표시" → `images.setStatus(file, 'done')`. "건너뛰기" → `'skip'`
- `problem: 'base-changed'` 인 그림에 안내와 "확인했어요" → `images.acceptBase`
- 넘침 정보가 있으면 "영역을 넘쳐요"가 보인다

- [ ] 실패하는 시험 쓰기 → 실패 확인 → 구현 → 통과 확인 → `git commit -m "feat: 이미지 화면"`

### Task 10: 빌드 기록 화면, 전체 흐름 시험

**Files:** Create `src/renderer/components/BuildsView.tsx` · Modify `Sidebar.tsx`(끝에 "빌드 기록"), `App.tsx`, `TopBar.tsx`(빌드 성공 글 옆에 "패치노트 보기"를 자기 블록으로), `SettingsView.tsx`(단계별 모델 구역은 그대로 두고, 설정 끝에 "이미지" 구역: 대상 폴더 목록), `tests/e2e/app.e2e.test.ts`(자기 `test(…)` 블록을 파일 끝에 통째로. 임시 게임 폴더 이름은 `game7`), `README.md`, `CHANGELOG.md`("준비 중" 아래에 "이미지"와 "패치노트" 묶음을 더하고 알려진 한계의 해당 줄을 고친다) · Test `tests/renderer/builds.test.tsx`

화면:
- 빌드 기록: 빌드마다 카드(최신이 위). `빌드 4 · 2026-11-13 21:40 · 파일 21개`, 패치노트 글(편집 칸, 고치고 "저장" → `builds.setNotes`), "Claude에게 다듬기 맡기기"(`builds.polishNotes`, 모델 이름을 옆에 보인다), "폴더 열기", 접힌 "바뀐 점 자세히"(새 번역 n, 고친 번역 n, 범위별 표, 새 그림과 바뀐 그림 목록, 더해진 파일과 빠진 파일).
- 빌드가 없으면 "아직 빌드가 없어요. 위의 패치 빌드를 누르면 여기에 기록이 쌓여요."

- [ ] **단위 시험**: 카드가 최신순, 노트를 고치고 저장 → `builds.setNotes(4, '…')`, 다듬기 → `builds.polishNotes(4)`, 자세히를 펴면 숫자가 보인다
- [ ] **연기 시험**(가짜 채팅 CLI 없이, 화면에서 손으로): 시험용 게임에 `img/pictures/menu.png`(시험 안에서 만든 단색 그림) → 가져오기 → 이미지 화면 → 그 그림 고르기 → 원본 위에서 끌어 영역 만들기 → 문장 "이야기" 입력 → 시험 폰트를 기본 이미지 폰트로 → 번역본에 그림이 뜸 → "끝남으로 표시" → 패치 빌드 → zip 에 `img/pictures/menu.png` 가 있고 원본과 바이트가 다르며 크기가 같음, `패치노트.txt` 와 `설치 방법.txt` 가 있음 → 빌드 기록에 카드가 보임
- [ ] **`npm run build:app && npm run test:e2e` → 실패 확인 후 빠진 연결을 채워 통과**
- [ ] **실제 CLI 로 그림 한 장 해 보기**(`MVMZ_REAL_CLI=1`, 로그인 상태에서만, 모델 `claude-haiku-5-5`): 시험 안에서 만든 그림(어두운 단색 바탕에 일본어 두 줄을 시험용 일본어 글리프가 든 폰트로 찍은 것. 일본어 글리프를 만들 수 없으면 영어 낱말 두 개로 대신한다)을 두고, 채팅 한 번으로 "이 게임의 그림 속 글자를 번역해줘"를 보낸다. 부른 도구의 순서, 만든 지시서(영역 좌표와 글), 쓴 토큰을 보고에 그대로 붙이고, 찍힌 그림을 공유 노트 폴더에 저장한다. 영역이 글자 위치와 대략 맞는지 사람이 볼 수 있게 원본과 결과를 나란히 둔다. 로그인이 아니면 건너뛰고 보고에 적는다
- [ ] **전체 확인**: `npx vitest run`, 두 tsconfig 의 `tsc --noEmit`, `npm run test:e2e`
- [ ] **`git commit -m "feat: 빌드 기록 화면과 이미지 전체 흐름 시험"`**

---

## 이 계획이 끝난 뒤 사람이 확인할 것

- 실제 게임의 메뉴 그림이나 타이틀 그림 한두 장을 채팅으로 맡겨 보고, 영역 위치와 지우기가 쓸 만한지. 가장 싼 모델로는 좌표가 어긋날 수 있으니 Fable 이나 Opus 로 본다.
- 폰트를 바꿨을 때 모든 그림이 다시 찍히는지, 찍힌 그림이 게임에서 제대로 뜨는지(암호화된 게임 포함).
- 모음판 한 장을 보는 데 드는 토큰.
