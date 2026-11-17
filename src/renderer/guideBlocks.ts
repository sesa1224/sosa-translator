// The instruction text is one long string that is sent as it is. To read it, it is cut into blocks at its own
// "## " headings; the cut loses nothing, so joining the blocks' text gives the string back.

export interface GuideBlock {
  /** intro: before the first heading. section: one "## " heading and what is under it. outro: from the closing guide tag on. */
  kind: 'intro' | 'section' | 'outro';
  title: string;
  /** This block's exact slice of the whole text, its heading line and trailing line breaks included. */
  text: string;
  /** Where the slice starts in the whole text, and on which line. */
  at: number;
  line: number;
}

const HEADING = /^##\s+(.+?)\s*$/;
const GUIDE_END = '</번역 지침>';

export function splitGuide(text: string): GuideBlock[] {
  const starts: { kind: GuideBlock['kind']; title: string; at: number; line: number }[] = [{ kind: 'intro', title: '머리말', at: 0, line: 0 }];
  let at = 0;
  let closed = false;
  text.split('\n').forEach((l, line) => {
    const m = HEADING.exec(l);
    // After the guide closes, the rest is what the program reads; its own "## " lines do not open sections.
    if (!closed && l.trim() === GUIDE_END) {
      closed = true;
      starts.push({ kind: 'outro', title: '지침 밖의 글', at, line });
    } else if (!closed && m) starts.push({ kind: 'section', title: m[1], at, line });
    at += l.length + 1;
  });
  return starts
    .map((s, i) => ({ ...s, text: text.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : text.length) }))
    .filter((b) => b.kind !== 'intro' || b.text.trim() !== '');
}

export type GuideLine =
  | { type: 'bullet'; depth: 0 | 1; key: string | null; text: string }
  | { type: 'para'; text: string }
  | { type: 'tag'; text: string }
  | { type: 'gap' };

const BULLET = /^(\s*)[-·•]\s+(.*)$/;
/** "말높이: …" — a short label before the first colon is what the eye looks for in a rule. */
const KEY = /^([^:：`]{1,20})[:：]\s+(.*)$/;

/** A block's body as lines to draw: rules as bullets with their label pulled out, the rest as paragraphs. */
export function guideLines(block: GuideBlock): GuideLine[] {
  const lines = block.text.replace(/\s+$/, '').split('\n');
  if (block.kind === 'section') lines.shift();
  const out: GuideLine[] = [];
  for (const l of lines) {
    const b = BULLET.exec(l);
    if (l.trim() === '') {
      if (out.length > 0 && out[out.length - 1].type !== 'gap') out.push({ type: 'gap' });
    } else if (b) {
      const k = KEY.exec(b[2]);
      out.push({ type: 'bullet', depth: b[1].length >= 2 ? 1 : 0, key: k ? k[1] : null, text: k ? k[2] : b[2] });
    } else if (/^<\/?[^<>]+>$/.test(l.trim())) out.push({ type: 'tag', text: l.trim() });
    else out.push({ type: 'para', text: l });
  }
  while (out.length > 0 && out[0].type === 'gap') out.shift();
  return out;
}

/** Text cut at `backtick` spans so those can be drawn as code. */
export function codeSpans(text: string): { code: boolean; text: string }[] {
  return text.split(/(`[^`]+`)/).filter((p) => p !== '').map((p) => (p.length > 2 && p.startsWith('`') && p.endsWith('`') ? { code: true, text: p.slice(1, -1) } : { code: false, text: p }));
}
