# MV/MZ 번역 작업실 — 핵심 엔진

RPG Maker MV/MZ 게임의 일본어 → 한국어 번역에서 기계적인 일(가져오기, 텍스트 추출, 형식 검사, 재삽입, 패치 zip 빌드)을 맡는 라이브러리(`src/core`)와 명령줄(`src/cli.ts`)입니다. 원본 게임 폴더에는 아무것도 쓰지 않습니다.

설계: `docs/2026-11-13-mvmz-번역작업실-기획서.md`, 계획: `docs/superpowers/plans/2026-11-13-plan1-core-engine.md`

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
