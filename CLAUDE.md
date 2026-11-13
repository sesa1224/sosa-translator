# SoSa Translator (MV/MZ 번역 작업실)

RPG Maker MV/MZ 게임을 일본어에서 한국어로 번역하는 윈도우용 데스크톱 앱이다. 풀기, 추출, 검사, 재삽입, 패치 빌드 같은 기계적인 일은 프로그램이 하고, Claude에게는 번역과 판단만 맡겨 토큰을 아끼는 것이 목적이다.

이 파일은 이 저장소에서 일하는 Claude가 가장 먼저 읽는 안내다. 사용자는 개발자가 아니며 한국어로 소통한다.

## 먼저 읽을 문서

| 문서 | 내용 |
|---|---|
| `docs/2026-11-13-mvmz-번역작업실-기획서.md` | 무엇을 왜 만드는지. 사용자가 정한 것은 `[확정]`, Claude가 정한 기본값은 `[내 선택]` 으로 표시돼 있다. 9장은 실제 게임으로 시험하며 알게 된 것 |
| `docs/superpowers/plans/` | 단계별 구현 계획. 각 계획의 체크박스가 진행 상태다 |
| `docs/default-style-guide.md` | 새 프로젝트에 들어가는 기본 번역 지침. 빌드 때 앱에 그대로 들어간다. 이 파일을 고치면 기본값이 바뀐다 |
| `docs/mockup/Main.dc.html` | 화면 시안. 배치, 간격, 문구의 기준(시안 도구 형식이라 그대로 실행되지는 않는다) |
| `README.md` | 실행 방법, 프로젝트 폴더의 파일, 채팅 도구 목록 |
| `CHANGELOG.md` | 버전별 바뀐 점. 사용자에게 보이는 변화가 생기면 여기에 한 줄을 더한다 |

## 구조

```
src/core/      화면도 Electron도 모르는 순수 라이브러리. 추출, 번역표, 용어집, 검사, 적용, 패치 빌드
src/cli.ts     core 를 명령줄로 쓰는 얇은 껍데기 (mvmz import / export / apply / check / build / status)
src/main/      Electron 메인 프로세스. ProjectService(열린 프로젝트의 유일한 소유자), IPC, Claude CLI 연결, 번역·검수 작업
src/mcp/       Claude CLI 가 띄우는 stdio MCP 서버. 도구 호출을 로컬 브리지로 메인에 넘긴다
src/preload/   렌더러에 window.api 를 내준다
src/renderer/  React 화면
src/shared/    메인과 렌더러가 같이 쓰는 타입과 순수 함수
tests/         src 와 같은 구조. tests/e2e 는 앱을 실제로 띄운다
```

데이터의 흐름: 원본 게임(읽기 전용) → 프로젝트 폴더의 `original/` 사본 → `units.json`(추출한 문장) → `translations.json`(번역표) + `glossary.json`(용어집과 지침) → `builds/NNN/`(바뀐 파일만 묶은 패치 zip).

## 꼭 지킬 것

- **원본 게임 폴더에는 절대 쓰지 않는다.** 모든 쓰기는 프로젝트 폴더 안에서만 한다.
- **프로젝트 데이터는 `ProjectService` 만 쓴다.** 렌더러와 MCP 서버는 파일을 직접 쓰지 않는다.
- **코드가 읽는 값을 말없이 번역하지 않는다.** 파일 이름, 스위치·변수 이름, 플러그인이 비교하는 키를 번역하면 게임이 깨진다. 확실하지 않은 문자열은 `needsDecision` 으로 두고 사용자나 Claude가 판단한 뒤에만 번역한다.
- **제어문자(`\C[2]`, `\V[1]`, `%1` 등)는 종류와 개수를 보존한다.** 검사기가 확인한다.
- **Claude CLI 에는 앱의 MCP 도구만 준다.** 내장 도구는 끈다(`--tools ""`). 사용자 전역 설정과 기본 시스템 프롬프트도 뺀다(`--setting-sources project`, `--system-prompt`). 호출마다 수천 토큰이 걸린 문제라서 되돌리지 않는다.
- **공개 이름은 바꾸지 말고 추가한다.** `src/core/index.ts` 와 `src/shared/api.ts` 의 이름에 다른 코드와 계획서가 기댄다.
- **사용자에게 보이는 문구는 한국어, 코드의 식별자와 주석은 영어.** 주석은 코드가 무엇을 하는지가 아니라 왜 그렇게 했는지를 적는다.

## 일하는 방식

- 기능은 시험을 먼저 쓰고 만든다. 계획서의 각 작업이 그 순서로 적혀 있다.
- 끝났다고 말하기 전에 직접 돌린다: `npx vitest run`, `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`, `npm run build:app && npm run test:e2e`.
- 시험용 작은 게임(`tests/helpers/miniGame.ts`)만으로는 실제 게임의 다양함을 알 수 없다. 추출이나 적용을 고쳤으면 실제 MV 게임과 MZ 게임에서 `mvmz import` 를 돌려 본다(게임 폴더는 사용자에게 받는다. 읽기만 한다).
- 실제 Claude CLI 를 쓰는 시험은 `MVMZ_REAL_CLI=1` 일 때만 돌고 가장 싼 모델을 쓴다. 꼭 필요할 때만 돌린다.
- 커밋은 작업 단위로 작게, 메시지는 한국어로 `feat:` `fix:` `perf:` `docs:` `chore:` 를 앞에 붙인다.

## 사용자가 정해 둔 규칙

- **프로그램 설치가 필요하면 멈추고 묻는다.** 없는 프로그램을 다른 프로그램에 딸린 것으로 대신 쓰거나 버전을 낮춰 진행하지 않는다. `npm install` 로 프로젝트 안에 들어가는 것은 괜찮다. 승인하면 winget 같은 공식 경로로 설치한다.
- **토큰을 아낀다.** Claude가 게임 전체를 읽게 만드는 설계는 피한다. 프로그램이 추려서 필요한 조각만 보낸다.
- **번역 품질에서 의성어와 신음이 중요하다.** 어색한 음차를 피하고, 신음은 인물의 성격에 맞춘다. 기준은 `docs/default-style-guide.md`.
- **등장인물이 미성년자인 성적 내용은 다루지 않는다.** 사용자도 그런 게임은 하지 않는다고 했다.

## 환경

- Windows 11, Node 22(64비트, `C:\Program Files\nodejs`), git, Claude CLI(winget 설치). Python 은 없다.
- 셸에 따라 `node` 나 `claude` 가 PATH 에 안 잡힐 수 있다. 그럴 때는 위 경로를 PATH 앞에 붙인다.
- 배포용 묶기: `npm run dist` → `release/` 에 설치 파일과 zip. 설정은 `electron-builder.yml`. 서명 인증서가 없어 서명은 하지 않는다.

## 아직 없는 것

- exe 하나로 뭉쳐진 게임(Enigma) 풀기: Python 이 필요해 보류.
- 계획 5(이벤트 보기와 수정, 폰트를 게임에 넣기), 6(게임 업데이트 대응), 7(이미지 번역, 패치노트).
- 진행 상태는 `docs/superpowers/plans/` 의 체크박스와 `CHANGELOG.md` 를 본다.
