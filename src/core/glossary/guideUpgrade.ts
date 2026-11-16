// A project keeps its own copy of the style guide, so a better default never reaches it. Lines of the first
// default guide that made the reviewer flag correct translations are brought up to the current wording here,
// but only where the project still has the old line word for word: anything the user rewrote, and everything
// they added, stays as it is.
import { DEFAULT_STYLE_GUIDE } from './defaultGuide.js';

const TERMS_HEADING = '## 성 관련 용어\n';
const FORMAT_HEADING = '## 형식\n';

/** A whole section of the current default guide, from its heading up to the next one (the table is too long to keep twice). */
function defaultSection(heading: string): string | null {
  const at = DEFAULT_STYLE_GUIDE.indexOf(heading);
  if (at < 0) return null;
  const next = DEFAULT_STYLE_GUIDE.indexOf('\n## ', at);
  return next < 0 ? DEFAULT_STYLE_GUIDE.slice(at) : DEFAULT_STYLE_GUIDE.slice(at, next + 1);
}

const HONORIFICS ='ご主人様 는 "주인님".';
const PRIORITY = '- 호칭과 말투는 인물 카드가 용어집보다 우선한다. 용어집에 先生 → 선생 이 있어도, 인물 카드에 호칭이 "선생님"으로 적힌 인물의 대사에서는 "선생님"으로 쓴다.';
const AVOID_HEAD = '## 번역투 피하기\n\n';
const AVOID_INTRO = '읽기 불편한 번역투만 고친다. 이 장르의 독자가 캐릭터 말버릇으로 읽는 말은 아래 "남기는 말투"에 따라 남긴다.';
const OLD_INTERJECTION = '| 일본식 감탄사 직역(え? あれ? ほら) | 한국어 감탄사(응? 어라? 자, 봐) |';
const KEEP_HEADING = '## 남기는 말투';
const MOAN_HEADING = '## 의성어, 의태어, 신음\n';
const SOKUON = '   - 작은 っ(끊김) → 받침 ㅅ·ㄱ 이나 된소리로 끊는다: あっ → 앗, くっ → 큭';
const MOAN_BREAKDOWN = '장면이 진행되며 인물이 무너지면 소리도 따라 풀어진다.';

const KEEP_SECTION = [
  `${KEEP_HEADING} (장르 관용 말투)`,
  '',
  '아래 말은 번역투가 아니라 캐릭터의 말버릇이다. 주로 비꼬거나 여유 부리는 인물이 쓴다.',
  '',
  '- 번역에 그대로 써도 되고 한국어 감탄사로 바꿔 써도 된다. 검수에서는 어느 쪽도 문제로 보지 않는다.',
  '- 다만 한 게임 안에서는 한쪽으로 통일한다. 같은 인물의 같은 말이 장면마다 달라지지 않게 한다.',
  '- 남기는 말: 어이어이(おいおい), 칫(ちっ), 헤에(へぇ), 크큭(くくっ), 남자 대사 끝의 ♪',
  '- 이 목록은 게임에 맞게 더하고 뺀다.',
  '',
  '',
].join('\n');

/** [old text, what stands there now]. The new text may begin with the old one; it is never applied twice. */
const LINES: [string, string][] = [
  [
    '- 물음표, 느낌표, 줄표(——), 물결표, 하트(♥ ❤)는 원문 그대로 둔다. `・・・` 과 `…` 은 `……` 로 통일한다.',
    '- 물음표, 느낌표, 줄표(——), 물결표, 하트(♥ ❤), ♪ 는 원문에 있는 만큼 둔다. 지우거나 더하지 않고 종류, 개수, 자리를 맞춘다는 뜻이다. 전각으로 쓸지 반각으로 쓸지는 형식 규칙을 따른다. `・・・` 과 `…` 은 `……` 로 통일한다.',
  ],
  [`${HONORIFICS}\n`, `${HONORIFICS}\n${PRIORITY}\n`],
  [`${AVOID_HEAD}| 피할 것`, `${AVOID_HEAD}${AVOID_INTRO}\n\n| 피할 것`],
  [
    OLD_INTERJECTION,
    [
      '| 어색한 피동(싸지다, 넣어지다, 쑤셔지다) | 능동으로 바꾸거나 "~당하다"로 푼다(안에 싸졌다 → 안에 쌌어, 안에 사정당했어) |',
      '| 원어의 소리만 옮긴 단어(시오후키, 나카다시), 영문 그대로 둔 단어(SEX) | 한국 성인물에서 쓰는 말로, 문장에 맞게(분수를 뿜다, 안에 싸다·질내사정, 섹스) |',
      '| 캐릭터성이 없는 일반 감탄사 직역(え? あれ? ほら) | 한국어 감탄사(응? 어라? 자, 봐) |',
    ].join('\n'),
  ],
  // Without these two, sentence-final っ came out as "닿고 있어읏" and stutters as "노…… 놔".
  [
    `${SOKUON}\n`,
    `${SOKUON}\n   - 말끝의 작은 っ 는 "읏"을 단어 뒤에 붙이지 않는다(✕ 닿고 있어읏, 안 돼읏). 끝 모음을 한 번 늘리고 ㅅ 받침으로 끊는다: 있어っ → 있어엇, 같아っ → 같아앗, 안 돼っ → 안 돼엣, 까지っ → 까지잇, 하는데っ → 하는데엣, 무리야っ → 무리야앗. "읏"은 따로 선 신음(んっ, っ……)일 때만 쓴다.\n`,
  ],
  [
    `${MOAN_BREAKDOWN}\n`,
    `${MOAN_BREAKDOWN}\n9. **말더듬은 뒤에 오는 말의 첫소리를 되풀이한다.** 더듬은 소리와 실제 말이 따로 놀지 않게 한다(✕ 노…… 놔 → ○ 노…… 놓으라고, ○ 부…… 부끄러워). 더듬은 뒤 말이 한 음절로 끝나 어색하면 말을 조금 늘려서 맞춘다.\n`,
  ],
];

/** The style guide with the old default lines it still holds replaced by the current ones. */
export function upgradeStyleGuide(guide: string): string {
  let s = guide.replace(/\r\n/g, '\n');
  // Only a guide that still tells the reviewer to turn every interjection into a Korean one gets the section about the ones to keep.
  const addKeep = s.includes(OLD_INTERJECTION) && !s.includes(KEEP_HEADING);
  for (const [from, to] of LINES) {
    if (s.includes(to) || !s.includes(from)) continue;
    s = s.replace(from, () => to);
  }
  if (addKeep) {
    const at = s.indexOf(MOAN_HEADING);
    s = at < 0 ? `${s.trimEnd()}\n\n${KEEP_SECTION.trimEnd()}\n` : s.slice(0, at) + KEEP_SECTION + s.slice(at);
  }
  // The table of sexual terms came later. A guide that still has the default's sound-word section is taken
  // to be the default with the user's edits, and gets the table; a guide written from scratch does not.
  if (s.includes(MOAN_HEADING) && !s.includes(TERMS_HEADING)) {
    const section = defaultSection(TERMS_HEADING);
    const at = s.indexOf(FORMAT_HEADING);
    if (section) s = at < 0 ? `${s.trimEnd()}\n\n${section.trimEnd()}\n` : s.slice(0, at) + section + s.slice(at);
  }
  return s === guide.replace(/\r\n/g, '\n') ? guide : s;
}
