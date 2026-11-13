# MV/MZ 번역 작업실

RPG Maker MV/MZ 게임의 일본어 → 한국어 번역에서 기계적인 일(가져오기, 텍스트 추출, 형식 검사, 재삽입, 패치 zip 빌드)은 프로그램이 맡고, Claude 에게는 번역과 판단만 넘기는 윈도우용 도구입니다. 데스크톱 앱(Electron), 그 밑의 라이브러리(`src/core`), 명령줄(`src/cli.ts`)로 되어 있습니다. 원본 게임 폴더에는 아무것도 쓰지 않습니다.

설계: `docs/2026-11-13-mvmz-번역작업실-기획서.md`, 계획: `docs/superpowers/plans/2026-11-13-plan1-core-engine.md`, `docs/superpowers/plans/2026-11-13-plan2-app-and-chat.md`

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
  translations.json       번역표: 단위 id → { target, status, updatedAt }
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
src/main/ipc.ts             window.api 처리기 (설정, 프로젝트, 항목, 채팅)
src/main/settings.ts        앱 설정 읽기/쓰기
src/main/toolHandlers.ts    채팅 도구 이름 → 처리 함수 (쓰기는 출처 'chat')
src/main/bridge.ts          127.0.0.1 임의 포트 HTTP 브리지 (실행마다 새 Bearer 토큰)
src/main/claude/            CLI 인자, stream-json 파서, 프로세스 관리(ClaudeChat), 시스템 프롬프트
src/mcp/server.ts           Claude CLI 가 띄우는 stdio MCP 서버 "mvmz". 모든 호출을 브리지로 넘긴다
src/preload/index.ts        contextBridge 로 window.api 노출
src/shared/                 IPC 타입(api.ts), 행 만들기·필터·통계(rows.ts)
src/renderer/               React 화면 (상태는 state.ts, 화면 조각은 components/)
```

Claude CLI 는 `-p --input-format stream-json --output-format stream-json` 으로 한 프로세스를 띄워 여러 턴을 주고받습니다. 내장 도구는 모두 끄고(`--tools ""`), `--mcp-config` 로 `mvmz` 서버만 붙이며, 허용 도구도 그 여섯 개로 제한합니다. 모델을 바꾸거나 멈춘 뒤에는 `--resume <session_id>` 로 같은 대화를 이어갑니다.

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

실제 CLI 로 확인하는 시험(토큰을 씁니다): `MVMZ_REAL_CLI=1 npx vitest run tests/main/realCli.test.ts` (먼저 `npm run build:app`).
