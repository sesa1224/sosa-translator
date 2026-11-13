# MV/MZ 번역 작업실

RPG Maker MV/MZ 게임의 일본어 → 한국어 번역에서 기계적인 일(가져오기, 텍스트 추출, 형식 검사, 재삽입, 패치 zip 빌드)은 프로그램이 맡고, Claude 에게는 번역과 판단만 넘기는 윈도우용 도구입니다. 데스크톱 앱(Electron), 그 밑의 라이브러리(`src/core`), 명령줄(`src/cli.ts`)로 되어 있습니다. 원본 게임 폴더에는 아무것도 쓰지 않습니다.

설계: `docs/2026-11-13-mvmz-번역작업실-기획서.md`, 계획: `docs/superpowers/plans/2026-11-13-plan1-core-engine.md`, `docs/superpowers/plans/2026-11-13-plan2-app-and-chat.md`, `docs/superpowers/plans/2026-11-13-plan3-glossary-and-translation.md`

## 준비

Node 22.12 이상이 필요합니다.

```bash
npm install
npm run build      # dist/cli.js
npm test           # vitest
```

## 명령

| 명령 | 동작 | 출력 |
|---|---|---|
| `mvmz import <gameDir> <projectDir> --name <이름>` | 게임 판별, 프로젝트 생성, 원본 복사, 전체 추출 | 엔진, 항목 수, 판단 필요 수, 경고 |
| `mvmz export <projectDir> --out <file> [--all]` | 미번역 항목을 JSON 배열로 저장. 판단 필요 항목은 `--all` 일 때만 | 내보낸 수 |
| `mvmz apply <projectDir> <file>` | `[{id, target}]` 를 번역표에 넣고 저장 | 적용 수, 모르는 id |
| `mvmz check <projectDir>` | 형식 검사, 오류 항목은 상태를 `error` 로 저장 | 문제 목록. 오류가 있으면 종료 코드 1 |
| `mvmz build <projectDir>` | 검사 후 바뀐 파일만 묶은 패치 zip | zip 경로, 파일 목록, 건너뛴 오류 수 |
| `mvmz status <projectDir>` | 상태별 개수 | 전체, 미번역, 검토 필요, 승인, 오류 |

종료 코드: 0 성공, 1 오류(메시지 한 줄), 2 모르는 명령이나 인자 부족(사용법 출력).

전역 설치 없이 쓸 때는 `npm run build` 뒤에 `node dist/cli.js <명령>` 으로 부릅니다.

## 프로젝트 폴더

```
<projectDir>/
  project.json            프로젝트 정보 (이름, 엔진, 게임 폴더, www/ 접두사, 버전 목록, 현재 버전)
  original/v1/            가져온 원본 사본 (읽기 전용으로 취급)
    data/*.json
    js/plugins.js
    js/plugins/*.js
  units.json              추출한 번역 단위 (같은 종류+화자+원문은 하나로 합침, 위치 목록 refs)
  translations.json       번역표: 단위 id → { target, status, updatedAt, declinedReason?, review?, reviewedAt? }
  glossary.json           용어집: { terms, characters, styleGuide, rules, confirmedAt } (처음 고칠 때 생김)
  builds/
    001/
      patch/              패치에 들어간 파일 (게임 최상위 기준 경로, MV 배포판이면 www/...)
      manifest.json       { number, createdAt, version, files: [{ path, sha1 }] }
      <이름>_patch_001.zip
```

모든 JSON 은 UTF-8, 들여쓰기 2칸입니다.

## 번역 상태

- `untranslated` 번역 없음
- `needs-review` 번역 있음, 검토 전 (기본값)
- `approved` 승인됨. 판단 필요 항목(플러그인 설정, 플러그인 커맨드, 스크립트, 주석)은 승인돼야 패치에 들어갑니다
- `error` 형식 검사 오류. 패치에서 빠집니다
- `declined` 모델이 번역을 거절함. 이유(`declinedReason`)가 함께 남습니다

## 용어집 (`glossary.json`)

- `terms`: `{ id, source, target, category: name|place|term|sfx|other, status: confirmed|provisional, candidates, note? }`. `provisional` 은 후보 중 추천안으로 진행 중인 용어입니다. 그 용어가 들어간 번역문은 "추천안 용어 사용"으로 표시됩니다.
- `characters`: 인물 카드 `{ id, source, target, speech, firstPerson?, addressing? }`. 그 인물의 대사가 든 묶음에만 붙습니다.
- `styleGuide`: 말투 지침 글. 새 프로젝트의 처음 값은 `docs/default-style-guide.md` 의 본문(첫 제목과 안내 문단 제외)을 빌드 때 그대로 넣은 것입니다. 초안을 받으면 끝에 `## 이 게임의 말투` 절이 붙습니다.
- `rules`: 형식 규칙. 제어 코드 유지, 일본어 남기지 않기, 줄 수 같게, 대사 최대 줄 수, 한 줄 최대 글자 수(`maxLineWidthChars`, 반각은 0.5자), 화자 줄 패턴(`speakerPattern`, 정규식, 첫 묶음이 이름).
- `confirmedAt`: 사용자가 확정한 때. 확정 전에는 전체 번역을 시작할 수 없습니다.

용어 번역을 바꾸면 그 용어가 들어간 번역문을 모두 찾아 바꾸고 뒤의 조사(을/를, 이/가, 은/는, 과/와, 으로/로, 아/야, 이랑/랑, 이나/나, 이라/라, 이야/야)를 받침에 맞춥니다. 조사인지 확실하지 않은 문장은 바꾸되 "검토 필요"로 올립니다.

## 데스크톱 앱

### 실행

```bash
npm install
npx install-electron     # Electron 실행 파일 받기 (처음 한 번, node_modules/electron/dist 에 들어감)
npm run dev              # 개발 모드로 앱 실행
npm run build:app        # out/ 에 빌드
npm run test:e2e         # 빌드된 앱으로 연기 시험 (먼저 build:app)
npx vitest run           # 단위 시험 전체
```

채팅을 쓰려면 Claude CLI(`claude`)가 설치되어 있고 로그인돼 있어야 합니다. 앱은 PATH 에서 `claude.exe`(없으면 `claude.cmd`)를 찾고, 설정 화면에서 경로를 직접 줄 수도 있습니다. 앱 설정은 `%APPDATA%/mvmz-translator/settings.json`, 프로젝트는 기본으로 `문서/MVMZ 번역 작업실/<이름>` 에 만들어집니다.

### 구조

```
src/main/index.ts           창, 수명 주기, 브리지 시작, MCP 설정 파일 쓰기
src/main/projectService.ts  열린 프로젝트의 유일한 소유자. 모든 쓰기는 큐로 한 번에 하나씩, 저장 후 'changed'
src/main/ipc.ts             window.api 처리기 (설정, 프로젝트, 항목, 채팅, 용어집, 작업). 작업은 한 번에 하나
src/main/settings.ts        앱 설정 읽기/쓰기
src/main/toolHandlers.ts    채팅 도구 이름 → 처리 함수 (쓰기는 출처 'chat')
src/main/bridge.ts          127.0.0.1 임의 포트 HTTP 브리지 (실행마다 새 Bearer 토큰)
src/main/claude/            CLI 인자, stream-json 파서, 프로세스 관리(ClaudeChat), 시스템 프롬프트, 한 번 호출로 JSON 답 받기(json.ts)
src/main/translate/         용어집 자료와 초안, 묶음 나누기와 번역 프롬프트, 번역 작업, 검수 작업
src/core/glossary/          용어집 타입·저장, 용어 찾기와 일치 검사, 조사 맞춤, 용어 바꾸기
src/core/text/speaker.ts    화자 줄 패턴
src/mcp/server.ts           Claude CLI 가 띄우는 stdio MCP 서버 "mvmz". 모든 호출을 브리지로 넘긴다
src/preload/index.ts        contextBridge 로 window.api 노출
src/shared/                 IPC 타입(api.ts), 행 만들기·필터·통계(rows.ts)
src/renderer/               React 화면 (상태는 state.ts, 화면 조각은 components/)
```

Claude CLI 는 `-p --input-format stream-json --output-format stream-json` 으로 한 프로세스를 띄워 여러 턴을 주고받습니다. 내장 도구는 모두 끄고(`--tools ""`), `--mcp-config` 로 `mvmz` 서버만 붙이며, 허용 도구도 그 여덟 개로 제한합니다. 모델을 바꾸거나 멈춘 뒤에는 `--resume <session_id>` 로 같은 대화를 이어갑니다.

### 번역 흐름

1. **용어집 초안** (설정의 "용어집과 말투 지침" 모델): 프로그램이 화자 이름, 고유명사 후보, 효과음 후보, 인물별 대사 표본, 메뉴 용어를 모아 한 번 보냅니다. 답은 용어(애매하면 후보 2~3개), 인물 카드, 이 게임의 말투로 돌아와 용어집에 합쳐집니다. 이미 있는 용어와 인물은 건드리지 않습니다. 화자 줄 패턴이 비어 있으면 자동으로 찾아 넣습니다.
2. **확정**: 용어집 화면에서 고치고 "용어집 확정". 결정 안 한 용어가 남아 있어도 확정할 수 있습니다.
3. **전체 번역** (모델 "전체 번역"): 판단 필요가 아닌 미번역 항목을 파일별로 최대 40개, 본문 6,000자씩 묶어 묶음마다 CLI 를 한 번씩 실행합니다. 묶음에는 말투 지침 전체, 형식 규칙, 그 묶음에 나오는 용어와 인물 카드, 바로 앞 대사 3줄이 붙습니다. 화자 줄은 떼고 본문만 보내며, 이름은 용어집으로 옮겨 다시 붙입니다. 형식 오류가 난 항목만 한 번 더 보내고, 거절된 항목은 "거절됨"으로 남깁니다. 묶음 전체가 거절되거나 답 형식이 틀리면 반으로 나눠 다시 보냅니다. 사용량 한도에 걸리면 "한도 때문에 멈춤"이 되고 "이어하기"로 그 묶음부터 다시 합니다. 끝난 묶음은 번역표에 남아 있으므로 앱을 다시 켜도 남은 것만 묶습니다.
4. **검수** (모델 "검수"): 범위(전체, 지난 검수 이후 바뀐 것만, 지금 보는 범위)를 고르면 항목 수와 예상 입력 토큰을 보여줍니다. 문제가 있는 줄에만 이유와 고친 안이 붙어 "검토 필요"로 올라오고, 항목 탭에서 "고친 안 받기" 또는 "그대로 두기"를 고릅니다.

묶음 호출 인자: `claude -p --model <id> --output-format json --tools "" --strict-mcp-config --setting-sources project --disable-slash-commands --system-prompt <지침> --json-schema <스키마>`, 묶음 내용은 표준 입력. 답의 `structured_output` 을 씁니다.

### 채팅 도구

Claude 에게 보이는 이름은 `mcp__mvmz__<도구>` 입니다.

| 도구 | 입력 | 돌려주는 것 |
|---|---|---|
| `project_status` | 없음 | `{ name, engine, stats }` |
| `search_units` | `query`, `status?`, `limit?`(기본 20, 최대 50) | `{ total, items: [{ id, kind, speaker, location, source, target, status, needsDecision }] }` — 원문, 번역, 화자에서 글자 그대로 찾는다 |
| `get_unit` | `id` | 위 항목 + `refCount`, `issues`, 같은 파일 앞뒤 대사 `before`/`after` 각 2개 |
| `set_translation` | `id`, `target` | `{ status, issues }` — 오류가 있으면 `error`, 없으면 `needs-review` |
| `set_status` | `id`, `status: approved \| needs-review` | `{ status }` |
| `undo_last` | 없음 | `{ ids }` — 채팅에서 한 가장 최근 변경 하나만 되돌린다 |
| `glossary_search` | `query` | `{ terms, characters }` — 용어와 인물 카드에서 글자 그대로 찾는다 |
| `glossary_set_term` | `source`, `target`, `category?` | `{ term, changed, uncertain }` — 확정 상태로 저장. 기존 용어의 번역이 바뀌면 번역문도 조사까지 맞춰 바꾼다 |

실제 CLI 로 확인하는 시험(토큰을 씁니다, 모델 `claude-haiku-5-5`, 시험용 작은 게임만):
- 채팅: `MVMZ_REAL_CLI=1 npx vitest run tests/main/realCli.test.ts` (먼저 `npm run build:app`)
- 정해진 형식의 답: `MVMZ_REAL_CLI=1 npx vitest run tests/main/realCliJson.test.ts`
- 초안 → 확정 → 번역 → 검수 한 바퀴: `MVMZ_REAL_CLI=1 npx vitest run tests/main/realFlow.test.ts` (`MVMZ_REAL_FLOW_OUT=<파일>` 이면 번역문과 호출별 토큰을 JSON 으로 남김)

연기 시험에서 묶음 호출은 `MVMZ_CLAUDE_JSON_COMMAND`, `MVMZ_CLAUDE_JSON_PREFIX_ARGS` 로 가짜 CLI(`tests/fixtures/fake-claude-json.mjs`)를 씁니다.
