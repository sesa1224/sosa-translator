// The whole instruction text a translator gets: the model in a translate or review job, or whoever opens an
// exported package. The user edits that final text as one piece (the guide screen), so nothing is added to it
// behind their back.
//
// What is stored is a template, not the text: the parts that must follow the project (the shared style guide,
// the format-rule lines made from the rules, the line only batches with a changed sentence get) are kept as
// slots while the user leaves them as they are. An untouched slot keeps following the project; an edited one
// is plain text from then on.
import type { Glossary, ProjectRules, PromptKind } from './types.js';

export const PROMPT_KINDS: PromptKind[] = ['translate', 'review', 'export'];

const GUIDE_OPEN = '<번역 지침>';
const GUIDE_CLOSE = '</번역 지침>';
const GUIDE_SLOT = '{{번역 지침}}';
const RULES_SLOT = '{{형식 규칙}}';
const PREVIOUS_SLOT = '{{이전 번역 줄}}';

const PREVIOUS_LINE = '- previous 가 있으면 원문이 조금 바뀐 문장이다. 바뀐 부분만 반영하고 나머지는 이전 번역의 표현과 말투를 그대로 둔다. (이때 previous 의 source 는 게임 이전 버전의 원문, target 은 그때의 번역이다. problems 와 함께 오는 previous 는 위에 적은 직전 번역이다.)';

const HALF_WIDTH_HEAD = '- 문장부호, 숫자, 영문은 반각으로 쓴다(？ ！ ： ＋ １ Ａ 가 아니라 ? ! : + 1 A). 전각 공백도 반각으로 써도 된다. 전각을 반각으로 바꾼 것은 원문을 바꾼 것이 아니다: 기호의 종류와 개수가 같으면 된다(！？ 를 !? 로 쓰는 것은 맞고, ! 하나로 줄이는 것은 틀리다).';
const BRACKETS_KEPT = '괄호 「 」 『 』 （ ） 【 】 는 원문에 쓰인 글자 그대로 두고, 짝이 안 맞아도 원문대로 둔다.';
const BRACKETS_HALF = '괄호 （ ） 는 반각 ( ) 로 쓴다. 「 」 『 』 【 】 는 원문에 쓰인 글자 그대로 두고, 짝이 안 맞아도 원문대로 둔다.';

function halfWidthLine(rules: ProjectRules): string {
  return `${HALF_WIDTH_HEAD} ${rules.halfWidthBrackets ? BRACKETS_HALF : BRACKETS_KEPT}`;
}
const CARD_FIRST = '호칭과 말투는 인물 카드(characters)가 용어집(terms)보다 우선한다';

/** The format rules written out for the model (translate and review jobs). */
export function formatRulesText(rules: ProjectRules): string[] {
  const out: string[] = [];
  if (rules.controlCodes) out.push('- 제어문자(\\C[2], \\N[1], \\V[3], \\{, \\. 같은 것)와 %1 같은 자리표시는 종류와 개수를 원문 그대로 둔다. 색 코드는 원문에서 감싸던 말과 같은 말을 감싸게 한다.');
  if (rules.noLeftoverJapanese) out.push('- 번역문에 일본어 글자(가나, 한자)를 남기지 않는다.');
  if (rules.halfWidth) out.push(halfWidthLine(rules));
  out.push('- text 안의 줄바꿈은 번역에서도 실제 줄바꿈으로 둔다. 역슬래시와 n 두 글자로 바꿔 쓰지 않는다.');
  if (rules.sameLineCount) out.push('- 줄 수를 원문과 똑같이 맞춘다.');
  if (rules.maxLines !== null) out.push(`- 대사(kind 가 dialogue)는 ${rules.maxLines}줄을 넘기지 않는다.`);
  if (rules.maxLineWidthChars !== null) out.push(`- 한 줄은 한글 ${rules.maxLineWidthChars}자를 넘기지 않는다(영문, 숫자, 공백은 0.5자로 센다). 넘치면 줄을 나눈다.`);
  return out;
}

/** The same rules as an outside translator reads them (a person or another model, without the app's retry). */
function exportRulesText(rules: ProjectRules): string[] {
  const out: string[] = [];
  if (rules.controlCodes) out.push('- 제어문자(\\C[2], \\N[1], \\V[3], \\{, \\. 같은 것)와 %1 같은 자리표시는 종류와 개수를 원문 그대로 둔다.');
  if (rules.noLeftoverJapanese) out.push('- 번역문에 일본어 글자(가나, 한자)를 남기지 않는다.');
  if (rules.halfWidth) out.push(halfWidthLine(rules));
  out.push('- text 안의 줄바꿈은 번역에서도 줄바꿈으로 둔다.');
  if (rules.sameLineCount) out.push('- 줄 수를 원문과 똑같이 맞춘다.');
  if (rules.maxLines !== null) out.push(`- 대사(kind 가 dialogue)는 ${rules.maxLines}줄을 넘기지 않는다.`);
  if (rules.maxLineWidthChars !== null) out.push(`- 한 줄은 한글 ${rules.maxLineWidthChars}자를 넘기지 않는다(영문, 숫자, 공백은 0.5자).`);
  return out;
}

function rulesBlock(kind: PromptKind, rules: ProjectRules): string {
  return (kind === 'export' ? exportRulesText(rules) : formatRulesText(rules)).join('\n');
}

const GUIDE_PART = [GUIDE_OPEN, GUIDE_SLOT, GUIDE_CLOSE];

const DEFAULT_TEMPLATES: Record<PromptKind, string> = {
  translate: [
    '너는 RPG Maker 게임의 원문을 아래 번역 지침에 따라 번역한다.',
    '',
    ...GUIDE_PART,
    '',
    '형식 규칙:',
    RULES_SLOT,
    '',
    '입력(JSON):',
    '- terms: 이 묶음에 나오는 용어. 원문에 source 가 있으면 반드시 target 으로 옮긴다.',
    '- characters: 이 묶음에 나오는 인물. name 은 원문 이름, target 은 번역 이름, speech 는 말투, firstPerson 은 1인칭, addressing 은 남을 부르는 말(호칭)이다. 그 인물의 대사는 이 말투를 따른다. moanStyle 이 있으면 그 인물의 신음·감탄 소리는 그 결을 따른다.',
    `- ${CARD_FIRST}. terms 의 target 과 그 인물의 addressing 이 다르면 그 인물의 대사에서는 addressing 을 따른다.`,
    '- context: 이 묶음 바로 앞의 대사(참고만 하고 번역해서 돌려주지 않는다). target 이 있으면 이미 번역된 것이다.',
    '- items: 번역할 항목. speaker 는 그 대사를 말하는 인물이다.',
    '- 항목에 previous 와 problems 가 있으면 직전 번역이 검사에 걸린 것이다. problems 를 고쳐 다시 옮긴다.',
    '',
    '출력 규칙:',
    '- 항목마다 i 와 번역 t 를 돌려준다. 모든 항목을 빠짐없이 돌려준다.',
    '- 번역할 수 없는 항목은 t 를 null 로 하고 declined 에 이유를 적는다.',
    '- 용어집에 없는 고유명사를 새로 옮겼으면 그 항목의 newTerms 에 source(원문)와 target(번역)을 적는다.',
    '- 화자 이름은 번역하지 않는다. text 의 본문만 옮긴다.',
    '- keep 이 있으면 그 글들은 한 글자도 바꾸지 않고 같은 순서로 남긴다. text 전체를 돌려주되 그 사이의 글자만 번역한다.',
    PREVIOUS_SLOT,
  ].join('\n'),
  review: [
    '너는 RPG Maker 게임 번역을 검수한다. 아래 번역 지침이 기준이다.',
    '',
    ...GUIDE_PART,
    '',
    '형식 규칙:',
    RULES_SLOT,
    '',
    '입력(JSON): terms 는 이 묶음의 용어(source 는 반드시 target 으로 옮긴다), characters 는 인물과 말투(speech 말투, firstPerson 1인칭, addressing 남을 부르는 말), items 는 검수할 항목(source 원문, target 번역, speaker 말하는 인물)이다.',
    `${CARD_FIRST}. 그 인물이 addressing 대로 부른 것은 terms 의 target 과 달라도 문제가 아니다.`,
    '',
    '할 일:',
    '- 문제가 있는 항목만 돌려준다. 문제가 없으면 problems 를 빈 배열로 둔다.',
    '- 오역, 빠진 내용, 어색한 한국어, 인물 말투와 맞지 않는 어미, 지침의 의성어·신음 원칙에 어긋난 표기, 인물의 성격·신음 스타일과 맞지 않는 신음 표기, 용어집과 다른 용어가 대상이다.',
    '- 취향 차이만 있는 것은 돌려주지 않는다.',
    '- 지침의 "남기는 말투"에 든 말(장르 관용 말투)은 번역이 그대로 썼어도, 한국어 감탄사로 바꿔 썼어도 돌려주지 않는다. 지침의 "번역투 피하기" 표에 든 것(원어를 그대로 둔 단어, 어색한 피동, 일본어식 문장 구조)은 돌려준다.',
    '- problem 에 무엇이 문제인지 한 문장으로 적는다.',
    '- suggestion 은 고친 번역문 전체이고 제어문자를 그대로 유지한다. 화자 이름은 넣지 않고 target 과 같은 범위만 쓴다.',
  ].join('\n'),
  export: [
    ...GUIDE_PART,
    '',
    '형식 규칙:',
    RULES_SLOT,
    '- keep 이 있는 항목은 keep 의 글들을 한 글자도 바꾸지 않고 같은 순서로 남긴다. text 전체를 돌려주되 그 사이의 글자만 번역한다.',
    '- 용어(terms)의 source 가 원문에 있으면 target 으로 옮긴다. 인물(characters)의 대사는 speech 의 말투를 따른다. 호칭과 말투는 인물 카드(characters)가 용어(terms)보다 우선한다: 그 인물의 addressing(남을 부르는 말)이 terms 와 다르면 addressing 을 따른다.',
    '',
    '돌려줄 형식: items 의 항목마다 { "id": 그 항목의 id, "target": text 의 번역 } 을 담은 JSON 배열. 화자 이름(speaker)은 번역하지 않고 text 만 옮긴다.',
    'before/after 는 앞뒤 대사로 참고만 한다.',
  ].join('\n'),
};

/** The template a project starts with (what is sent while the user has not edited the text). */
export function defaultPromptTemplate(kind: PromptKind): string {
  return DEFAULT_TEMPLATES[kind];
}

// Replacer functions, not strings: the user's text may hold '$&' and the like.
const put = (text: string, slot: string, value: string) => text.replace(slot, () => value);

/**
 * The instruction text exactly as it is sent. previous: whether this batch holds a sentence a game update
 * changed (only then does the line about it go in; other prompts stay the same from batch to batch).
 */
export function finalPrompt(kind: PromptKind, g: Glossary, o: { previous?: boolean } = {}): string {
  let s = g.prompts?.[kind] ?? DEFAULT_TEMPLATES[kind];
  s = put(s, RULES_SLOT, rulesBlock(kind, g.rules));
  s = o.previous ? put(s, PREVIOUS_SLOT, PREVIOUS_LINE) : s.replace(`\n${PREVIOUS_SLOT}`, '').replace(PREVIOUS_SLOT, '');
  // Last, so that slot-like text inside the guide is left alone.
  return put(s, GUIDE_SLOT, g.styleGuide.trim());
}

/** The text the guide screen shows for editing: everything that can be sent, the changed-sentence line included. */
export function promptText(kind: PromptKind, g: Glossary): string {
  return finalPrompt(kind, g, { previous: true });
}

/**
 * Takes the edited text back in. The part between the guide tags becomes the shared style guide; the rest
 * becomes this kind's template, with the parts the user left as they were turned back into slots. A text
 * equal to the default (or an empty one) removes the override, so later defaults reach the project.
 */
export function withPromptText(g: Glossary, kind: PromptKind, text: string | null): Glossary {
  const prompts = { ...(g.prompts ?? {}) };
  delete prompts[kind];
  const done = (styleGuide: string): Glossary => {
    const { prompts: _old, ...rest } = g;
    return Object.keys(prompts).length > 0 ? { ...rest, styleGuide, prompts } : { ...rest, styleGuide };
  };
  const clean = (text ?? '').replace(/\r\n/g, '\n').trimEnd();
  if (clean.trim() === '') return done(g.styleGuide);

  let template = clean;
  let styleGuide = g.styleGuide;
  const open = clean.indexOf(GUIDE_OPEN);
  const close = clean.lastIndexOf(GUIDE_CLOSE);
  if (open >= 0 && close > open) {
    styleGuide = clean.slice(open + GUIDE_OPEN.length, close).trim();
    template = `${clean.slice(0, open + GUIDE_OPEN.length)}\n${GUIDE_SLOT}\n${clean.slice(close)}`;
  }
  // Slots are looked for outside the guide only.
  const guideAt = template.indexOf(GUIDE_SLOT);
  const head = guideAt < 0 ? '' : template.slice(0, guideAt + GUIDE_SLOT.length);
  let tail = guideAt < 0 ? template : template.slice(guideAt + GUIDE_SLOT.length);
  tail = put(tail, rulesBlock(kind, g.rules), RULES_SLOT);
  if (kind === 'translate') tail = put(tail, PREVIOUS_LINE, PREVIOUS_SLOT);
  template = head + tail;

  if (template !== DEFAULT_TEMPLATES[kind]) prompts[kind] = template;
  return done(styleGuide);
}
