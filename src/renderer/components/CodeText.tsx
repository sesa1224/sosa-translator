import { Fragment, type ReactNode } from 'react';
import { controlCodes } from '../../core/text/controlCodes';

type Piece = { code: boolean; text: string };

/** Splits text into plain runs and control-code tokens (\C[2], \N[1], %1 ...), in order. */
export function splitCodes(text: string): Piece[] {
  const out: Piece[] = [];
  const lower = text.toLowerCase();
  let pos = 0;
  for (const code of controlCodes(text)) {
    const at = lower.indexOf(code.toLowerCase(), pos);
    if (at < 0) continue;
    if (at > pos) out.push({ code: false, text: text.slice(pos, at) });
    out.push({ code: true, text: text.slice(at, at + code.length) });
    pos = at + code.length;
  }
  if (pos < text.length) out.push({ code: false, text: text.slice(pos) });
  return out;
}

function withBreaks(text: string, key: string): ReactNode[] {
  return text.split('\n').flatMap((line, i) => (i === 0 ? [line] : [<br key={`${key}-br${i}`} />, line]));
}

/** Text with control codes drawn as chips and line breaks as <br>. */
export function CodeText({ text }: { text: string }) {
  return (
    <>
      {splitCodes(text).map((p, i) => (p.code
        ? <code key={i} className="chip">{p.text}</code>
        : <Fragment key={i}>{withBreaks(p.text, String(i))}</Fragment>))}
    </>
  );
}
