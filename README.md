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
    files.json            img/, audio/, movies/ 아래 파일 경로 목록 (파일 이름 힌트용)
    index.html            게임의 index.html (제목 번역용)
    package.top.json      게임 최상위 package.json (창 제목 번역용. name 은 바꾸지 않음)
  units.json              추출한 번역 단위 (같은 종류+화자+원문은 하나로 합침, 위치 목록 refs)
  translations.json       번역표: 단위 id → { target, status, updatedAt, declinedReason?, review?, reviewedAt? }
  draft-notes.json        용어집 초안의 대본 읽기 메모 (조각 해시별)
  glossary.json           용어집: { terms, characters, styleGuide, rules, confirmedAt } (처음 고칠 때 생김)
  decisions.json          판단 필요 결정: 판단 키(또는 unit:<id>) → { translate, keep, status, by, reason? } (처음 정할 때 생김)
  builds/
    001/
      patch/              패치에 들어간 파일 (게임 최상위 기준 경로, MV 배포판이면 www/...)
      manifest.json       { number, createdAt, version, files: [{ path, sha1 }] }
      <이름>_patch_001.zip
  preview.json            미리보기 설정: { fontPath, fontName, overrides } (게임 폰트 경로와 대사창 치수 고친 값. 폰트 파일은 복사하지 않음)
  images.json             그림 작업 지시서: { defaultFontPath, recipes: 파일 → { file, baseHash, regions, status, manualFile?, note? }, folders? } (처음 쓸 때 생김)
  images/
    catalog.json          그림 목록 기억: 경로·크기·수정 시각별 { width, height, hash } (바뀐 파일만 다시 읽음)
    rendered/<키>.png     지시서대로 찍은 그림 (키 = 원본 해시 + 지시서 + 폰트)
    thumbs/               목록 썸네일 (긴 변 256)
    manual/               사용자가 직접 고친 그림의 사본
  builds/NNN/snapshot.json  그 빌드에 들어간 번역(id → 해시)·그림·파일 요약. 다음 빌드와 비교용
  builds/NNN/diff.json      지난 빌드와 비교한 숫자와 목록
  builds/NNN/notes.txt      그 빌드의 패치노트 (고치거나 Claude가 다듬으면 이 글이 zip 의 패치노트.txt 에 들어감)
```

모든 JSON 은 UTF-8, 들여쓰기 2칸입니다.

## 번역 상태

- `untranslated` 번역 없음
- `needs-review` 번역 있음, 검토 전 (기본값)
- `approved` 승인됨. 판단 필요 항목은 "번역함"으로 확정된 결정이 있어야 패치에 들어갑니다(결정이 없으면 예전처럼 승인된 것만)
- `error` 형식 검사 오류. 패치에서 빠집니다
- `declined` 모델이 번역을 거절함. 이유(`declinedReason`)가 함께 남습니다

## 용어집 (`glossary.json`)

- `terms`: `{ id, source, target, category: name|place|term|sfx|other, status: confirmed|provisional, candidates, note? }`. `provisional` 은 후보 중 추천안으로 진행 중인 용어입니다. 그 용어가 들어간 번역문은 "추천안 용어 사용"으로 표시됩니다.
- `characters`: 인물 카드 `{ id, source, target, speech, firstPerson?, addressing?, moanStyle? }`. `moanStyle` 은 그 인물의 신음·감탄 소리의 결입니다. 효과음 용어는 화자 있는 대사에는 강제하지 않습니다(신음이 인물마다 다를 수 있게). 그 인물의 대사가 든 묶음에만 붙습니다.
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
src/core/preview/           대사창 치수 알아내기(metrics.ts), 제어문자를 풀어 대사 배치하기(layout.ts)
src/main/fonts/             폰트 파일 읽기와 글자 폭 재기(opentype.js), 폰트 목록과 캐시
src/main/preview.ts         열린 프로젝트의 미리보기: 고른 폰트, 픽셀 폭 검사, 넘침 세기
src/main/story.ts           스토리 보기의 장면 묶기(이벤트 페이지 단위)와 페이지 조건 글
src/renderer/preview/       렌더러 쪽 폰트 등록(FontFace)과 창 스킨 색
src/core/images/            그림 목록과 풀기(catalog.ts), 지시서 저장과 검사(store.ts), 그림 속 글 배치(layoutText.ts), 모음판 크기(sheet.ts)
src/core/notes/             빌드 요약(snapshot.ts), 지난 빌드와 비교·패치노트 글·설치 방법(diff.ts)
src/main/render/            보이지 않는 렌더 작업 창과 그 차례·재시도(renderService.ts)
src/renderer/render-worker/ 렌더 작업 창의 화면: 캔버스로 그림 찍기, 모음판, 썸네일
src/main/images.ts          열린 프로젝트의 그림 서비스: 목록, 지시서, 찍기와 캐시, 패치 기여자
src/main/buildNotes.ts      패치노트 기여자, zip 다시 묶기, 패치노트 다듬기 작업
```

Claude CLI 는 `-p --input-format stream-json --output-format stream-json` 으로 한 프로세스를 띄워 여러 턴을 주고받습니다. 내장 도구는 모두 끄고(`--tools ""`), `--mcp-config` 로 `mvmz` 서버만 붙이며, 허용 도구도 그 열 개로 제한합니다. 모델을 바꾸거나 멈춘 뒤에는 `--resume <session_id>` 로 같은 대화를 이어갑니다.

### 번역 흐름

1. **용어집 초안**: 세 방식 중 하나를 고릅니다. "적당히 읽기"(기본)는 대본에서 고르게 떨어진 장면(약 2,500자씩, 읽는 양 2만/5만/10만 자)과 주요 인물·신음 장면을 골라 읽고, "전체 정독"은 대사 전부를 약 2만 자 조각으로 읽습니다. 조각마다 CLI 를 한 번씩 불러 인물 성격·말투·신음의 결, 고유명사, 효과음을 메모하고(`draft-notes.json` 에 조각 해시와 함께 저장, 같은 조각은 다시 읽지 않음), 모은 메모를 빈도 자료와 함께 한 번 더 보내 정리합니다. "표본만"은 아래 자료만 한 번 보냅니다. 대본 읽기와 용어집 정리 모델은 설정에서 따로 고르고, 초안 대화상자에서 이번 한 번만 바꿀 수 있습니다. 표본 방식은 화자 이름, 고유명사 후보, 효과음 후보, 인물별 대사 표본과 신음 대사, 메뉴 용어를 모아 한 번 보냅니다. 답은 용어(애매하면 후보 2~3개), 인물 카드, 이 게임의 말투로 돌아와 용어집에 합쳐집니다. 이미 있는 용어와 인물은 건드리지 않습니다. 화자 줄 패턴이 비어 있으면 자동으로 찾아 넣습니다.
2. **확정**: 용어집 화면에서 고치고 "용어집 확정". 결정 안 한 용어가 남아 있어도 확정할 수 있습니다.
3. **전체 번역** (모델 "전체 번역"): 판단 필요가 아닌 미번역 항목을 파일별로 최대 40개, 본문 6,000자씩 묶어 묶음마다 CLI 를 한 번씩 실행합니다. 묶음에는 말투 지침 전체, 형식 규칙, 그 묶음에 나오는 용어와 인물 카드, 바로 앞 대사 3줄이 붙습니다. 화자 줄은 떼고 본문만 보내며, 이름은 용어집으로 옮겨 다시 붙입니다. 형식 오류가 난 항목만 한 번 더 보내고, 거절된 항목은 "거절됨"으로 남깁니다. 묶음 전체가 거절되거나 답 형식이 틀리면 반으로 나눠 다시 보냅니다. 사용량 한도에 걸리면 "한도 때문에 멈춤"이 되고 "이어하기"로 그 묶음부터 다시 합니다. 끝난 묶음은 번역표에 남아 있으므로 앱을 다시 켜도 남은 것만 묶습니다.
4. **검수** (모델 "검수"): 범위(전체, 지난 검수 이후 바뀐 것만, 지금 보는 범위)를 고르면 항목 수와 예상 입력 토큰을 보여줍니다. 문제가 있는 줄에만 이유와 고친 안이 붙어 "검토 필요"로 올라오고, 항목 탭에서 "고친 안 받기" 또는 "그대로 두기"를 고릅니다.

### 판단 필요 항목

플러그인 커맨드(356/357), 스크립트(355/655), 주석(108/408), 플러그인 설정, 메모란(`<태그:값>`, `<태그>…</태그>`), 켜진 플러그인의 JS 파일 안 문자열에는 화면에 보이는 글자와 코드가 읽는 값이 섞여 있습니다. 이것들은 "판단 키"로 묶어 한 번만 정합니다.

| 종류 | 판단 키 |
|---|---|
| MV 플러그인 커맨드 | `mv:<첫 조각>` |
| MZ 플러그인 커맨드 인자 | `mz:<플러그인>:<커맨드>:<인자>` |
| 플러그인 설정값 | `param:<플러그인>:<경로>` (배열 번호는 `[*]`) |
| 스크립트, 주석 | `shape:<모양>` (일본어 구간은 `◆`, 숫자는 `#`) |
| 메모란 태그 | `note:<파일 종류>:<태그>` |
| 플러그인 JS 문자열 | `js:<파일 이름>` 묶음, 또는 문자열마다 `unit:<id>` |

결정은 번역함/안 함과 "그대로 둘 부분"(`whole` 값 전체가 글자, `args` MV 커맨드의 앞 `from`개·뒤 `dropLast`개 조각은 그대로, `spans` 일본어 구간만 번역)입니다. `unit:<id>` 결정이 묶음 결정보다 우선합니다.

1. **판단 필요 화면**에서 "Claude에게 추천 받기"(모델 "판단 필요 추천"): 먼저 플러그인 주석(`@type file` 같은 것)과 그림·소리 파일 이름으로 확실한 것을 호출 없이 정하고, 남은 묶음을 30개씩(JS 문자열은 앞뒤 60자 문맥과 함께 40개씩) 보냅니다. 결과는 "추천"으로 남습니다.
2. "추천 전부 받아들이기" 또는 카드마다 "번역함"(방식 고르기)/"번역 안 함"으로 확정합니다. 확정된 결정만 번역 대상이 됩니다. 결정이 없는 항목은 번역도 패치도 하지 않습니다.
3. 전체 번역은 그대로 둘 조각을 `keep` 으로 함께 보내고, "뼈대 검사"가 그 조각이 한 글자도 바뀌지 않았는지 확인합니다. 어긋나면 한 번 다시 보내고, 또 어긋나면 `error` 로 두어 패치에서 뺍니다.
4. 빌드할 때 메모란은 그 태그의 값만, 플러그인 JS 는 따옴표 안쪽만 바꿉니다(파일의 나머지는 바이트 단위로 같음). 추출 뒤에 JS 파일이 바뀌어 기록한 자리가 맞지 않으면 그 파일은 넣지 않고 경고합니다.

결정을 "번역 안 함"으로 되돌려도 번역문은 번역표에 남고 패치에서만 빠집니다. 채팅에서는 `list_decisions`, `set_decision` 도구로 정합니다.

**게임 제목**: 위 막대의 연필 버튼으로 번역 제목을 정하면(`System.json` 의 `gameTitle`, 승인됨) 패치에 `index.html` 의 `<title>` 과, 최상위 `package.json` 의 `window.title`(비어 있지 않을 때만)이 들어갑니다.

**외부 번역**: 텍스트 화면의 "내보내기"는 지금 필터에 걸린 항목을 꾸러미(`mvmz-exchange-1`: 말투 지침과 형식 규칙, 나오는 용어, 인물, 항목마다 본문·화자·그대로 둘 조각·앞뒤 대사)로 저장합니다. 돌려받은 `[{ "id", "target" }]` 를 "가져오기"하면 넣을 수 있는 수, 검사 오류, 이미 번역이 달라 충돌하는 수(기본은 건너뛰기), 없는 id, 모양이 틀린 항목을 보여준 뒤 넣습니다. 들어간 번역은 "외부 번역"으로 표시됩니다.

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
| `list_decisions` | `query?` | `{ total, groups: [{ key, label, count, samples, hints, decision }] }` — 판단 필요 묶음 |
| `set_decision` | `key`, `translate`, `mode?`, `from?`, `dropLast?`, `reason?` | `{ key, decision }` — 바로 확정(`by: claude`). 모르는 키는 실패 |
| `image_sheet` | `folder?`, `status?`, `page?` | 모음판 그림 1장(20개, 5열, 번호 붙음) + `{ page, pages, items: [{ n, file, width, height, status }] }` |
| `image_view` | `file`, `which?: original \| rendered` | 그림 1장(긴 변 1,568 이하) + `{ width, height, scale, status, problem?, regions? }`. 좌표는 `scale` 로 나눠 원본 기준으로 |
| `image_set_recipe` | `file`, `regions`, `done?` | `{ status, regions, overflow, glossaryNote? }` — 그림의 영역 전체를 바꿈. 목록에 없는 `fontPath` 는 무시 |
| `image_set_status` | `file`, `status: todo \| done \| skip` | `{ status }` |
| `image_list` | `status?`, `folder?`, `limit?`(기본 50, 최대 200) | `{ total, items }` — 글만, 그림 없음 |

실제 CLI 로 확인하는 시험(토큰을 씁니다, 모델 `claude-haiku-5-5`, 시험용 작은 게임만):
- 채팅: `MVMZ_REAL_CLI=1 npx vitest run tests/main/realCli.test.ts` (먼저 `npm run build:app`)
- 정해진 형식의 답: `MVMZ_REAL_CLI=1 npx vitest run tests/main/realCliJson.test.ts`
- 판단 필요 추천: `MVMZ_REAL_CLI=1 npx vitest run tests/main/realDecide.test.ts`
- 초안 → 확정 → 번역 → 검수 한 바퀴: `MVMZ_REAL_CLI=1 npx vitest run tests/main/realFlow.test.ts` (`MVMZ_REAL_FLOW_OUT=<파일>` 이면 번역문과 호출별 토큰을 JSON 으로 남김)

연기 시험에서 묶음 호출은 `MVMZ_CLAUDE_JSON_COMMAND`, `MVMZ_CLAUDE_JSON_PREFIX_ARGS` 로 가짜 CLI(`tests/fixtures/fake-claude-json.mjs`)를 씁니다.

## 미리보기와 게임 폰트

설정의 "게임 폰트"에서 폰트를 고르면(목록에 마우스를 올리면 그 폰트로 넘치는 줄 수를 미리 셉니다) 항목 탭에 "게임 화면 미리보기"가 나오고, 대사의 줄 폭 검사가 글자 수 대신 실제 폭(픽셀)으로 바뀝니다(규칙 `line-width-px`, 경고라서 패치에는 들어갑니다). 폰트를 정하지 않았거나 고른 파일이 없어지면 글자 수 검사(`line-width`)로 돌아갑니다.

- 폰트 목록: 윈도우 글꼴 폴더 두 곳(`%WINDIR%\Fonts`, `%LOCALAPPDATA%\Microsoft\Windows\Fonts`), 게임의 `fonts/`, 프로젝트의 `fonts/`, 직접 고른 파일. `.ttf`·`.otf` 만 쓰고 `.ttc`(모음 파일)는 아직 쓸 수 없어 수만 보여 줍니다. 읽은 결과는 앱 설정 폴더의 `fonts-cache.json` 에 파일 크기·수정 시각과 함께 남겨 다음에는 바뀐 파일만 다시 읽습니다. "한글 있는 폰트"는 가·힣·뷁 세 글자가 모두 있는 폰트입니다.
- 대사창 치수: MV 816×(여백 18, 글 여백 6, 글자 28, 줄 36, 4줄, 얼굴 168), MZ 808×(12, 8, 26, 36, 4줄, 얼굴 164)에서 시작해, MZ 는 `System.json` 의 `advanced.uiAreaWidth`·`fontSize`, MV 는 켜진 `YEP_CoreEngine`(`Screen Width`, `Font Size`)과 `Community_Basic`(`screenWidth`)을 반영합니다. 대사창을 바꾸는 플러그인을 쓰는 게임은 "대사창 치수 고치기"에서 손으로 맞춥니다.
- 배치: `\C[n]` 색, `\V[n]`(값을 모르면 123), `\N[n]`·`\P[n]`(액터 이름, 번역이 있으면 번역), `\G`, `\I[n]`(아이콘 폭), `\{`·`\}`(글자 크기)를 게임처럼 풀고, 글자는 하나씩 폭을 더합니다(커닝 없음). 폰트에 없는 글자는 글자 크기만큼 폭을 잡고 "이 폰트에 없는 글자 n개"로 알립니다. 얼굴 그림이 있는 대사(앞의 `101` 에 얼굴 이름)는 그만큼 좁게 재고, 같은 문장이 얼굴 있는 곳과 없는 곳에 모두 쓰이면 좁은 쪽으로 검사합니다.
- 미리보기는 프로그램이 흉내 내어 그린 화면입니다. 글자 색은 게임의 `img/system/Window.png`(암호화돼 있으면 풀어서)에서 읽고, 없으면 기본 색을 씁니다. 원본 게임 폴더는 읽기만 합니다. 폰트를 게임에 넣는 기능은 아직 없습니다.
- 스토리 보기: 텍스트 화면 위의 "표 | 스토리"로 바꿉니다. 왼쪽에서 고른 범위(파일)의 장면(이벤트 페이지, 커먼이벤트, 전투 이벤트 페이지)을 순서대로 보여 주고, 페이지 조건(스위치, 변수, 셀프 스위치, 아이템, 액터)을 글로 적습니다. 장면마다 "이 장면 다시 번역"과 "장면 승인"이 있습니다.

연기 시험은 `MVMZ_FONT_DIRS`(`;` 로 구분한 폴더들)로 윈도우 글꼴 폴더 대신 시험용 폰트 폴더를, `MVMZ_PICK_FONT` 로 파일 고르기 창 대신 정해진 폰트 파일을 씁니다. 시험용 폰트는 시험 안에서 `opentype.js` 로 만들고 저장소에는 폰트 파일을 넣지 않습니다.

## 이벤트와 수정

왼쪽 메뉴의 "이벤트"에서 파일(맵, 커먼이벤트, 전투 이벤트)과 이벤트(맵은 페이지마다)를 고르면 커맨드를 한국어 한 줄씩 풀어 보여 줍니다(`src/core/events/describe.ts`). 대사(`101`+`401`), 스크롤 문장, 주석, 스크립트, MZ 플러그인 커맨드는 한 줄로 합치고, 줄 번호는 원본 목록의 번호입니다. 표에 없는 코드는 `코드 999 [원래 인자]` 로 보입니다. 줄의 스위치·변수·커먼이벤트 이름을 누르면 오른쪽에 사용처(켬/조건)가 뜨고, 누르면 그 이벤트로 갑니다.

수정은 원본을 고치지 않고 `patches.json` 에 "원본 대비 바뀐 점"으로 쌓입니다. 빌드할 때 원본 커맨드마다 원래 번호 꼬리표를 붙이고, 수정(끼워 넣기, 지우기, 바꾸기)을 원본 번호로 적용한 뒤, 번역을 꼬리표로 찾아 넣습니다. 그래서 수정으로 번호가 밀려도 번역이 제자리에 들어가고, 번역이 걸린 커맨드를 지운 수정이면 그 번역만 건너뜁니다. 원본 목록이 기록했을 때와 다르면(내용 기준 해시, 공백·키 순서는 무시) 그 수정은 넣지 않고 "충돌"로 표시합니다. 수정이 하나도 없으면 빌드 결과는 예전과 같습니다.

| 수정 종류 | 하는 일 |
|---|---|
| `event` | 이벤트 목록 하나에 대한 연산 `insert after`(-1 이면 맨 앞), `delete at`, `replace at` — 번호는 모두 원본 번호. 한 목록에 켜진 수정은 하나 |
| `json` | 데이터 파일의 값 하나(`baseValue` 가 원본과 다르면 충돌) |
| `plugin` | 새 플러그인 파일 `js/plugins/<이름>.js` 와 `js/plugins.js` 끝의 등록 |
| `font` | 게임 폰트 넣기(프로젝트에 하나). MZ 는 `fonts/mvmz-game-font.ttf` 와 `System.json` 의 `advanced.mainFontFilename`, MV 는 폰트와 `fonts/gamefont.css` 의 `GameFont` 블록 |

프로젝트 폴더에 더해지는 것:

```
<projectDir>/
  patches.json            수정 목록: [{ id, title, note, enabled, originalBug, createdBy, createdAt, body }]
  original/v1/fonts/gamefont.css   MV 게임의 폰트 설정 사본 (있을 때만)
  testplay/               "게임 실행"용 시험 사본. 그림·소리·실행 파일은 원본과 하드 링크, 나머지는 복사
    .patched.json         지난번에 패치로 덮어쓴 파일 목록 (다음에 원본으로 되돌릴 것)
```

- 폰트 넣기: 설정의 "폰트를 게임에 넣기"에서 켭니다. "쓰는 글자만 남겨 용량 줄이기"를 켜면 번역문, 수정으로 넣은 글, 숫자·영문·문장부호·전각 기호만 남깁니다(`subset-font`). 폰트에 원래 없는 글자는 건너뜁니다. 배포해도 되는 폰트인지는 직접 확인하세요. 위 "미리보기와 게임 폰트"의 "폰트를 게임에 넣는 기능은 아직 없습니다"는 이제 이 기능으로 대신합니다.
- 게임 실행: 위 막대의 "게임 실행"은 가장 최근 빌드의 `patch/` 를 시험용 사본에 얹고 사본의 `Game.exe`(없으면 `nw.exe`)를 켭니다. 처음 한 번은 사본을 만드느라 오래 걸리고, 다음부터는 바뀐 파일만 다시 가져옵니다. 하드 링크로 이어진 파일에 패치를 쓸 때는 사본 쪽 파일을 먼저 지우고 쓰므로 원본은 바뀌지 않습니다. 사본의 `save/` 는 다시 준비해도 덮어쓰지 않습니다.
- "제작자 전달용 목록": "원본 버그"로 표시한 수정만 모아 마크다운으로 보여 줍니다(제목, 위치, 무엇을 왜, 풀어쓴 연산).

채팅 도구 다섯 개가 더해집니다(허용 도구는 위 열 개와 합쳐 열다섯 개):

| 도구 | 입력 | 돌려주는 것 |
|---|---|---|
| `event_files` | 없음 | `{ files: [{ file, label, events }] }` |
| `event_list` | `file` | `{ total, events: [{ label, listPath, pages?, condition, commandCount }] }` |
| `event_read` | `file`, `listPath`, `raw?`, `from?`, `to?` | `{ label, condition, hash, commandCount, lines: [{ index, indent, text }], patch? }` — 원본 JSON 은 `raw: true` 일 때 `from`~`to`(최대 30줄)만 |
| `usage_search` | `type`(switch, variable, commonEvent, item, picture), `id` | `{ total, items: [{ file, listPath, label, index, text, access }] }` — 페이지 조건은 `index: -1` |
| `event_patch` | `title`, `file`, `listPath`, `baseHash`, `ops`, `note?`, `originalBug?` | `{ id, title, updated, state, reason? }` — 수정을 `createdBy: claude` 로 더한다. 같은 목록에 수정이 있으면 그 수정의 연산을 바꾼다 |

실제 CLI 확인: `MVMZ_REAL_CLI=1 npx vitest run tests/main/realEventPatch.test.ts` (먼저 `npm run build:app`, 모델 `claude-haiku-5-5`, 시험용 작은 게임만. `MVMZ_REAL_EVENT_OUT=<파일>` 이면 부른 도구와 토큰을 JSON 으로 남김). 연기 시험은 `MVMZ_GAME_SPAWN_FAKE=1` 이면 게임을 실제로 띄우지 않고 실행한 것으로 칩니다.
## 그림 속 글자와 패치노트

왼쪽 메뉴의 "이미지"에서 게임 그림 속 글자를 번역합니다. 그림 파일 자체가 아니라 "작업 지시서"(지울 영역, 넣을 문장, 폰트, 크기, 색, 정렬)를 `images.json` 에 저장하고, 프로그램이 그 지시서대로 그림을 찍어 패치에 넣습니다. 폰트나 문장을 바꾸면 Claude 없이 다시 찍힙니다.

- 대상: 기본은 `img/pictures`, `img/titles1`, `img/titles2`, `img/system`, `img/parallaxes`(하위 폴더 포함, `.png`·`.png_`·`.rpgmvp`). 설정의 "이미지"에서 바꿉니다. 원본 게임 폴더는 읽기만 하고, 푼 그림·찍은 그림·썸네일은 프로젝트의 `images/` 에만 둡니다.
- 그리기: 화면에 보이지 않는 Electron 창의 캔버스로 찍습니다(네이티브 이미지 라이브러리 없음). 원본을 그리고 → 영역마다 지우기(색으로 채움, 영역 바로 바깥 색의 평균으로 채움) → 글(그림자 → 테두리 → 채우기). 문장이 영역 폭을 넘으면 공백에서(없으면 글자 단위로) 줄을 바꾸고, 닫는 문장부호는 줄 맨 앞에 오지 않게 앞 줄에 붙입니다. 그래도 높이를 넘치면 넘친 채로 찍고 "영역을 넘쳐요"로 알립니다(글자를 몰래 줄이지 않음).
- 패치: 상태가 "끝남"이고 문제가 없는 그림, 또는 "직접 고침"으로 넣은 PNG 만 들어갑니다. 원본 크기 그대로 PNG 이고, 원본이 암호화 파일이면 같은 키로 다시 암호화해 같은 경로에 넣습니다.
- 문제 표시: 지시서를 쓴 뒤 원본 그림이 바뀌면 "원본이 바뀜"(확인 전에는 패치에서 빠짐), 폰트 파일이 없으면 "폰트 없음", 찍기에 실패하면 그 그림만 실패로 남고 빌드는 계속됩니다. 렌더 작업 창이 죽거나 30초 안에 답이 없으면 새 창으로 한 번 더 시도합니다.
- 채팅: `image_sheet` 로 모음판을 보고, `image_view` 로 크게 보고, `image_set_recipe` 로 지시서를 냅니다. 그림은 도구 결과의 그림 블록으로 보내고, 긴 변 1,568px 을 넘지 않게 줄입니다(토큰을 아끼려고).

빌드할 때마다 `builds/NNN/` 에 요약(`snapshot.json`)을 남기고 지난 빌드와 비교해(`diff.json`) 패치노트를 씁니다(`notes.txt`). zip 최상위에 `패치노트.txt`(이번 빌드의 글 다음에 지난 빌드들의 글을 최신순으로)와 `설치 방법.txt` 가 들어갑니다. 왼쪽 메뉴의 "빌드 기록"에서 노트를 고쳐 저장하거나 "Claude에게 다듬기 맡기기"(설정의 패치노트 정리 모델)를 누르면 그 빌드의 zip 안 글도 바뀝니다(manifest 의 sha1 도 맞춤). 다른 기능이 패치노트에 요약을 넣을 때는 `ProjectService.buildSummaries` 에 함수를 더합니다.

실제 CLI 로 확인하는 시험: `MVMZ_REAL_CLI=1 npx vitest run tests/main/realImageTool.test.ts` (도구 결과의 그림이 모델에게 보이는지). 연기 시험은 `MVMZ_TEST_HOOKS=1` 로 렌더 서비스를 시험에서 부를 수 있게 하고(`tests/e2e/render.e2e.test.ts`), `MVMZ_PICK_PNG` 로 직접 고친 그림 고르기 창 대신 정해진 파일을 씁니다.
