// A project keeps its own copy of the style guide, so a better default never reaches it. Lines of the first
// default guide that made the reviewer flag correct translations are brought up to the current wording here,
// but only where the project still has the old line word for word: anything the user rewrote, and everything
// they added, stays as it is.
const HONORIFICS = 'ご主人様 는 "주인님".';
const PRIORITY = '- 호칭과 말투는 인물 카드가 용어집보다 우선한다. 용어집에 先生 → 선생 이 있어도, 인물 카드에 호칭이 "선생님"으로 적힌 인물의 대사에서는 "선생님"으로 쓴다.';
const AVOID_HEAD = '## 번역투 피하기\n\n';
const AVOID_INTRO = '읽기 불편한 번역투만 고친다. 이 장르의 독자가 캐릭터 말버릇으로 읽는 말은 아래 "남기는 말투"에 따라 남긴다.';
const OLD_INTERJECTION = '| 일본식 감탄사 직역(え? あれ? ほら) | 한국어 감탄사(응? 어라? 자, 봐) |';
const KEEP_HEADING = '## 남기는 말투';
const MOAN_HEADING = '## 의성어, 의태어, 신음\n';

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
  return s === guide.replace(/\r\n/g, '\n') ? guide : s;
}
