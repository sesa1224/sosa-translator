# MV/MZ 번역 작업실 · 계획 3: 용어집과 번역 흐름 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 게임을 가져온 뒤 "용어집과 말투 지침 초안 → 사용자 확정 → 전체 번역 → 형식 검사 → 검수"를 앱 안에서 한 바퀴 돌 수 있게 한다. 단계마다 모델을 따로 고를 수 있고, 애매한 용어는 추천안으로 진행한 뒤 표시한다.

**Architecture:** 용어집과 화자 줄 처리는 `src/core` 에 순수 함수로 둔다. 묶음 번역과 검수는 채팅 대화가 아니라 묶음마다 Claude CLI를 한 번씩 따로 실행해 정해진 JSON 형식으로 답을 받고(`runClaudeJson`), 결과는 모두 `ProjectService` 를 거쳐 번역표에 들어간다. 작업 진행 상태는 번역표 자체가 기억하므로, 멈췄다 이어 하면 남은 것만 다시 묶는다.

**Tech Stack:** 계획 2와 같다. 새 런타임 의존성 없음.

**Spec:** `docs/2026-11-13-mvmz-번역작업실-기획서.md` (4.3, 4.4, 4.5, 4.11, 4.12, 5.1, 9장), 기본 지침 원문 `docs/default-style-guide.md`, 화면 기준 `docs/mockup/Main.dc.html` (용어집 화면, 설정의 단계별 모델).

## 계획 3에서 하지 않는 것 (계획 3b로 미룸)

"판단 필요" 항목의 자동 처리(플러그인 커맨드 틀, 스크립트 속 일본어 구간만 바꾸기, 메모란과 플러그인 JS 파일 추출), 외부 번역용 꾸러미 내보내기. 계획 3의 전체 번역은 `needsDecision` 이 아닌 항목만 다룬다.

## Global Constraints

- 계획 1, 2의 공개 이름은 바꾸지 않고 추가만 한다. 기존 시험 132개는 계속 통과해야 한다. 단, 도구 목록이나 상태 종류를 **전부 나열한** 기존 단언(예: 도구 6개 목록, `--allowedTools` 값, 상태 필터 칩)은 이 계획이 늘린 만큼 고쳐도 된다.
- 묶음 호출 인자(2.1.318에서 실제로 확인함): `claude -p --model <id> --output-format json --tools "" --strict-mcp-config --setting-sources project --disable-slash-commands --system-prompt <글> --json-schema <스키마 JSON>`, 사용자 글은 표준 입력으로 보낸다. 답은 표준 출력의 JSON 한 덩어리이고, 그 안의 `structured_output` 이 스키마에 맞는 객체, `is_error`, `subtype`, `result`, `usage`(`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`)가 있다.
- 번역 대상 언어 쌍과 지침은 프로젝트의 용어집에서 읽는다. 코드에 일본어·한국어 문구를 박지 않는다(기본 지침 파일과 조사 처리 제외).
- 기본 말투 지침의 글은 `docs/default-style-guide.md` 를 빌드 때 그대로 넣는다(파일을 고치면 새 프로젝트의 기본값이 바뀐다). 글을 코드에 다시 타이핑하지 않는다.
- 모든 번역 쓰기는 `ProjectService` 를 거친다. 출처는 `'user' | 'chat' | 'batch' | 'review'`.
- 사용자에게 보이는 문구는 한국어. 성인용 게임의 문장이 그대로 프롬프트에 들어가므로, 프롬프트 글에 "등장인물은 모두 성인이며 제작자 또는 사용자의 의뢰로 번역한다"는 문장을 넣지 않는다. 그런 사실 주장은 프로젝트의 말투 지침(사용자가 쓰는 글)에만 있다.
- 시스템에 프로그램 설치가 필요하거나 버전이 맞지 않으면 우회하지 말고 멈춰서 보고한다.
- 실제 CLI를 쓰는 시험은 `MVMZ_REAL_CLI=1` 일 때만 돌고, 모델은 `claude-haiku-5-5`, 시험용 작은 게임(`makeMiniGame`)만 쓴다. 사용자의 실제 게임 폴더는 읽지 않는다.
- 커밋은 작업마다 한 번.

## Review Focus

1. **모델이 항목을 빼먹거나 번호를 틀리게 돌려줄 때**: 돌아오지 않은 항목은 미번역으로 남고, 묶음에 없던 번호는 버린다. 다른 항목의 번역이 엉뚱한 줄에 들어가지 않는다. → 작업 7
2. **사용량 한도에 걸렸을 때**: 작업이 "한도 때문에 멈춤" 상태가 되고, 끝난 묶음은 유지되며, "이어하기"를 누르면 남은 것만 다시 한다. 앱을 껐다 켜도 남은 것만 다시 한다. → 작업 7
3. **조사 자동 맞춤이 틀릴 수 있는 자리**: 바꾼 용어 뒤의 글자가 조사인지 다른 낱말의 첫 글자인지 알 수 없으면 고치지 않고 "검토 필요"로 올린다. → 작업 2
4. **화자 줄 패턴이 일부 대사에만 맞을 때**: 첫 줄이 패턴에 안 맞는 대사는 화자 없이 전체가 번역 대상이다. 줄이 하나뿐인 대사는 화자 줄로 떼지 않는다. → 작업 3
5. **용어가 다른 용어의 일부일 때**: `玃猿` 과 `大玃猿` 이 둘 다 있으면 긴 것부터 맞춘다. 묶음에 붙이는 용어와 일치 검사 모두. → 작업 2

---

## File Structure

```
src/core/glossary/types.ts      Term, CharacterCard, Glossary, FormatRules 확장
src/core/glossary/store.ts      읽기, 쓰기, 기본값
src/core/glossary/match.ts      글에 나오는 용어 찾기, 일치 검사
src/core/glossary/josa.ts       조사 맞춤
src/core/glossary/rename.ts     용어 바꾸기 → 번역문 갱신 계획
src/core/text/speaker.ts        화자 줄 패턴
src/main/claude/json.ts         runClaudeJson
src/main/translate/material.ts  용어집 자료 모으기
src/main/translate/draft.ts     용어집 초안
src/main/translate/batches.ts   묶음 나누기, 프롬프트
src/main/translate/job.ts       번역 작업 실행기
src/main/translate/review.ts    검수 작업
src/renderer/components/GlossaryView.tsx  JobBar.tsx  ReviewDialog.tsx
tests/fixtures/fake-claude-json.mjs
```

## 공용 타입 (작업 1에서 만든다)

```ts
// src/core/glossary/types.ts
export type TermCategory = 'name' | 'place' | 'term' | 'sfx' | 'other';
export interface TermCandidate { target: string; reason: string }
export interface Term {
  id: string;                 // sha1(source) 앞 12자
  source: string; target: string; category: TermCategory;
  status: 'confirmed' | 'provisional';   // provisional = 추천안으로 진행 중
  candidates: TermCandidate[];           // provisional 일 때 2~3개. candidates[0].target === target
  note?: string;
}
export interface CharacterCard { id: string; source: string; target: string; speech: string; firstPerson?: string; addressing?: string }
export interface ProjectRules extends FormatRules {
  maxLineWidthChars: number | null;   // 한글 기준 글자 수(반각 0.5). 픽셀 폭 검사는 계획 4
  speakerPattern: string | null;      // 정규식 글자. 첫 번째 묶음이 화자 이름
}
export interface Glossary { terms: Term[]; characters: CharacterCard[]; styleGuide: string; rules: ProjectRules; confirmedAt: string | null }

// src/core/types.ts 에 추가
// TranslationStatus 에 'declined' 추가.  Issue.rule 에 'glossary' | 'line-width' 추가.
// TranslationEntry 에 선택 필드 추가: declinedReason?: string; review?: { problem: string; suggestion: string; model: string }
// src/shared/api.ts 에 추가
// Origin 에 'batch' | 'review'.  Row 에 usesProvisional: boolean, declinedReason?: string, review?: {...}.  StatusFilter 에 'declined' | 'provisional'.  Stats 에 declined, provisional.
// AppSettings 에 stageModels: { glossary: string; translate: string; review: string; patchNotes: string }
//   기본값 { glossary: 'claude-fable-5-2', translate: 'claude-opus-5-5', review: 'claude-fable-5-2', patchNotes: 'claude-haiku-5-5' }
export type JobKind = 'draft' | 'translate' | 'review';
export type JobState = 'idle' | 'running' | 'paused' | 'paused-limit' | 'done' | 'failed' | 'stopped';
export interface JobProgress { kind: JobKind; state: JobState; done: number; total: number; label: string; usage: ChatUsage; declined: number; errors: number; message?: string }
```

---

### Task 1: 용어집 저장과 기본값, 타입 확장

**Files:**
- Create: `src/core/glossary/types.ts`, `src/core/glossary/store.ts`
- Modify: `src/core/types.ts`, `src/core/index.ts`, `src/shared/api.ts`, `src/shared/rows.ts`, `electron.vite.config.ts`·`vitest.config.ts`(`docs/default-style-guide.md` 를 글로 가져오기: `?raw`)
- Test: `tests/glossary/store.test.ts`

**Interfaces:**
- Produces: `DEFAULT_STYLE_GUIDE: string`(파일의 첫 제목과 그 아래 안내 문단을 뺀 본문), `defaultGlossary(): Glossary` — `terms []`, `characters []`, `styleGuide DEFAULT_STYLE_GUIDE`, `rules { controlCodes: true, noLeftoverJapanese: true, sameLineCount: false, maxLines: 4, maxLineWidthChars: null, speakerPattern: null }`, `confirmedAt null`
- Produces: `loadGlossary(projectDir): Promise<Glossary>`(없으면 기본값, 빠진 필드는 기본값으로 채움), `saveGlossary(projectDir, g)` → `<projectDir>/glossary.json`, `termId(source): string`
- Produces: `computeStats` 가 `declined`, `provisional` 을 센다. `filterRows` 가 `'declined'`, `'provisional'` 을 받는다

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('기본 지침이 들어간다', () => {
  const g = defaultGlossary(); expect(g.styleGuide).toContain('의성어, 의태어, 신음'); expect(g.styleGuide).toContain('찌걱찌걱');
  expect(g.styleGuide.startsWith('# 기본 번역 지침')).toBe(false); expect(g.confirmedAt).toBeNull(); expect(g.rules.speakerPattern).toBeNull();
});
test('저장하고 읽기, 빠진 필드 채우기', async () => {
  const g = defaultGlossary(); g.terms.push({ id: termId('玃猿'), source: '玃猿', target: '확원', category: 'term', status: 'confirmed', candidates: [] });
  await saveGlossary(proj, g); expect((await loadGlossary(proj)).terms[0].target).toBe('확원');
  await writeFile(path.join(proj, 'glossary.json'), JSON.stringify({ terms: [] })); expect((await loadGlossary(proj)).rules.maxLines).toBe(4);
});
test('새 상태를 센다', () => {
  expect(computeStats(rowsWith({ declined: 2, provisional: 3 }))).toMatchObject({ declined: 2, provisional: 3 });
  expect(filterRows(rows, { status: 'declined' }).every(r => r.status === 'declined')).toBe(true);
  expect(filterRows(rows, { status: 'provisional' }).every(r => r.usesProvisional)).toBe(true);
});
```

- [x] **Step 2: `npx vitest run tests/glossary/store.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS, 전체 `npx vitest run` 통과**
- [x] **Step 5: `git commit -m "feat: 용어집 저장과 기본 번역 지침"`**

### Task 2: 용어 찾기, 일치 검사, 조사, 용어 바꾸기

**Files:**
- Create: `src/core/glossary/match.ts`, `src/core/glossary/josa.ts`, `src/core/glossary/rename.ts`
- Modify: `src/core/check/format.ts`(용어 일치와 줄 폭 검사를 선택 인자로 추가)
- Test: `tests/glossary/match.test.ts`

**Interfaces:**
- Produces: `termsIn(text: string, terms: Term[]): Term[]` — 긴 source 부터 맞추고, 이미 긴 용어가 차지한 자리는 짧은 용어가 다시 맞추지 않는다. 나온 순서, 중복 없음
- Produces: `checkGlossary(source: string, target: string, terms: Term[]): Issue[]` — `termsIn(source)` 의 각 용어에 대해 target 에 `term.target` 이 없으면 `{ rule: 'glossary', severity: 'warning', message: '용어 "<source>"는 "<target>"(으)로 옮깁니다' }`. `category: 'sfx'` 도 같은 규칙
- Produces: `lineWidthChars(line: string): number` — 제어문자를 뺀 뒤 반각(U+0020~U+007E, 반각 가타카나)은 0.5, 나머지는 1
- Produces: `checkTranslation(unit, target, rules?, glossary?: { terms: Term[]; maxLineWidthChars: number | null })` — 기존 동작 + 용어 검사 + 줄 폭 초과 시 `line-width` warning(원문의 같은 줄이 이미 넘으면 내지 않는다)
- Produces: `hasFinalConsonant(word: string): boolean | null`(마지막 글자가 한글이 아니면 숫자·영문 규칙 없이 null), `fixJosa(text: string, wordEnd: number, word: string): { text: string; certain: boolean }`
- Produces: `planRename(term: Term, newTarget: string, units: TextUnit[], entryOf: (id: string) => TranslationEntry): { id: string; newTarget: string; certain: boolean }[]`

조사 규칙: 바꾼 낱말 바로 뒤가 아래 짝 중 하나로 시작하고, 그 조사 뒤가 공백·문장부호·줄 끝·제어문자일 때만 받침에 맞는 쪽으로 바꾼다. 짝: `을/를`, `이/가`, `은/는`, `과/와`, `으로/로`(ㄹ 받침은 `로`), `아/야`, `이랑/랑`, `이나/나`, `이라/라`, `이야/야`. 조사 뒤에 다른 글자가 바로 이어지면 고치지 않고 `certain: false`. 뒤가 조사가 아니면 그대로 두고 `certain: true`. `hasFinalConsonant` 가 null 이면 `certain: false`.

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
const T = (source: string, target: string, category: TermCategory = 'term'): Term => ({ id: termId(source), source, target, category, status: 'confirmed', candidates: [] });
test('긴 용어부터', () => {
  const terms = [T('玃猿', '확원'), T('大玃猿', '큰 확원')];
  expect(termsIn('大玃猿が来た', terms).map(t => t.source)).toEqual(['大玃猿']);
  expect(termsIn('玃猿と大玃猿', terms).map(t => t.source)).toEqual(['玃猿', '大玃猿']);
});
test('용어 일치 검사', () => {
  expect(checkGlossary('月光草を集める', '달빛풀을 모은다', [T('月光草', '월광초')])[0]).toMatchObject({ rule: 'glossary', severity: 'warning' });
  expect(checkGlossary('月光草を集める', '월광초를 모은다', [T('月光草', '월광초')])).toEqual([]);
  expect(checkGlossary('ぐちゅぐちゅ', '질척질척', [T('ぐちゅぐちゅ', '찌걱찌걱', 'sfx')])).toHaveLength(1);
});
test('줄 폭', () => {
  expect(lineWidthChars('가나다 abc\\C[2]')).toBe(5); // 3 + 공백 0.5 + abc 1.5
  const u = { id: 'i', kind: 'dialogue', source: 'あ', needsDecision: false, refs: [] } as TextUnit;
  expect(checkTranslation(u, '가'.repeat(31), undefined, { terms: [], maxLineWidthChars: 30 })[0]).toMatchObject({ rule: 'line-width', severity: 'warning' });
  expect(checkTranslation({ ...u, source: 'あ'.repeat(40) }, '가'.repeat(31), undefined, { terms: [], maxLineWidthChars: 30 })).toEqual([]);
});
test('조사 맞춤', () => {
  const fix = (s: string, w: string) => fixJosa(s, s.indexOf(w) + w.length, w);
  expect(fix('리나를 봤다', '리나')).toEqual({ text: '리나를 봤다', certain: true });
  expect(fix('월광초을 모았다', '월광초')).toEqual({ text: '월광초를 모았다', certain: true });
  expect(fix('확원가 왔다', '확원')).toEqual({ text: '확원이 왔다', certain: true });
  expect(fix('샘로 간다', '샘')).toEqual({ text: '샘으로 간다', certain: true }); expect(fix('마을으로 간다', '마을')).toEqual({ text: '마을로 간다', certain: true });
  expect(fix('리나이야기', '리나')).toEqual({ text: '리나이야기', certain: false });   // 조사인지 알 수 없음
  expect(fix('리나 씨', '리나')).toEqual({ text: '리나 씨', certain: true });
  expect(fix('A가 왔다', 'A').certain).toBe(false);
});
test('용어 바꾸기 계획', () => {
  const plan = planRename(T('玃猿', '확원'), '원숭이', units, entryOf);
  expect(plan).toContainEqual({ id: 'u1', newTarget: '원숭이가 왔다', certain: true });   // '확원이 왔다'
  expect(plan.find(p => p.id === 'u2')).toMatchObject({ certain: false });                // '확원이야기'
  expect(plan.some(p => p.id === 'u3')).toBe(false);                                      // 원문에 용어 없음
});
```

- [x] **Step 2: `npx vitest run tests/glossary/match.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 용어 일치 검사와 조사 맞춤"`**

### Task 3: 화자 줄 패턴

**Files:**
- Create: `src/core/text/speaker.ts`
- Test: `tests/text/speaker.test.ts`

**Interfaces:**
- Produces: `SPEAKER_PRESETS: { id: string; label: string; pattern: string }[]` — `bracket`: `^(?:\\[A-Za-z]+\[\d+\])*【(.+?)】(?:\\[A-Za-z]+\[\d+\])*$`, `name-code`: `^\\[Nn]<(.+?)>$`, `colon`: `^(.{1,12})[:：]$`
- Produces: `detectSpeakerPattern(units: TextUnit[]): { pattern: string; presetId: string; coverage: number } | null` — 줄이 2개 이상인 `dialogue` 중 첫 줄이 맞는 비율이 가장 높은 프리셋. 비율이 0.3 미만이면 null
- Produces: `splitSpeaker(source: string, pattern: string | null): { speakerLine: string | null; speaker: string | null; body: string }` — 줄이 하나뿐이거나 첫 줄이 안 맞으면 `speakerLine: null`, `body: source`
- Produces: `composeSpeaker(speakerLine: string, speaker: string, speakerTarget: string, body: string): string` — 첫 줄에서 이름만 바꾸고(제어문자와 괄호는 그대로) `'\n' + body`
- Produces: `speakerNames(units: TextUnit[], pattern: string | null): { name: string; count: number }[]` — `unit.speaker`(MZ)와 화자 줄에서 뽑은 이름을 합쳐 많은 순

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
const D = (source: string): TextUnit => ({ id: source, kind: 'dialogue', source, needsDecision: false, refs: [] });
const bracket = SPEAKER_PRESETS.find(p => p.id === 'bracket')!.pattern;
test('패턴 찾기', () => {
  const units = [D('\\C[4]【アーテル】\\C[0]\n「もちろん無料で」'), D('\\C[4]【ギア】\\C[0]\n「ふん」'), D('地の文だけ'), D('【アーテル】\n「え？」')];
  expect(detectSpeakerPattern(units)).toMatchObject({ presetId: 'bracket', coverage: 1 });
  expect(detectSpeakerPattern([D('あ\nい'), D('う\nえ')])).toBeNull();
});
test('떼고 다시 붙이기', () => {
  const s = splitSpeaker('\\C[4]【アーテル】\\C[0]\n「冗談よ、\nちゃんと払うわ」', bracket);
  expect(s).toEqual({ speakerLine: '\\C[4]【アーテル】\\C[0]', speaker: 'アーテル', body: '「冗談よ、\nちゃんと払うわ」' });
  expect(composeSpeaker(s.speakerLine!, s.speaker!, '아텔', '「농담이야,\n제대로 낼게」')).toBe('\\C[4]【아텔】\\C[0]\n「농담이야,\n제대로 낼게」');
});
test('안 맞거나 한 줄이면 떼지 않는다', () => {
  expect(splitSpeaker('【注意】', bracket)).toEqual({ speakerLine: null, speaker: null, body: '【注意】' });
  expect(splitSpeaker('ただの文\n二行目', bracket).speakerLine).toBeNull(); expect(splitSpeaker('あ\nい', null).body).toBe('あ\nい');
});
test('화자 이름 모으기', () => {
  expect(speakerNames([D('【アーテル】\nあ'), D('【アーテル】\nい'), D('【ギア】\nう'), { ...D('え'), speaker: 'リナ' }], bracket)).toEqual([{ name: 'アーテル', count: 2 }, { name: 'ギア', count: 1 }, { name: 'リナ', count: 1 }]);
});
```

- [x] **Step 2: `npx vitest run tests/text/speaker.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 화자 줄 패턴"`**

### Task 4: runClaudeJson

**Files:**
- Create: `src/main/claude/json.ts`, `tests/fixtures/fake-claude-json.mjs`
- Test: `tests/main/claudeJson.test.ts`, `tests/main/realCliJson.test.ts`

**Interfaces:**
- Consumes: `findClaude`
- Produces:

```ts
export type JsonCallResult<T> =
  | { ok: true; data: T; usage: ChatUsage }
  | { ok: false; kind: 'limit' | 'auth' | 'refused' | 'invalid' | 'spawn' | 'aborted' | 'other'; message: string; usage: ChatUsage };
export function runClaudeJson<T>(o: { command: string; prefixArgs?: string[]; cwd: string; model: string; system: string; user: string;
  schema: object; validate: (v: unknown) => v is T; signal?: AbortSignal; timeoutMs?: number }): Promise<JsonCallResult<T>>;
```

판정: 실행 실패 → `spawn`. `signal` 로 끊김 → `aborted`. 시간 초과(기본 10분) → `other`, 메시지 `'응답 시간이 초과됐습니다'`. 출력이 JSON 이 아니거나 `structured_output` 이 없거나 `validate` 실패 → `invalid`. `is_error` 가 참이거나 종료 코드가 0이 아닐 때: 글(`result` + stderr)에 `usage limit`, `rate limit`, `limit reached`, `429`(대소문자 무시) 중 하나가 있으면 `limit`, `/login`, `not logged in`, `authentication` 이 있으면 `auth`, 그 외 `other`. `structured_output` 이 없고 `result` 글만 있으며 `stop_reason` 이 `refusal` 이면 `refused`. 예외를 밖으로 던지지 않는다.

`fake-claude-json.mjs`: 환경 변수 `FAKE_JSON_SCRIPT`(JSON 파일 경로)의 배열에서 호출 순서대로 하나씩 꺼내 그 객체를 표준 출력에 쓴다(`{ exit?: number, stderr?: string, body: object | string }`). 받은 표준 입력과 인자는 `FAKE_JSON_LOG` 파일에 한 줄씩 남긴다.

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('성공', async () => {
  script([{ body: { is_error: false, subtype: 'success', structured_output: { items: [{ i: 0, t: '안녕' }] }, usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 } } }]);
  expect(await call()).toEqual({ ok: true, data: { items: [{ i: 0, t: '안녕' }] }, usage: { input: 5, output: 7, cacheRead: 1, cacheCreate: 2 } });
  const log = lastCall(); expect(log.stdin).toBe('USER'); expect(log.args).toEqual(expect.arrayContaining(['--output-format', 'json', '--tools', '', '--setting-sources', 'project', '--system-prompt', 'SYS', '--json-schema']));
});
test.each([
  [{ exit: 1, stderr: 'Claude usage limit reached. Resets at 3pm', body: '' }, 'limit'],
  [{ exit: 1, stderr: 'Please run /login', body: '' }, 'auth'],
  [{ body: 'not json' }, 'invalid'],
  [{ body: { is_error: false, structured_output: { items: 'x' } } }, 'invalid'],
  [{ body: { is_error: false, result: '도와드릴 수 없습니다', stop_reason: 'refusal' } }, 'refused'],
  [{ exit: 2, stderr: 'boom', body: '' }, 'other'],
])('실패 판정 %#', async (entry, kind) => { script([entry]); expect(await call()).toMatchObject({ ok: false, kind }); });
test('없는 실행 파일과 중단', async () => {
  expect(await call({ command: 'C:/no/claude.exe', prefixArgs: [] })).toMatchObject({ ok: false, kind: 'spawn' });
  const ac = new AbortController(); script([{ delayMs: 2000, body: {} }]); const p = call({ signal: ac.signal }); ac.abort(); expect(await p).toMatchObject({ ok: false, kind: 'aborted' });
});
// realCliJson.test.ts — MVMZ_REAL_CLI=1 일 때만
test.skipIf(!process.env.MVMZ_REAL_CLI)('실제 CLI 가 스키마대로 답한다', async () => {
  const r = await runClaudeJson({ ...real, system: '입력 JSON의 text를 한국어로 번역해 items로 돌려준다.', user: JSON.stringify([{ i: 0, text: 'おはよう' }]), schema: itemsSchema, validate: isItems });
  expect(r.ok).toBe(true); expect((r as any).data.items[0].i).toBe(0);
});
```

- [x] **Step 2: `npx vitest run tests/main/claudeJson.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS. `claude auth status` 가 로그인 상태면 `MVMZ_REAL_CLI=1 npx vitest run tests/main/realCliJson.test.ts` 도 돌려 통과를 확인한다. 실제 출력이 위 판정과 맞지 않으면 여기서 멈추고 보고한다**
- [x] **Step 5: `git commit -m "feat: 정해진 형식으로 답을 받는 Claude 호출"`**

### Task 5: 용어집 자료 모으기와 초안

**Files:**
- Create: `src/main/translate/material.ts`, `src/main/translate/draft.ts`
- Test: `tests/main/draft.test.ts`

**Interfaces:**
- Consumes: `speakerNames`, `detectSpeakerPattern`, `splitSpeaker`, `runClaudeJson`, `termId`
- Produces: `collectMaterial(units: TextUnit[], pattern: string | null): Material`

```ts
export interface Material {
  names: { name: string; count: number }[];                 // 화자 + Actors 의 name (count 는 대사 수, Actors 만이면 0)
  properNouns: { text: string; count: number }[];           // 가타카나 2자 이상 연속 또는 【】『』 안의 말, 3번 이상, 많은 순 80개까지, names 와 겹치면 뺀다
  sfx: { text: string; count: number }[];                   // 히라가나·가타카나 2~4자 조각이 그대로 2번 이상 반복된 말(ぐちゅぐちゅ, びくんびくん)과 2번 이상 나온 것, 많은 순 60개까지
  samples: { speaker: string; lines: string[] }[];          // 많이 말한 화자 12명까지, 사람마다 본문 8개까지(길이 10~80자, 고르게 떨어진 위치에서)
  menuTerms: string[];                                      // kind 'system' 의 원문
  narrationSamples: string[];                               // 화자 없는 대사 10개까지
}
```

- Produces: `DRAFT_SCHEMA: object`, `buildDraftPrompt(material: Material, styleGuide: string): { system: string; user: string }`, `mergeDraft(g: Glossary, draft: DraftResult, pattern: string | null): Glossary`
- `DraftResult`: `{ terms: { source: string; category: TermCategory; candidates: { target: string; reason: string }[] }[]; characters: { source: string; target: string; speech: string; firstPerson?: string; addressing?: string }[]; styleNotes: string }`

`mergeDraft`: 후보가 1개면 `confirmed`, 2개 이상이면 `provisional`(target 은 첫 후보). 이미 있는 용어(같은 source)는 사용자가 정한 것이므로 건드리지 않는다. `styleNotes` 는 `styleGuide` 끝에 `\n\n## 이 게임의 말투\n` 제목으로 붙인다(이미 그 제목이 있으면 그 아래를 바꾼다). `rules.speakerPattern` 이 null 이면 `pattern` 을 넣는다. `confirmedAt` 은 바꾸지 않는다.

프롬프트(system)에 꼭 들어갈 내용: 번역 지침 전체(`styleGuide`), 해야 할 일("자료에 나온 이름·고유명사·효과음마다 번역을 정한다. 읽는 법이나 뜻이 둘 이상으로 갈릴 수 있으면 후보를 2~3개 내고 가장 권하는 것을 첫 번째에 둔다. 확실하면 후보를 1개만 낸다. 효과음은 지침의 원칙대로 한국어 소리말로 정한다. 대사 표본을 보고 인물마다 말투를 한두 문장으로 적는다. 게임 전체의 분위기와 문체에서 지침에 더할 점을 styleNotes 에 적는다").

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('자료 모으기', () => {
  const m = collectMaterial(units, bracket);
  expect(m.names[0]).toEqual({ name: 'アーテル', count: 3 }); expect(m.sfx.map(s => s.text)).toContain('ぐちゅぐちゅ');
  expect(m.properNouns.some(p => p.text === 'アーテル')).toBe(false); expect(m.properNouns.map(p => p.text)).toContain('ギルド');
  expect(m.samples[0]).toMatchObject({ speaker: 'アーテル' }); expect(m.samples[0].lines.every(l => !l.includes('【'))).toBe(true);
  expect(m.menuTerms).toContain('たたかう');
});
test('초안 합치기', () => {
  const g = defaultGlossary(); g.terms.push({ id: termId('ギルド'), source: 'ギルド', target: '길드', category: 'term', status: 'confirmed', candidates: [] });
  const out = mergeDraft(g, { terms: [
    { source: 'ギルド', category: 'term', candidates: [{ target: '조합', reason: 'x' }] },
    { source: '乙女', category: 'name', candidates: [{ target: '오토메', reason: '이름' }, { target: '처녀', reason: '일반 명사' }] },
    { source: 'ぐちゅぐちゅ', category: 'sfx', candidates: [{ target: '찌걱찌걱', reason: '' }] } ],
    characters: [{ source: 'アーテル', target: '아텔', speech: '차분한 반말' }], styleNotes: '기사 학원물. 건조한 문체.' }, bracket);
  expect(out.terms.find(t => t.source === 'ギルド')!.target).toBe('길드');
  expect(out.terms.find(t => t.source === '乙女')).toMatchObject({ status: 'provisional', target: '오토메' });
  expect(out.terms.find(t => t.source === 'ぐちゅぐちゅ')).toMatchObject({ status: 'confirmed', category: 'sfx' });
  expect(out.styleGuide).toMatch(/## 이 게임의 말투\n기사 학원물/); expect(out.rules.speakerPattern).toBe(bracket); expect(out.confirmedAt).toBeNull();
  expect(mergeDraft(out, { terms: [], characters: [], styleNotes: '다시' }, null).styleGuide.match(/## 이 게임의 말투/g)).toHaveLength(1);
});
test('프롬프트', () => { const p = buildDraftPrompt(m, 'GUIDE'); expect(p.system).toContain('GUIDE'); expect(JSON.parse(p.user).names[0].name).toBe('アーテル'); });
```

- [x] **Step 2: `npx vitest run tests/main/draft.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 용어집 자료 모으기와 초안"`**

### Task 6: 묶음 나누기와 번역 프롬프트

**Files:**
- Create: `src/main/translate/batches.ts`
- Test: `tests/main/batches.test.ts`

**Interfaces:**
- Consumes: `splitSpeaker`, `termsIn`
- Produces:

```ts
export interface BatchItem { i: number; id: string; kind: UnitKind; speaker: string | null; speakerLine: string | null; text: string }  // text = 화자 줄을 뗀 본문
export interface Batch { label: string; file: string; items: BatchItem[]; context: { speaker: string | null; source: string; target: string | null }[] }
export function planBatches(units: TextUnit[], entryOf: (id: string) => TranslationEntry, glossary: Glossary,
  o?: { maxItems?: number; maxChars?: number; ids?: string[]; includeStatuses?: TranslationStatus[] }): Batch[];
export const TRANSLATE_SCHEMA: object;   // { items: [{ i: integer, t: string|null, declined?: string, newTerms?: [{ source, target }] }] }
export function buildTranslatePrompt(batch: Batch, glossary: Glossary): { system: string; user: string };
```

`planBatches`: 대상은 `needsDecision` 이 아니고 상태가 `includeStatuses`(기본 `['untranslated']`)인 항목(`ids` 가 있으면 그 안에서만). 첫 ref 의 파일별로, 파일 안에서는 원래 순서대로. 한 묶음은 최대 `maxItems`(기본 40)개, 본문 글자 합 최대 `maxChars`(기본 6000). 파일이 바뀌면 묶음도 바뀐다. `context` 는 그 묶음 첫 항목 바로 앞의 같은 파일 대사 3개(이미 번역된 것은 target 포함). `label` 은 `scopeLabel(file)` + ` (n/m)`.

`buildTranslatePrompt`: system = `glossary.styleGuide` + 형식 규칙을 글로 푼 것(제어문자 유지, 줄 수 규칙, 줄 폭 한도가 있으면 그 값) + 출력 규칙("항목마다 i 와 번역 t 를 돌려준다. 번역할 수 없는 항목은 t 를 null 로 하고 declined 에 이유를 적는다. 용어집에 없는 고유명사를 새로 옮겼으면 newTerms 에 적는다. 화자 이름은 번역하지 않는다, 본문만 옮긴다"). user = JSON `{ terms: [{ source, target }], characters: [{ name, target, speech, firstPerson?, addressing? }], context: [...], items: [{ i, kind, speaker, text }] }`. `terms` 는 묶음의 본문들에 `termsIn` 으로 나온 것만, `characters` 는 묶음에 나온 화자의 카드만.

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('파일과 크기로 나눈다', () => {
  const b = planBatches(units, entryOf, g, { maxItems: 2 });
  expect(b.map(x => [x.file, x.items.length])).toEqual([['data/Map001.json', 2], ['data/Map001.json', 1], ['data/Items.json', 2]]);
  expect(b[0].label).toBe('맵1 (1/2)'); expect(b.flatMap(x => x.items).some(i => i.id === needsDecisionId)).toBe(false);
  expect(planBatches(units, entryOf, g, { maxChars: 10 }).every(x => x.items.length === 1)).toBe(true);
});
test('화자 줄을 떼고 앞 문맥을 붙인다', () => {
  const b = planBatches(units, entryOf, { ...g, rules: { ...g.rules, speakerPattern: bracket } }, { maxItems: 1 });
  expect(b[1].items[0]).toMatchObject({ speaker: 'アーテル', speakerLine: '【アーテル】', text: '「え？」' });
  expect(b[1].context).toEqual([{ speaker: 'アーテル', source: '「もちろん無料で」', target: '「물론 공짜로」' }]);
});
test('이미 번역된 것은 빼고, ids 로 좁힌다', () => {
  expect(planBatches(units, entryOf, g).flatMap(x => x.items).some(i => i.id === translatedId)).toBe(false);
  expect(planBatches(units, entryOf, g, { ids: [someId] }).flatMap(x => x.items).map(i => i.id)).toEqual([someId]);
});
test('프롬프트에는 그 묶음의 용어와 인물만', () => {
  const p = buildTranslatePrompt(batch, g); const u = JSON.parse(p.user);
  expect(u.terms).toEqual([{ source: '月光草', target: '월광초' }]); expect(u.characters.map((c: any) => c.name)).toEqual(['アーテル']);
  expect(u.items[0]).toEqual({ i: 0, kind: 'dialogue', speaker: 'アーテル', text: '「月光草を集めて」' });
  expect(p.system).toContain(g.styleGuide); expect(p.system).toContain('declined');
});
```

- [x] **Step 2: `npx vitest run tests/main/batches.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 번역 묶음과 프롬프트"`**

### Task 7: 번역 작업 실행기

**Files:**
- Create: `src/main/translate/job.ts`
- Modify: `src/main/projectService.ts`(용어집 보관, `glossary()`, `setGlossary(g)`, `setDeclined(id, reason, origin)`, `setTranslation` 이 용어 검사와 줄 폭 검사를 포함하고 `usesProvisional` 계산에 쓸 정보 제공, `addTermCandidates(terms)`)
- Test: `tests/main/job.test.ts`

**Interfaces:**
- Consumes: `planBatches`, `buildTranslatePrompt`, `TRANSLATE_SCHEMA`, `runClaudeJson`, `composeSpeaker`, `ProjectService`
- Produces:

```ts
export class TranslateJob extends EventEmitter {   // 'progress' → JobProgress
  constructor(o: { svc: ProjectService; call: typeof runClaudeJson; claude: { command: string; prefixArgs?: string[] }; model: string; cwd: string; ids?: string[] });
  start(): Promise<void>;     // 끝나거나 멈출 때 resolve
  pause(): void; resume(): void; stop(): void;
  readonly progress: JobProgress;
}
```

한 묶음의 처리:
1. 호출. `ok` 면 돌아온 `items` 중 `i` 가 묶음에 있는 것만 쓴다. 같은 `i` 가 두 번 오면 첫 번째만.
2. `t` 가 글이면: 화자 줄이 있으면 `composeSpeaker` 로 붙인다. 화자 이름의 번역은 용어집의 그 이름 용어(`category 'name'`)나 인물 카드의 target, 없으면 원문 이름 그대로. `svc.setTranslation(id, full, 'batch')`.
3. `t` 가 null 이면 `svc.setDeclined(id, declined ?? '이유 없음', 'batch')` → 상태 `'declined'`.
4. `newTerms` 는 용어집에 없는 것만 `provisional` 로 더한다(후보 1개, reason `'번역 중 새로 나옴'`).
5. 2에서 `error` 가 난 항목만 모아 한 번 더 보낸다. 이때 user JSON 의 각 항목에 `previous`(직전 번역)와 `problems`(검사 메시지들)를 붙인다. 그래도 오류면 그대로 `'error'` 로 둔다.
6. 돌아오지 않은 항목은 건드리지 않는다(미번역으로 남는다).

호출 실패의 처리: `limit` → 상태 `paused-limit`, 메시지에 원래 글. `resume()` 하면 그 묶음부터 다시. `auth` → `failed`, 메시지 `'로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.'`. `refused` 또는 `invalid` → 묶음을 반으로 나눠 각각 다시 시도. 항목이 1개인 묶음이 `refused` 면 그 항목을 `declined`(이유 `'모델이 번역을 거절했습니다'`), `invalid` 면 그대로 두고 `errors` 를 1 올린다. `spawn`·`other` → 같은 묶음을 1번 다시 시도하고 또 실패하면 `failed`. `aborted` → `stopped`.

`progress.total` 은 시작할 때의 대상 항목 수, `done` 은 번역·거절·오류로 끝난 항목 수. `usage` 는 모든 호출의 합. `pause()` 는 진행 중인 호출이 끝난 뒤 멈춘다. `stop()` 은 호출을 끊는다.

- [x] **Step 1: 실패하는 시험 쓰기** (`call` 은 시험이 주는 가짜. `answer(fn)` 은 받은 user JSON 으로 답을 만드는 도우미)

```ts
test('전부 번역', async () => {
  const job = mk(answer(u => ({ items: u.items.map((x: any) => ({ i: x.i, t: 'KO:' + x.i })) }))); await job.start();
  expect(job.progress).toMatchObject({ state: 'done', done: total, total, declined: 0 });
  expect(svc.entry(idOf('月光草'))).toMatchObject({ status: 'needs-review' }); expect(svc.entry(needsDecisionId).target).toBeNull();
});
test('화자 줄을 다시 붙인다', async () => {
  await withSpeakerGlossary({ 'アーテル': '아텔' }); await mk(answer(u => ({ items: u.items.map((x: any) => ({ i: x.i, t: '「응?」' })) }))).start();
  expect(svc.entry(idOf('【アーテル】\n「え？」')).target).toBe('【아텔】\n「응?」');
});
test('빼먹은 번호와 없는 번호', async () => {
  await mk(answer(u => ({ items: [{ i: 0, t: '하나' }, { i: 0, t: '중복' }, { i: 99, t: '없는 번호' }] }))).start();
  const first = firstBatchIds(); expect(svc.entry(first[0]).target).toBe('하나'); expect(svc.entry(first[1]).status).toBe('untranslated');
});
test('검사 오류는 한 번 다시 보낸다', async () => {
  const seen: any[] = []; await mk(answer(u => { seen.push(u); return { items: u.items.map((x: any) => ({ i: x.i, t: x.previous ? '밤에 빛나는 풀. \\C[2]귀하다\\C[0]' : '밤에 빛나는 풀' })) }; }), { ids: [codeId] }).start();
  expect(seen).toHaveLength(2); expect(seen[1].items[0].problems[0]).toContain('제어'); expect(svc.entry(codeId).status).toBe('needs-review');
});
test('거절과 새 용어', async () => {
  await mk(answer(u => ({ items: u.items.map((x: any) => x.i === 0 ? { i: 0, t: null, declined: '사유' } : { i: x.i, t: 'KO', newTerms: [{ source: 'ギルド', target: '길드' }] }) }))).start();
  expect(svc.entry(firstBatchIds()[0])).toMatchObject({ status: 'declined', declinedReason: '사유' });
  expect(svc.glossary().terms.find(t => t.source === 'ギルド')).toMatchObject({ status: 'provisional', target: '길드' });
});
test('한도에 걸리면 멈추고, 이어하면 남은 것만', async () => {
  let n = 0; const job = mk(async (o: any) => (++n === 2 ? { ok: false, kind: 'limit', message: 'usage limit reached', usage: zero } : okAll(o)), { maxItems: 2 });
  await job.start(); expect(job.progress.state).toBe('paused-limit'); const doneBefore = job.progress.done; expect(doneBefore).toBe(2);
  job.resume(); await idle(job); expect(job.progress.state).toBe('done'); expect(n).toBe(2 + remainingBatches);
});
test('묶음 전체가 거절되면 쪼갠다', async () => {
  const sizes: number[] = []; await mk(async (o: any) => { const u = JSON.parse(o.user); sizes.push(u.items.length);
    return u.items.some((x: any) => x.text.includes('やった')) && u.items.length > 1 ? { ok: false, kind: 'refused', message: '', usage: zero }
      : u.items.length === 1 && u.items[0].text.includes('やった') ? { ok: false, kind: 'refused', message: '', usage: zero } : okAll(o); }).start();
  expect(svc.entry(idOf('やった！'))).toMatchObject({ status: 'declined', declinedReason: '모델이 번역을 거절했습니다' });
  expect(svc.entry(idOf('月光草')).target).not.toBeNull(); expect(Math.min(...sizes)).toBe(1);
});
test('로그인 오류는 실패로 끝낸다', async () => {
  const job = mk(async () => ({ ok: false, kind: 'auth', message: '', usage: zero })); await job.start();
  expect(job.progress).toMatchObject({ state: 'failed', message: '로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.' });
});
test('멈추기', async () => { const job = mk(slow(okAll)); const p = job.start(); job.stop(); await p; expect(job.progress.state).toBe('stopped'); });
```

- [x] **Step 2: `npx vitest run tests/main/job.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 번역 작업 실행기"`**

### Task 8: 검수 작업

**Files:**
- Create: `src/main/translate/review.ts`
- Modify: `src/main/projectService.ts`(`setReview(id, review | null, origin)`, `acceptReview(id)`, `rejectReview(id)`)
- Test: `tests/main/review.test.ts`

**Interfaces:**
- Produces: `estimateTokens(chars: number): number` → `Math.ceil(chars * 1.2)`
- Produces: `planReview(units, entryOf, glossary, o: { scope: 'all' | 'unreviewed' | 'file'; file?: string; maxItems?: number; maxChars?: number }): { batches: ReviewBatch[]; items: number; estimatedInputTokens: number }` — 대상은 target 이 있고 상태가 `needs-review` 또는 `approved` 인 항목. `'unreviewed'` 는 `reviewedAt` 이 없거나 `updatedAt` 보다 이른 것(`TranslationEntry` 에 선택 필드 `reviewedAt?: string` 추가). 추정 토큰은 (원문 + 번역 글자 수 + 묶음마다 지침 글자 수)로 계산
- Produces: `REVIEW_SCHEMA`(`{ problems: [{ i: integer, problem: string, suggestion: string }] }`), `buildReviewPrompt(batch, glossary)`, `class ReviewJob`(생성자와 메서드는 `TranslateJob` 과 같은 모양, `kind: 'review'`)

검수 프롬프트(system)에 꼭 들어갈 내용: 말투 지침 전체, "문제가 있는 항목만 돌려준다. 오역, 빠진 내용, 어색한 한국어, 인물 말투와 맞지 않는 어미, 지침의 의성어·신음 원칙에 어긋난 표기, 용어집과 다른 용어가 대상이다. 취향 차이만 있는 것은 돌려주지 않는다. suggestion 은 고친 번역문 전체이고 제어문자를 그대로 유지한다."

결과 처리: 돌아온 항목은 `svc.setReview(id, { problem, suggestion, model }, 'review')` → 상태 `needs-review`. 묶음의 나머지 항목은 `reviewedAt` 만 찍는다(상태는 그대로). `acceptReview` 는 suggestion 을 `setTranslation`(출처 `'review'`)으로 쓰고 review 를 지운다. 화자 줄이 있는 항목은 본문만 주고받고 `composeSpeaker` 로 붙인다. `rejectReview` 는 review 만 지운다. 호출 실패 처리는 `TranslateJob` 과 같되 `refused`/`invalid` 는 쪼개지 않고 그 묶음을 건너뛰며 `errors` 를 올린다.

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('범위와 추정', () => {
  const all = planReview(units, entryOf, g, { scope: 'all' }); expect(all.items).toBe(translatedCount); expect(all.estimatedInputTokens).toBeGreaterThan(0);
  expect(planReview(units, entryOf, g, { scope: 'file', file: 'data/Items.json' }).items).toBe(1);
  expect(planReview(units, entryOfReviewed, g, { scope: 'unreviewed' }).items).toBe(0);
});
test('문제 있는 것만 올라온다', async () => {
  await mkReview(answer(u => ({ problems: [{ i: 0, problem: '어미가 인물과 안 맞음', suggestion: '고친 문장' }] }))).start();
  const [a, b] = firstBatchIds(); expect(svc.entry(a)).toMatchObject({ status: 'needs-review', review: { problem: '어미가 인물과 안 맞음', suggestion: '고친 문장' } });
  expect(svc.entry(b).review).toBeUndefined(); expect(svc.entry(b).reviewedAt).toBeTruthy();
});
test('받기와 거절', async () => {
  await svc.acceptReview(a); expect(svc.entry(a)).toMatchObject({ target: '고친 문장' }); expect(svc.entry(a).review).toBeUndefined();
  await svc.setReview(b, { problem: 'p', suggestion: 's', model: 'm' }, 'review'); await svc.rejectReview(b); expect(svc.entry(b).target).not.toBe('s'); expect(svc.entry(b).review).toBeUndefined();
});
test('프롬프트', () => { const p = buildReviewPrompt(batch, g); expect(p.system).toContain(g.styleGuide); expect(JSON.parse(p.user).items[0]).toMatchObject({ i: 0, source: expect.any(String), target: expect.any(String) }); });
```

- [x] **Step 2: `npx vitest run tests/main/review.test.ts` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 검수 작업"`**

### Task 9: 용어집 조작, 작업 연결, IPC, 채팅 도구

**Files:**
- Modify: `src/main/projectService.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/toolHandlers.ts`, `src/main/claude/args.ts`, `src/main/claude/prompt.ts`, `src/main/settings.ts`
- Test: `tests/main/glossaryOps.test.ts`, 기존 `tests/main/ipc.test.ts`·`toolHandlers.test.ts`·`claude.test.ts` 의 목록 단언 갱신

**Interfaces:**
- Produces(`ProjectService`): `upsertTerm(t: Omit<Term, 'id'>): Promise<Term>`, `removeTerm(id)`, `chooseCandidate(id, target): Promise<{ changed: string[]; uncertain: string[] }>`(target 을 바꾸고 `confirmed` 로. target 이 달라지면 `planRename` 을 적용: `certain` 은 바로 쓰고, 아닌 것은 쓰되 상태를 `needs-review` 로 두고 `uncertain` 에 담는다), `setCharacters`, `setStyleGuide`, `setRules`, `confirmGlossary()`(`confirmedAt` 을 지금으로), 그리고 `'glossary-changed'` 이벤트. `Row.usesProvisional` 은 그 항목 원문에 `provisional` 용어가 있고 번역이 있을 때 참
- Produces(IPC, `window.api`): `glossary.get()`, `glossary.upsertTerm`, `glossary.removeTerm`, `glossary.choose`, `glossary.setCharacters`, `glossary.setStyleGuide`, `glossary.setRules`, `glossary.confirm`, `glossary.detectSpeakerPattern()`, `job.draft()`, `job.translate(ids?)`, `job.reviewPlan(scope)`, `job.review(scope)`, `job.pause()`, `job.resume()`, `job.stop()`, `unit.acceptReview(id)`, `unit.rejectReview(id)`, `on('glossary:changed')`, `on('job:progress')`. 한 번에 작업 하나만: 진행 중에 다른 작업을 시작하면 `Error('다른 작업이 진행 중입니다')`. `job.translate` 는 `confirmedAt` 이 null 이면 `Error('용어집을 먼저 확정하세요')`
- Produces(채팅 도구, 2개 추가 → 모두 8개): `glossary_search`(`query: string` → 용어와 인물 카드), `glossary_set_term`(`source`, `target`, `category?` → `upsertTerm` 을 `confirmed` 로. 기존 용어의 target 이 바뀌면 `chooseCandidate` 와 같은 갱신). 채팅 시스템 프롬프트에 "용어를 정하거나 바꿀 때는 glossary_set_term 을 쓴다"와 현재 말투 지침 전체를 넣는다
- 모델: 초안은 `settings.stageModels.glossary`, 번역은 `.translate`, 검수는 `.review`

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('후보를 고르면 번역문이 따라 바뀐다', async () => {
  await svc.upsertTerm({ source: 'リナ', target: '리나', category: 'name', status: 'provisional', candidates: [{ target: '리나', reason: '' }, { target: '린', reason: '' }] });
  await svc.setTranslation(profileId, '리나는 약초원의 견습생', 'user'); expect(rowOf(profileId).usesProvisional).toBe(true);
  const r = await svc.chooseCandidate(termId('リナ'), '린'); expect(r.changed).toContain(profileId);
  expect(svc.entry(profileId).target).toBe('린은 약초원의 견습생'); expect(svc.glossary().terms[0]).toMatchObject({ target: '린', status: 'confirmed' }); expect(rowOf(profileId).usesProvisional).toBe(false);
});
test('확정 전에는 전체 번역을 시작할 수 없다', async () => {
  await expect(invoke('job:translate')).rejects.toThrow('용어집을 먼저 확정하세요'); await invoke('glossary:confirm');
  await invoke('job:translate'); await expect(invoke('job:review', { scope: 'all' })).rejects.toThrow('다른 작업이 진행 중입니다');
});
test('단계별 모델이 쓰인다', async () => {
  await invoke('settings:set', { stageModels: { glossary: 'g', translate: 't', review: 'r', patchNotes: 'p' } });
  await invoke('job:draft'); expect(fakeCall.models.at(-1)).toBe('g'); await invoke('glossary:confirm'); await invoke('job:translate'); await idleJob(); expect(fakeCall.models.at(-1)).toBe('t');
});
test('초안은 용어집에 합쳐지고 알림이 간다', async () => { await invoke('job:draft'); expect(sent('glossary:changed').at(-1).terms.length).toBeGreaterThan(0); });
test('채팅 도구로 용어를 정한다', async () => {
  expect(await callTool(svc, 'glossary_set_term', { source: '月光草', target: '월광초' })).toMatchObject({ ok: true });
  expect(((await callTool(svc, 'glossary_search', { query: '月光' })) as any).data.terms[0].target).toBe('월광초');
});
```

- [x] **Step 2: `npx vitest run tests/main` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS, 전체 `npx vitest run` 통과**
- [x] **Step 5: `git commit -m "feat: 용어집 조작과 작업 연결"`**

### Task 10: 용어집 화면

**Files:**
- Create: `src/renderer/components/GlossaryView.tsx`
- Modify: `src/renderer/state.ts`, `Sidebar.tsx`(작업 메뉴에 "용어집 <결정 필요 수>" 추가), `App.tsx`
- Test: `tests/renderer/glossary.test.tsx`

화면(시안의 용어집 화면을 따른다):
- 위: 제목, "용어 n개 확정 · m개는 추천안으로 진행 중이에요", 버튼 "초안 받기"(용어가 이미 있으면 "초안 다시 받기"), "용어집 확정"(확정 뒤에는 "확정됨 · <날짜>"로 보이고, 내용을 고치면 다시 누를 수 있다).
- 결정 필요 카드(`provisional` 마다): `<원문> 을 어떻게 옮길까요?`, "추천안으로 진행 중 · n문장"(그 용어가 원문에 있고 번역된 항목 수), 후보 버튼(첫 번째에 "추천" 표시, 이유 한 줄), "직접 입력". 고르면 `glossary.choose`. 결과에 `uncertain` 이 있으면 "조사를 확인할 문장 k개"와 "보기"(텍스트 화면으로 가서 그 줄들만 보이게 한다).
- 용어 목록: 분류 필터(전체, 이름, 지명, 용어, 효과음, 기타), 검색, 줄마다 원문·번역·분류, 번역 칸은 바로 고칠 수 있고(고치면 `glossary.choose`), 삭제, 맨 아래 새 용어 추가 줄.
- 인물 카드: 이름, 번역 이름, 말투(글), 1인칭, 호칭. 고치면 저장.
- 말투 지침: 큰 글 편집 칸(고친 뒤 800ms 지나면 저장), "기본 지침으로 되돌리기"(확인 후).
- 형식 규칙: 제어 코드 유지, 일본어 글자 남기지 않기, 줄 수를 원문과 같게(켜고 끔), 대사 최대 줄 수, 한 줄 최대 글자 수(비우면 검사 안 함), 화자 줄 패턴(프리셋 고르기 + "자동으로 찾기" → 찾은 프리셋과 "대사의 n%가 맞아요").

- [x] **Step 1: 실패하는 시험 쓰기**

```ts
test('후보를 고른다', async () => {
  await openGlossary({ terms: [provisionalOtome] }); expect(screen.getByText('추천안으로 진행 중 · 23문장')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /처녀/ })); expect(api.calls).toContainEqual(['glossary.choose', provisionalOtome.id, '처녀']);
  expect(await screen.findByText('조사를 확인할 문장 2개')).toBeVisible();
});
test('직접 입력', async () => {
  await openGlossary({ terms: [provisionalOtome] }); await user.click(screen.getByRole('button', { name: '직접 입력' }));
  await user.type(screen.getByLabelText('乙女 번역'), '소녀{Enter}'); expect(api.calls).toContainEqual(['glossary.choose', provisionalOtome.id, '소녀']);
});
test('분류 필터와 새 용어', async () => {
  await openGlossary({ terms: fiveTerms }); await user.click(screen.getByRole('button', { name: '효과음' })); expect(screen.getAllByTestId('term-row')).toHaveLength(1);
  await user.type(screen.getByLabelText('새 용어 원문'), 'ギルド'); await user.type(screen.getByLabelText('새 용어 번역'), '길드{Enter}');
  expect(api.calls.at(-1)).toEqual(['glossary.upsertTerm', { source: 'ギルド', target: '길드', category: 'term', status: 'confirmed', candidates: [] }]);
});
test('확정과 초안', async () => {
  await openGlossary({ terms: [] }); await user.click(screen.getByRole('button', { name: '초안 받기' })); expect(api.calls).toContainEqual(['job.draft']);
  await user.click(screen.getByRole('button', { name: '용어집 확정' })); expect(api.calls).toContainEqual(['glossary.confirm']);
});
test('화자 줄 패턴 자동 찾기', async () => {
  await openGlossary(); await user.click(screen.getByRole('button', { name: '자동으로 찾기' })); expect(await screen.findByText('대사의 97%가 맞아요')).toBeVisible();
});
```

- [x] **Step 2: `npx vitest run tests/renderer/glossary.test.tsx` → FAIL**
- [x] **Step 3: 구현**
- [x] **Step 4: PASS**
- [x] **Step 5: `git commit -m "feat: 용어집 화면"`**

### Task 11: 번역·검수 버튼, 진행 막대, 검수 받기, 단계별 모델 설정

**Files:**
- Create: `src/renderer/components/JobBar.tsx`, `ReviewDialog.tsx`
- Modify: `TextTable.tsx`, `ItemPanel.tsx`, `SettingsView.tsx`, `state.ts`
- Test: `tests/renderer/jobs.test.tsx`

화면:
- 텍스트 화면 위: "새 문장 n개 번역 맡기기"(n = 미번역이고 판단 필요가 아닌 수. 용어집이 확정 전이면 누를 수 없고 옆에 "용어집을 먼저 확정하세요"와 용어집으로 가는 링크), "번역 전체 검수"(누르면 `ReviewDialog`: 범위 "전체 / 지난 검수 이후 바뀐 것만 / 지금 보는 범위", 고르면 `job.reviewPlan` 으로 "항목 n개 · 예상 입력 약 k 토큰 · 모델 <이름>"을 보여주고 "검수 시작").
- 선택한 줄만 번역: 항목 탭의 "다시 번역" → `job.translate([id])`.
- `JobBar`(작업이 `idle` 이 아닐 때 본문 위에 뜬다): 종류와 라벨("번역 중 · 맵4 (2/5)"), 진행 막대와 `done / total`, 쓴 토큰, 거절 n·오류 n(0이 아니면), 버튼 "일시정지"/"이어하기"/"멈추기". `paused-limit` 이면 `--warn` 색으로 "사용량 한도 때문에 멈췄어요"와 원래 메시지, "이어하기". `failed` 면 `--err` 색 메시지. `done` 이면 "끝났어요 · n개 번역 · 거절 a · 오류 b"와, 추천안 용어가 남아 있으면 "결정 안 한 용어 m개"(용어집으로 가는 버튼), 닫기.
- 상태 필터 칩에 "거절됨 n", "추천안 용어 사용 n" 추가(0이면 숨긴다).
- 항목 탭: `declined` 면 이유를 보여준다. `review` 가 있으면 "검수 의견" 상자(문제, 고친 안을 `CodeText` 로), "고친 안 받기", "그대로 두기". 검사 결과에 용어·줄 폭 경고가 보인다.
- 설정: "단계별 모델" 칸 네 개(용어집과 말투 지침, 전체 번역, 검수, 패치노트 정리).

계획 2에서 미뤄둔 세 가지도 여기서 고친다:
1. 항목 탭에서 고치는 중(입력 칸 내용이 저장된 값과 다름)에 그 줄이 밖에서 바뀌면 입력 내용을 덮지 않고, 칸 위에 "다른 곳에서 이 줄이 바뀌었어요"와 "바뀐 내용 보기"(누르면 입력을 새 값으로 바꾼다)를 띄운다.
2. 프로젝트 만들기가 중간에 실패하면 만들던 폴더를 지운다(`project:create` 처리기. 만들기 전에 없던 폴더일 때만).
3. 밝은 테마에서 선택한 줄의 배경을 `--card` 로 바꾸고 왼쪽에 `--accent` 3px 선을 둔다(상태 칩과 색이 겹치지 않게). 어두운 테마도 같은 규칙.

- [ ] **Step 1: 실패하는 시험 쓰기**

```ts
test('확정 전에는 번역을 맡길 수 없다', async () => {
  await openFake({ glossary: { confirmedAt: null } }); expect(screen.getByRole('button', { name: /번역 맡기기/ })).toBeDisabled(); expect(screen.getByText('용어집을 먼저 확정하세요')).toBeVisible();
});
test('진행 막대와 한도 멈춤', async () => {
  await openFake({ glossary: confirmed }); await user.click(screen.getByRole('button', { name: '새 문장 7개 번역 맡기기' })); expect(api.calls).toContainEqual(['job.translate', undefined]);
  api.emit('job:progress', { kind: 'translate', state: 'running', done: 80, total: 200, label: '맵4 (2/5)', usage: u(12000, 3000), declined: 1, errors: 0 });
  expect(await screen.findByText('번역 중 · 맵4 (2/5)')).toBeVisible(); expect(screen.getByText('80 / 200')).toBeVisible(); expect(screen.getByText('거절 1')).toBeVisible();
  api.emit('job:progress', { kind: 'translate', state: 'paused-limit', done: 80, total: 200, label: '', usage: u(0, 0), declined: 1, errors: 0, message: 'usage limit reached' });
  expect(await screen.findByText('사용량 한도 때문에 멈췄어요')).toBeVisible(); await user.click(screen.getByRole('button', { name: '이어하기' })); expect(api.calls.at(-1)).toEqual(['job.resume']);
});
test('검수 범위와 추정', async () => {
  await openFake({ glossary: confirmed }); await user.click(screen.getByRole('button', { name: '번역 전체 검수' })); await user.click(screen.getByLabelText('지난 검수 이후 바뀐 것만'));
  expect(await screen.findByText('항목 120개 · 예상 입력 약 31,000 토큰 · 모델 Claude Fable 5.2')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '검수 시작' })); expect(api.calls.at(-1)).toEqual(['job.review', { scope: 'unreviewed' }]);
});
test('검수 의견 받기', async () => {
  await openFake({ select: reviewedId }); expect(screen.getByText('어미가 인물과 안 맞음')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '고친 안 받기' })); expect(api.calls.at(-1)).toEqual(['unit.acceptReview', reviewedId]);
});
test('고치는 중에 밖에서 바뀌면 덮지 않는다', async () => {
  await openFake({ select: itemId }); await user.type(screen.getByLabelText('번역'), ' 추가');
  api.emit('project:changed', { rows: [{ ...itemRow, target: '채팅이 바꾼 값' }], stats, scopes, origin: 'chat' });
  expect((screen.getByLabelText('번역') as HTMLTextAreaElement).value).toContain('추가'); expect(screen.getByText('다른 곳에서 이 줄이 바뀌었어요')).toBeVisible();
});
test('단계별 모델 설정', async () => {
  await openSettings(); await user.selectOptions(screen.getByLabelText('전체 번역'), 'claude-sonnet-5-5'); expect(api.calls.at(-1)[1].stageModels.translate).toBe('claude-sonnet-5-5');
});
```

- [ ] **Step 2: `npx vitest run tests/renderer/jobs.test.tsx` → FAIL**
- [ ] **Step 3: 구현**
- [ ] **Step 4: PASS, 전체 `npx vitest run` 통과**
- [ ] **Step 5: `git commit -m "feat: 번역과 검수 화면"`**

### Task 12: 전체 흐름 시험과 실제 CLI 확인

**Files:**
- Modify: `tests/e2e/app.e2e.test.ts`, `README.md`
- Create: `tests/main/realFlow.test.ts`

- [ ] **Step 1: 연기 시험 추가** — 가짜 JSON CLI(`MVMZ_CLAUDE_JSON_COMMAND`, `MVMZ_CLAUDE_JSON_PREFIX_ARGS` 가 있으면 묶음 호출에 그것을 쓴다)로: 가져오기 → 용어집 화면 → "초안 받기" → 후보 고르기 → "용어집 확정" → 텍스트 화면 → "새 문장 n개 번역 맡기기" → 진행 막대가 "끝났어요"가 될 때까지 → 표에 번역이 보이고 화자 줄이 붙어 있음 → "번역 전체 검수" → 검수 의견이 붙은 줄에서 "고친 안 받기" → "패치 빌드" 성공
- [ ] **Step 2: `npm run build:app && npm run test:e2e` → FAIL 을 확인한 뒤, 빠진 연결을 채워 PASS**
- [ ] **Step 3: 실제 CLI 흐름 확인(`MVMZ_REAL_CLI=1` 일 때만, 로그인 상태에서만)** — `tests/main/realFlow.test.ts`: `makeMiniGame` 게임에 대사 몇 줄(신음과 효과음이 든 줄, 제어문자가 든 줄, 화자 줄이 있는 줄 포함. 시험 파일 안에 직접 적는다)을 더해 `ProjectService` 를 만들고, 모델 `claude-haiku-5-5` 로 초안 → 확정 → 번역 → 검수를 한 번 돌린다. 확인: (1) 초안에 용어와 인물 카드가 들어온다, (2) 번역 뒤 대상 항목이 모두 `needs-review`·`declined`·`error` 중 하나이고 미번역이 없다, (3) 번역문에 일본어 글자가 없고 제어문자가 유지된다, (4) 화자 줄이 붙어 있다, (5) 호출마다 입력 토큰(캐시 포함)이 지침 길이에 비해 터무니없이 크지 않다(한 호출 15,000 미만). 결과 번역문 몇 줄과 호출별 토큰을 보고에 그대로 붙인다. 로그인돼 있지 않으면 건너뛰고 보고에 적는다
- [ ] **Step 4: 전체 확인** — `npx vitest run`, 두 tsconfig 의 `tsc --noEmit`, `npm run test:e2e`
- [ ] **Step 5: `README.md` 에 번역 흐름과 프로젝트 폴더의 새 파일(`glossary.json`)을 적고 `git commit -m "feat: 번역 한 바퀴 전체 흐름 시험"`**

---

## 이 계획이 끝난 뒤 사람이 확인할 것

- 실제 게임으로 용어집 초안을 받아 보고, 이름·효과음·인물 말투가 쓸 만한지.
- 실제 게임의 맵 하나만 번역을 맡겨 보고(범위를 고른 뒤 "새 문장 번역"), 의성어와 신음이 자연스러운지, 화자 이름이 일관되는지.
- 검수가 올린 의견이 쓸모 있는지, 쓸데없는 지적이 많지 않은지.
- 묶음 하나에 드는 토큰이 납득할 만한지.
