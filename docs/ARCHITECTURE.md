# 구조 안내

이 문서는 코드를 고치러 온 사람(또는 Claude)이 어디를 봐야 하는지 알려 준다. 사용법은 `README.md`, 만든 까닭은 `docs/2026-11-13-mvmz-번역작업실-기획서.md` 를 본다.

## 1. 프로세스와 서로 주고받는 길

앱은 다섯 종류의 프로세스로 돈다.

| 프로세스 | 코드 | 하는 일 |
|---|---|---|
| 메인 | `src/main/index.ts` (빌드 결과 `out/main/index.js`) | 창 만들기, 열린 프로젝트의 데이터 소유(`ProjectService`), IPC 처리, Claude CLI 띄우기, 작업 돌리기 |
| 렌더러 | `src/renderer/` (React), `src/preload/index.ts` | 화면. 파일과 Node 에 손대지 않고 `window.api` 로만 메인에 부탁한다 |
| 렌더 작업 창 | `src/renderer/render-worker/worker.ts`, `src/preload/render.ts`, `src/main/render/` | 보이지 않는 창. 캔버스로 그림 속 글자를 찍고, 모음판과 썸네일을 만든다. 처음 쓸 때 만들어진다 |
| MCP 서버 | `src/mcp/server.ts` (빌드 결과 `out/main/mcp-server.js`) | Claude CLI 가 띄우는 stdio MCP 서버. 데이터를 갖지 않고 모든 도구 호출을 메인의 브리지로 넘긴다 |
| Claude CLI | 사용자 컴퓨터의 `claude` | 채팅은 오래 사는 프로세스 하나(stream-json), 번역·검수·판단·초안·패치노트 작업은 묶음마다 한 번씩 부르는 프로세스(`--output-format json --json-schema`) |

주고받는 길:

| 어디서 → 어디로 | 길 | 코드 |
|---|---|---|
| 렌더러 → 메인 (부탁과 답) | `ipcRenderer.invoke(채널)`. 채널 목록은 `InvokeChannels` | `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts` |
| 메인 → 모든 창 (알림) | `webContents.send(채널)`. 목록은 `PushEvents`, 렌더러는 `api.on()` 으로 받는다 | `src/main/index.ts` 의 `broadcast`, `src/renderer/state.ts` 의 `start()` |
| 메인 ↔ 렌더 작업 창 | IPC 메시지 `RenderRequest`/`RenderReply`. 한 번에 하나, 죽거나 30초 넘게 답이 없으면 창을 새로 만들어 한 번 더 | `src/shared/renderProtocol.ts`, `src/main/render/renderService.ts`, `renderWindow.ts` |
| 메인 → Claude CLI (채팅) | 자식 프로세스의 표준 입출력(stream-json) | `src/main/claude/chat.ts`, `args.ts`, `stream.ts` |
| 메인 → Claude CLI (작업) | 묶음 내용은 표준 입력, 답은 `structured_output` | `src/main/claude/json.ts` |
| Claude CLI → MCP 서버 | CLI 가 `mcp.json`(앱 설정 폴더)을 읽고 Electron 을 Node 로(`ELECTRON_RUN_AS_NODE`) 띄운다 | `src/main/bridge.ts` 의 `writeMcpConfig` |
| MCP 서버 → 메인 | `127.0.0.1` 임의 포트의 HTTP 브리지, 실행마다 새 Bearer 토큰 | `src/main/bridge.ts`, `src/mcp/server.ts` |
| 메인 → 채팅 도구 | 브리지가 `callTool` 을 부르고, 도구는 `ProjectService` 메서드를 부른다 | `src/main/toolHandlers.ts` |

Claude CLI 인자는 일부러 좁힌다: 내장 도구를 모두 끄고(`--tools ""`) 앱의 MCP 도구만 허용하며(`--allowedTools`), 사용자 전역 설정과 기본 시스템 프롬프트를 뺀다(`--setting-sources project`, `--system-prompt`). 호출마다 수천 토큰이 걸린 문제라서 되돌리지 않는다(`src/main/claude/args.ts`, `json.ts`).

## 2. 데이터가 흐르는 순서

원본 게임 폴더에는 아무것도 쓰지 않는다. 모든 쓰기는 프로젝트 폴더 안에서, 앱에서는 `ProjectService` 만 한다.

1. **가져오기** — `core/engine/detect.ts` 가 게임 폴더를 알아보고(게임이 exe 하나로 뭉쳐져 있으면 `core/engine/evb.ts` 가 그 안의 파일 목록을 읽어 알려 주고, 사용자가 누르면 `main/ipc.ts` 의 `unpackGame` 이 프로젝트 폴더의 `_풀린 게임/` 에 풀어 그 폴더를 게임 폴더로 쓴다. 압축된 파일은 `core/engine/aplib.ts` 가 편다), `core/project/project.ts` 의 `createProject` 가 `data/`, `js/plugins.js`, `js/plugins/*.js` 를 `original/v1/` 로, `core/project/originals.ts` 가 도우미 파일(`files.json`, `index.html`, `package.top.json`, `fonts/gamefont.css`)을 복사한다. 이후 글은 모두 이 사본에서 읽는다(그림, 폰트, 게임 실행은 게임 폴더를 읽기만 한다).
2. **추출** — `core/extract/index.ts` 의 `extractAll` 이 사본에서 문장을 뽑아 `units.json` 을 쓴다. 데이터베이스(`database.ts`), 이벤트(`events.ts`), 플러그인 설정(`plugins.ts`), 메모란(`notes.ts`), 플러그인 JS(`pluginJs.ts`)가 각각 `RawUnit` 을 내고, `mergeUnits` 가 같은 문장을 하나로 합친다. 문장 id 는 종류·화자·원문으로 만든 해시라서 위치가 바뀌어도 그대로다.
3. **번역표** — `translations.json`(`core/store/translations.ts`)은 문장 id → 번역. 원문으로 만든 id 를 열쇠로 쓰므로 같은 문장은 한 번만 번역하고, 다시 추출하거나 게임을 업데이트해도 번역이 떨어지지 않는다.
4. **용어집과 판단** — `glossary.json`(`core/glossary/`)은 용어, 인물 카드, 말투 지침, 형식 규칙. `decisions.json`(`core/decisions/`)은 판단 필요 문자열의 결정.
5. **검사** — 번역이 쓰일 때마다 `core/check/format.ts` 가 제어문자, 남은 일본어, 줄 수와 폭, 용어, 뼈대를 검사하고, 오류가 있으면 상태를 `error` 로 둔다.
6. **수정, 그림, 미리보기** — `patches.json`(`core/patches/`), `images.json`(`core/images/`), `preview.json`(`core/preview/`).
7. **빌드** — `core/build/patch.ts` 의 `buildPatch` 가 `core/build/apply.ts` 로 사본에 번역과 이벤트 수정을 얹은 파일을 메모리에서 만들고, 원본과 달라진 파일만 `builds/NNN/` 의 `patch/`, `manifest.json`, zip 으로 쓴다. 메인이 등록한 "기여자"(`BuildContributor`)가 게임 폰트(`main/fontEmbed.ts`), 그림(`main/images.ts`), 패치노트(`main/buildNotes.ts`)를 더한다.
8. **업데이트** — `core/update/importVersion.ts` 가 새 버전을 `original/vN/` 으로 들이고, 바뀌기 전 파일을 `backups/before-vN/` 에, 결과 요약을 `updates/vN.json` 에 남긴다.

## 3. 기능별로 거치는 모듈

모든 기능은 같은 모양으로 돈다: 화면의 버튼 → `src/renderer/state.ts` 의 액션 → `window.api` → `src/main/ipc.ts` 의 처리기 → `ProjectService` 나 작업 클래스 → 파일 저장 → 이벤트 → 메인이 `PushEvents` 로 알림 → `state.ts` 가 상태를 고침 → 화면이 다시 그려짐. 작업(번역, 검수, 판단, 초안, 패치노트 다듬기, 그림 다시 찍기)은 한 번에 하나만 돌고, 진행은 `job:progress` 로 알린다.

| 기능 | 화면 | 메인 | core |
|---|---|---|---|
| 용어집 초안 | `GlossaryView.tsx`, `DraftDialog.tsx` | `translate/draft.ts`(`DraftJob`), `translate/read.ts`(대본 조각 고르기), `translate/material.ts`(표본 자료) | `glossary/`, `text/speaker.ts` |
| 전체 번역 | `TextTable.tsx`, `ItemPanel.tsx`, `StoryView.tsx` | `translate/job.ts`(`BatchJob`, `TranslateJob`), `translate/batches.ts`(묶기와 프롬프트), `claude/json.ts` | `check/format.ts`, `glossary/match.ts`, `decisions/keys.ts`(그대로 둘 조각) |
| 검수 | `ReviewDialog.tsx`, `ItemPanel.tsx` | `translate/review.ts`(`ReviewJob`) | `glossary/match.ts` |
| 판단 필요 | `DecisionView.tsx` | `translate/decide.ts`(`DecideJob`), `ProjectService` 의 결정 메서드 | `decisions/`(`keys.ts` 판단 키, `auto.ts` 확실한 것 자동 결정, `skeleton.ts` 뼈대 검사, `store.ts`), `extract/pluginMeta.ts` |
| 채팅 | `ChatPanel.tsx` | `claude/chat.ts`, `claude/prompt.ts`, `bridge.ts`, `toolHandlers.ts` | (도구가 부르는 것 모두) |
| 이미지 | `ImageView.tsx` | `images.ts`(`ImageService`, 기여자, 그림 도구의 바탕), `render/` | `images/`(`catalog.ts` 찾기와 풀기, `store.ts` 지시서, `layoutText.ts` 줄 바꿈, `sheet.ts` 크기) |
| 이벤트와 수정 | `EventView.tsx`, `PatchView.tsx` | `ProjectService` 의 수정 메서드, `gameRun.ts`(게임 실행), `fontEmbed.ts` | `events/`(풀어쓰기, 이름, 사용처), `patches/`(연산, 해시, 충돌 판단), `build/apply.ts` |
| 미리보기와 폰트 | `GamePreview.tsx`, `FontPicker.tsx`, `src/renderer/preview/` | `preview.ts`(`PreviewService`, 픽셀 폭 검사), `fonts/`, `story.ts` | `preview/`(`metrics.ts` 대사창 치수, `layout.ts` 배치) |
| 빌드와 패치노트 | `TopBar.tsx`, `BuildsView.tsx` | `ProjectService.build`, `buildNotes.ts`(기여자, `NotesJob`) | `build/`, `notes/` |
| 외부 번역 | `ExchangeDialog.tsx` | `ProjectService.exportPackage`/`importPackage`/`applyImport` | `exchange/package.ts` |
| 게임 업데이트 | `UpdateDialog.tsx`, `UpdateView.tsx` | `ProjectService.importVersion`/`rollbackVersion`, `ipc.ts` 의 `reopen` | `update/`(`diff.ts` 문장 짝짓기, `carry.ts` 번역 옮기기, `rebase.ts` 수정 옮기기, `importVersion.ts`) |

업데이트나 되돌리기 뒤에는 메인이 프로젝트를 닫았다가 다시 열고(`reopen`) `project:reloaded` 로 새 스냅샷을 보낸다. 미리보기, 그림, 이벤트 이름, 게임 실행 사본이 모두 새 원본에서 다시 시작하게 하려는 것이다.

명령줄 도구(`src/cli.ts`)는 `src/core/index.ts` 만 쓰는 얇은 껍데기다. `ProjectService` 를 거치지 않고 번역표를 직접 읽고 쓴다.

## 4. 새 기능을 넣을 때 손대는 곳

### 채팅 도구 하나 더하기

1. `src/main/toolHandlers.ts`: `TOOL_DEFS` 에 이름, 한국어 설명, zod 입력 스키마를 더하고, `HANDLERS[이름]` 에 처리 함수를 둔다. 쓰기는 `ProjectService` 메서드로 한다(번역은 출처 `'chat'`). 그림을 돌려주려면 `WithImages` 를 쓴다.
2. `src/main/claude/args.ts`: `CHAT_TOOLS` 에 이름을 더한다. 빠지면 CLI 가 그 도구를 거부한다. `tests/main/claude.test.ts` 가 허용 목록 문자열을 그대로 확인하므로 시험도 고친다.
3. 모델이 언제 쓰는지 알아야 하면 `src/main/claude/prompt.ts` 의 시스템 프롬프트에 한 줄 더한다(매 턴 보내지므로 짧게).
4. `README.md` 의 채팅 도구 표에 한 줄 더한다.

MCP 서버(`src/mcp/server.ts`)는 브리지에서 도구 목록을 받아 오므로 고칠 필요가 없다.

### 화면 하나 더하기

1. `src/renderer/components/` 에 컴포넌트를 만든다.
2. `src/renderer/state.ts` 의 `AppState.view` 유니온에 화면 이름을 더하고, `src/renderer/App.tsx` 의 `SCREENS` 표에 이름 → 컴포넌트를 더한다(빠뜨리면 타입 검사가 잡는다).
3. `src/renderer/components/Sidebar.tsx` 에 메뉴 버튼을 둔다.
4. 화면이 쓸 상태와 액션을 `state.ts` 에 더한다. 메인의 새 데이터가 필요하면 아래 "IPC 채널 더하기"를 한다.
5. 모양은 `src/renderer/theme.css` 에 더한다. 배치와 문구의 기준은 `docs/mockup/Main.dc.html`.
6. 시험은 `tests/renderer/` 에 두고, 가짜 `window.api` 인 `tests/renderer/fakeApi.tsx` 를 쓴다.

### IPC 채널 더하기

1. `src/shared/api.ts`: `InvokeChannels` 에 채널을, `Api` 에 메서드를 더한다(메인이 먼저 보내는 알림이면 `PushEvents`). 렌더러가 볼 타입이 Node 를 쓰는 core 모듈에 있으면 여기에 사본을 두고 `src/main/ipc.ts` 의 `sharedTypesMatch` 에 같은지 확인하는 줄을 더한다.
2. `src/main/ipc.ts`: `handle('채널', …)` 을 더한다. 인자는 믿지 말고 `String(…)` 처럼 다듬는다. 프로젝트 데이터는 `svc()` 로 `ProjectService` 에 맡긴다.
3. `src/preload/index.ts`: `api` 객체에 `call('채널', …)` 을 더한다.
4. `tests/renderer/fakeApi.tsx` 에 가짜를 더한다.

### 새 추출 대상 더하기

1. `src/core/extract/` 에 그 대상에서 `RawUnit` 을 내는 함수를 만들고 `extract/index.ts` 의 `extractFromDir`(또는 `database.ts` 의 `extractFromDataFile`)에서 부른다. 문장이 사는 자리를 나타낼 수 없으면 `src/core/types.ts` 의 `UnitRef` 에 종류를, 새 문장 종류면 `UnitKind` 를 더한다.
2. 코드가 읽는 값일 수 있으면 `needsDecision: true` 와 판단 키(`src/core/decisions/keys.ts`)를 준다. 확실하지 않은 것을 말없이 번역 대상으로 두지 않는다.
3. `src/core/build/apply.ts` 에서 그 자리에 번역을 다시 쓰는 길을 만든다. 제어문자와 파일의 나머지 바이트를 지킨다.
4. 화면의 위치 이름은 `src/shared/rows.ts`(`locationLabel`, `scopeLabel`)에서 정한다.
5. 시험용 작은 게임(`tests/helpers/miniGame.ts`)에 예를 더해 시험하고, 실제 MV 게임과 MZ 게임에서 `node dist/cli.js import` 를 돌려 본다(게임 폴더는 읽기만 한다).

### 빌드에 파일 더하기

`ProjectService.buildContributors` 에 `BuildContributor` 를 더한다(`src/main/fontEmbed.ts` 의 `registerFontContributor` 가 예). 패치노트에 요약을 남기려면 `ProjectService.buildSummaries` 에 함수를 더한다.

### 프로젝트 파일 더하기

새 JSON 파일은 `ProjectService` 가 읽고 쓰게 하고, `core/util/json.ts` 의 `writeJsonFile`(임시 파일을 거쳐 쓰기)을 쓴다. 게임 업데이트를 되돌릴 때 함께 되돌려야 하면 `src/core/update/importVersion.ts` 의 `BACKUP_FILES` 에 더한다.

## 5. 지켜야 할 것

`CLAUDE.md` 의 "꼭 지킬 것"을 따른다. 특히 원본 게임 폴더에 쓰지 않기, 프로젝트 데이터는 `ProjectService` 만 쓰기, 코드가 읽는 값을 말없이 번역하지 않기, 제어문자 보존, Claude CLI 인자 유지, `src/core/index.ts` 와 `src/shared/api.ts` 의 공개 이름은 바꾸지 말고 더하기.
