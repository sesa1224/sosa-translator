import type { WordPiece } from '../../core/update/carry';

/** Text with its changed pieces marked: struck out on the old side, highlighted on the new side. */
export function DiffPieces({ pieces, kind }: { pieces: WordPiece[]; kind: 'old' | 'new' }) {
  return (
    <>
      {pieces.map((p, i) => {
        if (!p.changed) return <span key={i}>{p.text}</span>;
        return kind === 'old' ? <del key={i} className="diff-del">{p.text}</del> : <ins key={i} className="diff-add">{p.text}</ins>;
      })}
    </>
  );
}
