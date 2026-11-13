import type { EventCommand } from '../patches/types.js';
import { idName, type NameTable } from './nameFormat.js';

const UNKNOWN_MAX = 120;
const COMPARE = ['=', '≥', '≤', '>', '<', '≠'];
const ASSIGN = ['=', '+=', '-=', '*=', '/=', '%='];

/** Commands whose text goes on in the following commands of another code (the head absorbs them). */
const CONTINUATION: Record<number, { code: number; text: boolean }> = {
  101: { code: 401, text: true },
  105: { code: 405, text: true },
  108: { code: 408, text: true },
  355: { code: 655, text: true },
  357: { code: 657, text: false },
  205: { code: 505, text: false },
  302: { code: 605, text: false },
};

const FIXED: Record<number, string> = {
  403: '└ 취소하면', 404: '선택지 끝', 411: '아니면', 412: '조건 끝', 112: '반복', 413: '반복 끝', 113: '반복 빠져나가기',
  115: '이벤트 처리 끝내기', 203: '이벤트 위치 바꾸기', 205: '이동 경로 설정', 210: '이동 끝날 때까지 기다리기', 214: '이벤트 일시 삭제',
  221: '화면 페이드아웃', 222: '화면 페이드인', 223: '화면 색조 바꾸기', 224: '화면 번쩍임', 225: '화면 흔들기',
  242: 'BGM 페이드아웃', 302: '상점 열기', 311: 'HP 증감', 312: 'MP 증감', 313: '상태 변경', 314: '전체 회복', 315: '경험치 증감',
  316: '레벨 증감', 317: '능력치 증감', 318: '스킬 증감', 322: '액터 그림 바꾸기', 351: '메뉴 열기', 352: '저장 화면 열기',
  353: '게임 오버', 354: '타이틀로 돌아가기', 601: '└ 이기면', 602: '└ 도망치면', 603: '└ 지면', 604: '전투 끝',
};

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v) ?? '');
const onOff = (v: unknown): string => (v === 0 ? '켬' : '끔');

function unknownText(cmd: EventCommand): string {
  let json = JSON.stringify(cmd.parameters) ?? '';
  if (json.length > UNKNOWN_MAX) json = json.slice(0, UNKNOWN_MAX) + '…';
  return `코드 ${cmd.code} ${json}`;
}

function audioName(v: unknown): string {
  const n = (v as { name?: unknown } | null)?.name;
  return typeof n === 'string' ? n : '';
}

/** 'id [name]' for one id, or 'a~b' for a range. */
function range(list: string[], a: unknown, b: unknown): string {
  return a === b ? idName(list, a) : `${String(a)}~${String(b)}`;
}

function condition(p: unknown[], n: NameTable): string {
  switch (p[0]) {
    case 0: return `만약 스위치 ${idName(n.switches, p[1])} 이 ${p[2] === 0 ? '켜짐' : '꺼짐'}이면`;
    case 1: {
      const rhs = p[2] === 0 ? String(p[3]) : `변수 ${idName(n.variables, p[3])}`;
      return `만약 변수 ${idName(n.variables, p[1])} ${COMPARE[p[4] as number] ?? '?'} ${rhs} 이면`;
    }
    case 2: return `만약 셀프 스위치 ${String(p[1])} 가 ${p[2] === 0 ? '켜짐' : '꺼짐'}이면`;
    case 4: if (p[2] === 0) return `만약 액터 ${idName(n.actors, p[1])} 이 파티에 있으면`; break;
    case 8: return `만약 아이템 ${idName(n.items, p[1])} 을 가졌으면`;
    case 12: return `만약 스크립트: ${str(p[1])}`;
  }
  return `만약 (조건 종류 ${String(p[0])})`;
}

function variableOp(p: unknown[], n: NameTable): string {
  let value: string;
  switch (p[3]) {
    case 0: value = String(p[4]); break;
    case 1: value = `변수 ${idName(n.variables, p[4])}`; break;
    case 2: value = `난수 ${String(p[4])}~${String(p[5])}`; break;
    case 4: value = `스크립트: ${str(p[4])}`; break;
    default: value = '(게임 데이터)';
  }
  const op = ASSIGN[p[2] as number] ?? '=';
  return `변수 ${range(n.variables, p[0], p[1])} ${op} ${value}`;
}

/** '+3', '-3' or '+변수 5' for the (operation, operandType, operand) triple of 125-128. */
function amount(op: unknown, type: unknown, operand: unknown, n: NameTable): string {
  const sign = op === 0 ? '+' : '-';
  return type === 0 ? `${sign}${String(operand)}` : `${sign}변수 ${idName(n.variables, operand)}`;
}

function pluginArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '{}';
  const parts = Object.entries(args as Record<string, unknown>).map(([k, v]) => `${k}: ${str(v)}`);
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
}

function describeKnown(cmd: EventCommand, p: unknown[], n: NameTable): string | null {
  const fixed = FIXED[cmd.code];
  if (fixed !== undefined) return fixed;
  switch (cmd.code) {
    case 101: return '대사';
    case 401: return str(p[0]);
    case 102: return `선택지: ${Array.isArray(p[0]) ? p[0].map(str).join(' / ') : ''}`;
    case 402: return `└ "${str(p[1])}" 를 고르면`;
    case 103: return `숫자 입력 → 변수 ${idName(n.variables, p[0])}, ${String(p[1])}자리`;
    case 104: return `아이템 고르기 → 변수 ${idName(n.variables, p[0])}`;
    case 105: return '스크롤 문장:';
    case 108: return '주석:';
    case 111: return condition(p, n);
    case 117: return `커먼이벤트 ${idName(n.commonEvents, p[0])} 실행`;
    case 118: return `라벨 "${str(p[0])}"`;
    case 119: return `라벨 "${str(p[0])}" 으로 이동`;
    case 121: return `스위치 ${range(n.switches, p[0], p[1])} = ${onOff(p[2])}`;
    case 122: return variableOp(p, n);
    case 123: return `셀프 스위치 ${String(p[0])} = ${onOff(p[1])}`;
    case 125: return `소지금 ${amount(p[0], p[1], p[2], n)}`;
    case 126: return `아이템 ${idName(n.items, p[0])} ${amount(p[1], p[2], p[3], n)}`;
    case 127: return `무기 ${idName(n.weapons, p[0])} ${amount(p[1], p[2], p[3], n)}`;
    case 128: return `방어구 ${idName(n.armors, p[0])} ${amount(p[1], p[2], p[3], n)}`;
    case 129: return `파티에 액터 ${idName(n.actors, p[0])} ${p[1] === 0 ? '넣기' : '빼기'}`;
    case 201: return p[0] === 0 ? `장소 이동 맵 ${idName(n.maps, p[1])} (${String(p[2])}, ${String(p[3])})` : '장소 이동 (변수로 지정)';
    case 211: return `투명 상태 ${onOff(p[0])}`;
    case 230: return `기다리기 ${String(p[0])}프레임`;
    case 231: return `그림 표시 ${String(p[0])}번: ${str(p[1])}`;
    case 232: return `그림 이동 ${String(p[0])}번`;
    case 235: return `그림 지우기 ${String(p[0])}번`;
    case 241: return `BGM 재생: ${audioName(p[0])}`;
    case 245: return `BGS 재생: ${audioName(p[0])}`;
    case 249: return `ME 재생: ${audioName(p[0])}`;
    case 250: return `SE 재생: ${audioName(p[0])}`;
    case 261: return `영상 재생: ${str(p[0])}`;
    case 301: return p[0] === 0 ? `전투: 적 무리 ${idName(n.troops, p[1])}` : '전투: (변수로 지정)';
    case 303: return `이름 입력: 액터 ${idName(n.actors, p[0])}`;
    case 320: return `액터 ${idName(n.actors, p[0])} 의 이름을 "${str(p[1])}" 로`;
    case 355: return '스크립트:';
    case 356: return `플러그인 커맨드: ${str(p[0])}`;
    case 357: return `플러그인 커맨드: ${str(p[0])} · ${str(p[1])} ${pluginArgs(p[3])}`;
  }
  return null;
}

/** One command as a Korean line. Never throws: odd or unknown commands read 'code N [parameters]'. */
export function describeCommand(cmd: EventCommand, n: NameTable): string {
  try {
    if (!Array.isArray(cmd.parameters)) return unknownText(cmd);
    return describeKnown(cmd, cmd.parameters, n) ?? unknownText(cmd);
  } catch {
    return unknownText(cmd);
  }
}

/** A described line. index: original position of its first command; count: how many commands it stands for. */
export interface DescribedLine { index: number; indent: number; text: string; code: number; count: number }

const isCommand = (v: unknown): v is EventCommand => !!v && typeof v === 'object' && typeof (v as EventCommand).code === 'number';

/**
 * A command list as lines: text lines that continue a head command (401 after 101, 405, 408, 655) are joined into
 * it with ' / ', other continuations (657, 505, 605) are dropped into their head. Empty commands (code 0) are left out.
 */
export function describeList(list: EventCommand[], n: NameTable): DescribedLine[] {
  const out: DescribedLine[] = [];
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < list.length; i++) {
    const cmd = list[i];
    if (!isCommand(cmd) || cmd.code === 0) continue;
    const indent = typeof cmd.indent === 'number' ? cmd.indent : 0;
    const cont = CONTINUATION[cmd.code];
    if (!cont) {
      out.push({ index: i, indent, text: describeCommand(cmd, n), code: cmd.code, count: 1 });
      continue;
    }
    const parts: string[] = [];
    let j = i + 1;
    for (; j < list.length; j++) {
      const c = list[j];
      if (!isCommand(c) || c.code !== cont.code) break;
      if (cont.text) parts.push(Array.isArray(c.parameters) ? str(c.parameters[0]) : '');
    }
    let text: string;
    if (cmd.code === 101) {
      const p = Array.isArray(cmd.parameters) ? cmd.parameters : [];
      const speaker = typeof p[4] === 'string' && p[4] !== '' ? ` [${p[4]}]` : '';
      text = `대사${speaker}${parts.length > 0 ? ' ' + parts.join(' / ') : ''}`;
    } else if (cmd.code === 355 || cmd.code === 108) {
      // These heads carry the first line themselves.
      const first = Array.isArray(cmd.parameters) ? str(cmd.parameters[0]) : '';
      text = `${cmd.code === 355 ? '스크립트' : '주석'}: ${[first, ...parts].join(' / ')}`;
    } else if (cont.text) {
      text = `${describeCommand(cmd, n)} ${parts.join(' / ')}`.trimEnd();
    } else text = describeCommand(cmd, n);
    out.push({ index: i, indent, text, code: cmd.code, count: j - i });
    i = j - 1;
  }
  return out;
}
