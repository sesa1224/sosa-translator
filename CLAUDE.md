# SoSa Translator (MV/MZ 번역 작업실)

RPG Maker MV/MZ 게임을 일본어에서 한국어로 번역하는 윈도우용 데스크톱 앱이다. 풀기, 추출, 검사, 재삽입, 패치 빌드 같은 기계적인 일은 프로그램이 하고, Claude에게는 번역과 판단만 맡겨 토큰을 아끼는 것이 목적이다.

이 파일은 이 저장소에서 일하는 Claude가 가장 먼저 읽는 안내다. 사용자는 개발자가 아니며 한국어로 소통한다.

## 먼저 읽을 문서

| 문서 | 내용 |
|---|---|
| `docs/2026-11-13-mvmz-번역작업실-기획서.md` | 무엇을 왜 만드는지. 사용자가 정한 것은 `[확정]`, Claude가 정한 기본값은 `[내 선택]` 으로 표시돼 있다. 9장은 실제 게임으로 시험하며 알게 된 것 |
| `docs/ARCHITECTURE.md` | 프로세스 구성, 데이터 흐름, 기능별로 거치는 모듈, 새 기능을 넣을 때 손대는 곳. 코드를 고치기 전에 읽는다 |
| `docs/superpowers/plans/` | 단계별 구현 계획(모두 끝남). 맨 위 `README.md` 가 각 문서를 안내한다. 계획서의 "병렬 작업 규칙"은 지금 따르지 않는다 |
| `docs/default-style-guide.md` | 새 프로젝트에 들어가는 기본 번역 지침. 빌드 때 앱에 그대로 들어간다. 이 파일을 고치면 기본값이 바뀐다 |
| `docs/2026-11-17-화면-새단장-설계.md` | 1.10~1.12 의 화면 새단장 설계(끝남). 화면을 왜 지금처럼 잡았는지 찾아볼 때 본다 |
| `docs/mockup/Main.dc.html` | 처음의 화면 시안(시안 도구 형식이라 그대로 실행되지는 않는다). 지금 모양의 기준은 앱 화면 자체다 |
| `README.md` | 사용자용 안내: 준비물, 실행, 화면 둘러보기, 처음부터 끝까지 쓰는 법, 프로젝트 폴더의 파일, 채팅 도구, 명령줄 도구, 문제 해결 |
| `CHANGELOG.md` | 버전별 바뀐 점. 사용자에게 보이는 변화가 생기면 여기에 한 줄을 더한다 |

## 구조

```
src/core/              화면도 Electron도 모르는 순수 라이브러리. 공개 이름은 src/core/index.ts
  engine/ project/     게임 판별·암호 풀기·뭉친 exe 풀기, 프로젝트 폴더와 원본 사본
  extract/ store/      문장 추출(units.json), 번역표(translations.json)
  glossary/ text/      용어집·조사 맞춤, 제어문자·일본어·화자 줄
  check/ decisions/    형식 검사, 판단 필요(판단 키, 뼈대 검사)
  build/ notes/        재삽입과 패치 빌드, 패치노트
  events/ patches/     이벤트 풀어쓰기·사용처, 원본 대비 수정
  images/ preview/     그림 목록·지시서, 대사창 미리보기
  exchange/ update/    외부 번역 꾸러미, 게임 업데이트
  similar/             비슷한 번역 찾기(일치율)
src/cli.ts             core 를 명령줄로 쓰는 얇은 껍데기 (mvmz import / export / apply / check / build / status)
src/main/              Electron 메인 프로세스
  projectService.ts    열린 프로젝트의 유일한 소유자. 모든 쓰기가 여기를 거친다
  ipc.ts               window.api 처리기. 작업(한 번에 하나), 채팅, 미리보기, 그림, 게임 실행을 붙든다
  toolHandlers.ts      채팅 도구(TOOL_DEFS, HANDLERS)
  claude/              CLI 인자, 채팅 프로세스, 한 번 호출로 JSON 받기, 시스템 프롬프트
  translate/           번역·검수·판단 추천·용어집 초안 작업, 항목 탭의 한 줄 Claude 초안(lineDraft.ts)
  images.ts render/    그림 서비스와 보이지 않는 렌더 작업 창
  preview.ts fonts/    미리보기, 폰트 목록, 폰트 넣기(fontEmbed.ts)
  windowControls.ts    틀 없는 주 창의 창 단추 채널(window:*). windowState.ts 는 창 크기·자리 기억(window.json)
  buildNotes.ts gameRun.ts bridge.ts settings.ts story.ts
src/mcp/               Claude CLI 가 띄우는 stdio MCP 서버. 도구 호출을 로컬 브리지로 메인에 넘긴다
src/preload/           렌더러에 window.api 를(index.ts), 렌더 작업 창에 그 통로를(render.ts) 내준다
src/renderer/          React 화면. 상태와 액션은 state.ts, 화면 전환과 오른쪽 패널 접기는 App.tsx, Ctrl+K 명령 표는 commands.ts, 그림 찍기는 render-worker/
  components/ui.tsx    화면 공통 부품(ScreenHead, Seg, Switch, Callout, Tile, EmptyState, SetRow, Stat). 화면은 이것을 쓴다
  components/Inkdrop.tsx  도우미 캐릭터 먹물이(채팅, 빈 화면)
  theme.css            테마 여덟 가지의 토큰과 뜻 색, 공통 부품 모양, 움직임
  filterGroups.ts guideBlocks.ts  텍스트 거르기 묶음, 번역 지침을 ## 제목에서 나누기
src/shared/            메인과 렌더러가 같이 쓰는 것. api.ts(채널 목록과 window.api 모양), rows.ts(행·필터·통계)
tests/                 src 와 같은 구조. tests/e2e 는 앱을 실제로 띄운다. 가짜 window.api 는 tests/renderer/fakeApi.tsx
```

데이터의 흐름: 원본 게임(읽기 전용) → 프로젝트 폴더의 `original/vN/` 사본 → `units.json`(추출한 문장) → `translations.json`(번역표, 원문으로 만든 id 가 열쇠) + `glossary.json`(용어집과 지침) + `decisions.json`(판단 필요 결정) + `patches.json`(원본 대비 수정) + `images.json`(그림 작업 지시서) + `preview.json`(게임 폰트와 대사창 치수) → `builds/NNN/`(바뀐 파일만 묶은 패치 zip, 패치노트). 게임 업데이트를 가져오면 바뀌기 전 파일이 `backups/before-vN/` 에, 결과 요약이 `updates/vN.json` 에 남는다. 자세한 것은 `docs/ARCHITECTURE.md`.

## 꼭 지킬 것

- **원본 게임 폴더에는 절대 쓰지 않는다.** 모든 쓰기는 프로젝트 폴더 안에서만 한다.
- **프로젝트 데이터는 `ProjectService` 만 쓴다.** 렌더러와 MCP 서버는 파일을 직접 쓰지 않는다.
- **코드가 읽는 값을 말없이 번역하지 않는다.** 파일 이름, 스위치·변수 이름, 플러그인이 비교하는 키를 번역하면 게임이 깨진다. 확실하지 않은 문자열은 `needsDecision` 으로 두고 사용자나 Claude가 판단한 뒤에만 번역한다.
- **제어문자(`\C[2]`, `\V[1]`, `%1` 등)는 종류와 개수를 보존한다.** 검사기가 확인한다.
- **Claude CLI 에는 앱의 MCP 도구만 준다.** 내장 도구는 끈다(`--tools ""`). 사용자 전역 설정과 기본 시스템 프롬프트도 뺀다(`--setting-sources project`, `--system-prompt`). 호출마다 수천 토큰이 걸린 문제라서 되돌리지 않는다.
- **공개 이름은 바꾸지 말고 추가한다.** `src/core/index.ts` 와 `src/shared/api.ts` 의 이름에 다른 코드와 계획서가 기댄다.
- **사용자에게 보이는 문구는 한국어, 코드의 식별자와 주석은 영어.** 주석은 코드가 무엇을 하는지가 아니라 왜 그렇게 했는지를 적는다.
- **색은 뜻이다.** 상태는 뜻 색 토큰(`--ok` 끝남·승인, `--info` 새로 생김·Claude 가 함·아직 사람이 안 봄, `--warn` 사람이 봐야 함, `--err` 막힘)으로 말하고, 강조색(`--accent`)은 주 단추와 지금 고른 것에만 쓴다. 색은 테마 토큰만 쓴다.

## 화면을 고칠 때

겉모양을 모든 화면에 한꺼번에 입혔더니 "양산형 같다"는 말을 들었다(기획서 9장). 화면마다 아래를 지킨다. 부품과 토큰은 `docs/ARCHITECTURE.md` 4장 "화면 하나 더하기".

- **쓰임새부터.** 그 화면에 무엇을 하러 오는지를 한 줄로 정하고, 그 일에 필요한 것이 가장 크고 가장 위에 온다.
- **주 단추는 화면에 하나.** 나머지는 조용한 단추. 줄마다 되풀이되는 단추는 펼친 줄이나 가리킨 줄에서만 또렷하게.
- **숫자는 글에서 꺼낸다.** 판단에 쓰는 수는 큰 숫자 칸(`Stat`)으로, 0 은 흐리게. 같은 수를 두 곳에 되풀이하지 않는다.
- **덜 중요한 것은 접는다.** 지난 것, 가끔 쓰는 것, 길게 늘어지는 목록은 한 줄로 줄이고 누르면 펼친다.
- **뜻 없는 꾸밈은 넣지 않는다.** 그림자, 테두리, 타일, 장식 글꼴은 구별을 도울 때만. 게임 제목에는 장식 글꼴을 쓰지 않는다(일본어·한자가 깨진다).
- **표의 줄은 스크롤·선택·글자 입력에 움직이지 않는다.** 줄의 높이와 글자 크기도 바꾸지 않는다.
- **좁은 창(폭 1100~1440)에서도 본다.** 오른쪽 패널을 접었을 때와 폈을 때 모두. 화면은 내용이 찬 상태로 실제 앱에서 확인한다.

## 일하는 방식

- 기능은 시험을 먼저 쓰고 만든다. 계획서의 각 작업이 그 순서로 적혀 있다.
- 끝났다고 말하기 전에 직접 돌린다: `npx vitest run`, `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`, `npm run build:app && npm run test:e2e`, 그리고 `npm run build` 뒤 `node dist/cli.js --help`(명령줄 도구가 실제로 뜨는지).
- 시험용 작은 게임(`tests/helpers/miniGame.ts`)만으로는 실제 게임의 다양함을 알 수 없다. 추출이나 적용을 고쳤으면 실제 MV 게임과 MZ 게임에서 `node dist/cli.js import <게임 폴더> <임시 프로젝트 폴더> --name <이름>` 을 돌려 본다(게임 폴더는 사용자에게 받는다. 읽기만 한다).
- 실제 Claude CLI 를 쓰는 시험은 `MVMZ_REAL_CLI=1` 일 때만 돌고 가장 싼 모델을 쓴다. 꼭 필요할 때만 돌린다.
- 커밋은 작업 단위로 작게, 메시지는 한국어로 `feat:` `fix:` `perf:` `refactor:` `docs:` `chore:` 를 앞에 붙인다.
- 채팅 도구, 화면, IPC 채널, 추출 대상을 더할 때 손대는 곳은 `docs/ARCHITECTURE.md` 4장에 있다.
- 계획서를 쓰던 때의 "같이 쓰는 파일은 맨 끝에 추가만" 규칙은 끝났다. 새 코드는 제자리(맞는 파일, 맞는 묶음)에 넣고, import 는 파일 맨 위에, 이름은 뜻이 드러나게 짓는다. 코드와 주석에 계획 번호를 적지 않는다.

## 사용자가 정해 둔 규칙

- **프로그램 설치가 필요하면 멈추고 묻는다.** 없는 프로그램을 다른 프로그램에 딸린 것으로 대신 쓰거나 버전을 낮춰 진행하지 않는다. `npm install` 로 프로젝트 안에 들어가는 것은 괜찮다. 승인하면 winget 같은 공식 경로로 설치한다.
- **토큰을 아낀다.** Claude가 게임 전체를 읽게 만드는 설계는 피한다. 프로그램이 추려서 필요한 조각만 보낸다.
- **번역 품질에서 의성어와 신음이 중요하다.** 어색한 음차를 피하고, 신음은 인물의 성격에 맞춘다. 기준은 `docs/default-style-guide.md`.

## 환경

- Windows 11, Node 22(64비트, `C:\Program Files\nodejs`), git, Claude CLI(winget 설치). Python 3.12 가 있다(`py` 런처로 부른다. `python` 은 윈도우 스토어 안내용 빈 파일이 먼저 잡힌다). 앱은 Python 을 쓰지 않는다.
- 셸에 따라 `node` 나 `claude` 가 PATH 에 안 잡힐 수 있다. 그럴 때는 위 경로를 PATH 앞에 붙인다.
- 배포용 묶기: `npm run dist` → `release/` 에 설치 파일과 `latest.yml`(zip 은 스스로 업데이트할 수 없어 뺐다). 새 버전 내보내기는 사용자가 "새 버전 내자"라고 하면 Claude 가 한다: 확인 명령을 모두 통과시킨 뒤 `package.json` 버전을 올리고 CHANGELOG "준비 중"에 번호와 날짜를 붙여 커밋·push 하고, `npm.cmd run release` 를 돌린다(`scripts/release.mjs` 가 `~/.sosa-translator/release-token` 파일이나 `GH_TOKEN` 에서 토큰을 읽는다. Claude 는 그 파일을 열거나 토큰 값을 보거나 적지 않는다). GitHub(sesa1224/sosa-translator) 릴리스는 바로 공개되어 친구 앱이 받는다. 설정은 `electron-builder.yml`. 서명 인증서가 없어 서명은 하지 않는다.

## 아직 없는 것

- 뭉친 exe(Enigma Virtual Box) 풀기는 게임 파일만 꺼낸다. 원래 실행 파일은 되살리지 않는다. 압축된 꾸러미는 직접 만든 시험 자료로만 확인했고 실제 게임으로는 아직 못 돌려 봤다(시험 표본 `tests/fixtures/evb` 는 모두 압축 안 된 것). 백신이 표본 exe 를 격리하면 그 시험은 건너뛴다.
- `.ttc`(폰트 모음 파일): 폰트 목록에 수만 보이고 쓸 수 없다.
- 코드 서명: 인증서가 없어 배포 파일에 서명하지 않는다.
- 계획 1~7(3b 포함)은 모두 끝났다. 실제 게임 두 버전으로 업데이트 가져오기를 해 보는 확인은 사람이 할 일로 남아 있다(계획 6 끝의 "사람이 확인할 것").
- 바뀐 점은 `CHANGELOG.md` 를 본다.
