import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { termsIn } from '../../core/glossary/match';
import { SPEAKER_PRESETS } from '../../core/text/speaker';
import type { CharacterCard, DraftChoice, DraftMode, Glossary, ProjectRules, Row, SpeakerDetection, Term, TermCategory, TermScope } from '../../shared/api';
import { num } from '../format';
import { orderedRows, useApp } from '../state';
import { DraftDialog } from './DraftDialog';

const CATEGORY_LABEL: Record<TermCategory, string> = { name: '이름', place: '지명', term: '용어', sfx: '효과음', other: '기타' };
const CATEGORIES = Object.keys(CATEGORY_LABEL) as TermCategory[];
const EXAMPLES = 2;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function onEnter(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      fn();
    }
  };
}

interface Notice { key: number; source: string; target: string; changed: number; uncertain: string[] }

/** Translated rows whose source uses the term. */
function rowsUsing(term: Term, rows: Row[]): Row[] {
  return rows.filter((r) => r.target !== null && r.source.includes(term.source) && termsIn(r.source, [term]).length > 0);
}

function DecisionCard({ term, rows, onChoose }: { term: Term; rows: Row[]; onChoose: (t: Term, target: string) => Promise<void> }) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const used = rowsUsing(term, rows).length;
  const examples = rows.filter((r) => r.source.includes(term.source)).slice(0, EXAMPLES).map((r) => r.source.replace(/\n/g, ' '));
  return (
    <section className="card decide" aria-label={`${term.source} 결정`}>
      <div className="row-between wrap">
        <span><b>{term.source}</b> <span className="sub">을 어떻게 옮길까요?</span></span>
        <span className="chip warn">{`추천안으로 진행 중 · ${num(used)}문장`}</span>
      </div>
      {examples.length > 0 && <span className="sub small">{`예문: ${examples.join(' / ')}`}</span>}
      <div className="cand-grid">
        {term.candidates.map((c, i) => (
          <button key={c.target} type="button" className={`cand${c.target === term.target ? ' on' : ''}`} onClick={() => void onChoose(term, c.target)}>
            <span>{c.target}{i === 0 && <span className="accent-text small"> 추천</span>}</span>
            {c.reason && <span className="sub small">{c.reason}</span>}
          </button>
        ))}
        {typing ? (
          <div className="cand typing">
            <label htmlFor={`own-${term.id}`} className="sr-only">{`${term.source} 번역`}</label>
            <input id={`own-${term.id}`} className="input" autoFocus value={text} placeholder="번역 입력 후 Enter"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onEnter(() => { if (text.trim()) void onChoose(term, text.trim()); })} />
          </div>
        ) : (
          <button type="button" className="cand dashed" onClick={() => setTyping(true)}>직접 입력</button>
        )}
      </div>
    </section>
  );
}

function TermRow({ term }: { term: Term }) {
  const [value, setValue] = useState(term.target);
  useEffect(() => { setValue(term.target); }, [term.target]);
  const commit = () => {
    const v = value.trim();
    if (v && v !== term.target) void useApp.chooseTerm(term.id, v).catch(() => setValue(term.target));
  };
  const { id: _id, ...rest } = term;
  // The two scopes exclude each other: turning one on turns the other off.
  const setScope = (scope: TermScope | undefined) => {
    const { scope: _scope, ...plain } = rest;
    void useApp.upsertTerm(scope ? { ...plain, scope } : plain);
  };
  return (
    <div className="term-row" data-testid="term-row">
      <span className="src">{term.source}</span>
      <label htmlFor={`t-${term.id}`} className="sr-only">{`${term.source} 번역 고치기`}</label>
      <input id={`t-${term.id}`} className="input" value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={onEnter(commit)} />
      <label htmlFor={`c-${term.id}`} className="sr-only">{`${term.source} 분류`}</label>
      <select id={`c-${term.id}`} className="input" value={term.category}
        onChange={(e) => void useApp.upsertTerm({ ...rest, category: e.target.value as TermCategory })}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
      </select>
      {term.category === 'name' ? (
        <span className="scope-checks">
          <label className="scope-check small" title="켜면 화자 이름 자리(【 】 안, 이름 칸)에만 이 번역을 맞춰요. 대사 안에서 호칭으로 쓰인 것은 인물 카드를 따라요.">
            <input type="checkbox" aria-label={`${term.source} 화자 이름에만 적용`} checked={term.scope === 'speaker'}
              onChange={(e) => setScope(e.target.checked ? 'speaker' : undefined)} />
            화자만
          </label>
          <label className="scope-check small" title="켜면 이 말이 이름으로 쓰인 곳에만 이 번역을 맞춰요. 같은 글자가 보통 낱말로 쓰인 곳은 문맥대로 옮기고, 검수도 그곳은 짚지 않아요.">
            <input type="checkbox" aria-label={`${term.source} 이름으로 쓰일 때만 적용`} checked={term.scope === 'name'}
              onChange={(e) => setScope(e.target.checked ? 'name' : undefined)} />
            이름으로 쓰일 때만
          </label>
        </span>
      ) : <span />}
      {term.status === 'provisional' ? <span className="chip warn small">추천안</span> : <span />}
      <button type="button" className="btn ghost small-btn" aria-label={`${term.source} 삭제`} onClick={() => void useApp.removeTerm(term.id)}>삭제</button>
    </div>
  );
}

function TermList({ terms }: { terms: Term[] }) {
  const [cat, setCat] = useState<TermCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');
  const [newCat, setNewCat] = useState<TermCategory>('term');
  const [error, setError] = useState<string | null>(null);
  const ql = q.trim().toLowerCase();
  const shown = terms.filter((t) => (cat === 'all' || t.category === cat)
    && (!ql || t.source.toLowerCase().includes(ql) || t.target.toLowerCase().includes(ql)));
  const add = async () => {
    if (!src.trim() || !dst.trim()) return;
    setError(null);
    try {
      await useApp.upsertTerm({ source: src.trim(), target: dst.trim(), category: newCat, status: 'confirmed', candidates: [] });
      setSrc('');
      setDst('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="card" aria-labelledby="g-terms">
      <div className="card-head"><span id="g-terms" className="card-title">용어 목록</span></div>
      <div className="filters pad">
        {(['all', ...CATEGORIES] as const).map((c) => (
          <button key={c} type="button" className={`pill${cat === c ? ' on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c === 'all' ? '전체' : CATEGORY_LABEL[c]}
          </button>
        ))}
        <label htmlFor="g-search" className="sr-only">용어 검색</label>
        <input id="g-search" className="input search" type="search" placeholder="용어 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="term-list">
        {shown.length === 0 && <div className="empty sub">용어가 없어요</div>}
        {shown.map((t) => <TermRow key={t.id} term={t} />)}
        <div className="term-row add">
          <label htmlFor="g-new-src" className="sr-only">새 용어 원문</label>
          <input id="g-new-src" className="input" placeholder="원문" value={src} onChange={(e) => setSrc(e.target.value)} onKeyDown={onEnter(() => void add())} />
          <label htmlFor="g-new-dst" className="sr-only">새 용어 번역</label>
          <input id="g-new-dst" className="input" placeholder="번역" value={dst} onChange={(e) => setDst(e.target.value)} onKeyDown={onEnter(() => void add())} />
          <label htmlFor="g-new-cat" className="sr-only">새 용어 분류</label>
          <select id="g-new-cat" className="input" value={newCat} onChange={(e) => setNewCat(e.target.value as TermCategory)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <span />
          <span />
          <button type="button" className="btn small-btn" disabled={!src.trim() || !dst.trim()} onClick={() => void add()}>추가</button>
        </div>
        {error && <span className="err-text small pad" role="alert">{error}</span>}
      </div>
    </section>
  );
}

type CardField = 'target' | 'speech' | 'firstPerson' | 'addressing' | 'moanStyle';
const CARD_FIELDS: [CardField, string][] = [['target', '번역 이름'], ['speech', '말투'], ['firstPerson', '1인칭'], ['addressing', '호칭'], ['moanStyle', '신음·감탄 스타일']];

function cleanCard(c: CharacterCard): CharacterCard {
  const out: CharacterCard = { id: c.id, source: c.source, target: c.target.trim(), speech: c.speech.trim() };
  if (c.firstPerson?.trim()) out.firstPerson = c.firstPerson.trim();
  if (c.addressing?.trim()) out.addressing = c.addressing.trim();
  if (c.moanStyle?.trim()) out.moanStyle = c.moanStyle.trim();
  return out;
}

function Characters({ cards }: { cards: CharacterCard[] }) {
  const [drafts, setDrafts] = useState(cards);
  const [newName, setNewName] = useState('');
  useEffect(() => { setDrafts(cards); }, [cards]);
  const save = (next: CharacterCard[]) => void useApp.setCharacters(next.map(cleanCard));
  const edit = (i: number, f: CardField, v: string) => setDrafts((d) => d.map((c, k) => (k === i ? { ...c, [f]: v } : c)));
  const commit = () => {
    if (JSON.stringify(drafts.map(cleanCard)) !== JSON.stringify(cards.map(cleanCard))) save(drafts);
  };
  const add = () => {
    const s = newName.trim();
    if (!s || drafts.some((c) => c.source === s)) return;
    save([...drafts, { id: '', source: s, target: '', speech: '' }]);
    setNewName('');
  };
  return (
    <section className="card" aria-labelledby="g-chars">
      <div className="card-head"><span id="g-chars" className="card-title">인물 카드</span>
        <span className="sub small">이 인물이 나오는 묶음을 번역할 때 자동으로 붙어요.</span></div>
      <div className="char-list">
        {drafts.length === 0 && <div className="empty sub">인물 카드가 없어요. 초안을 받으면 채워져요.</div>}
        {drafts.map((c, i) => (
          <div key={c.id || c.source} className="char-card">
            <span className="card-title">{c.source}</span>
            {CARD_FIELDS.map(([f, label]) => (
              <div key={f} className="field">
                <label htmlFor={`ch-${i}-${f}`} className="label">{label}</label>
                {f === 'speech' || f === 'moanStyle'
                  ? <textarea id={`ch-${i}-${f}`} aria-label={`${c.source} ${label}`} className="textbox edit" rows={2} value={c[f] ?? ''}
                      onChange={(e) => edit(i, f, e.target.value)} onBlur={commit} />
                  : <input id={`ch-${i}-${f}`} aria-label={`${c.source} ${label}`} className="input" value={c[f] ?? ''}
                      onChange={(e) => edit(i, f, e.target.value)} onBlur={commit} />}
              </div>
            ))}
            <button type="button" className="btn ghost small-btn" aria-label={`${c.source} 인물 카드 삭제`}
              onClick={() => save(drafts.filter((_, k) => k !== i))}>삭제</button>
          </div>
        ))}
        <div className="inline-field">
          <div className="field grow"><label htmlFor="g-new-char" className="label">새 인물 원문 이름</label>
            <input id="g-new-char" className="input" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={onEnter(add)} /></div>
          <button type="button" className="btn" disabled={!newName.trim()} onClick={add}>인물 추가</button>
        </div>
      </div>
    </section>
  );
}

/** The style guide is edited on its own screen, as part of the whole text that gets sent. */
function GuideLink() {
  return (
    <section className="card">
      <div className="card-head row-between">
        <span className="card-title">번역 지침</span>
        <button type="button" className="btn small-btn" onClick={() => useApp.setView('guide')}>번역 지침 열기</button>
      </div>
      <div className="pad">
        <span className="hint">모델과 내보내기 파일에 전달되는 글 전체는 "번역 지침" 화면에서 보고 고쳐요.</span>
      </div>
    </section>
  );
}

function numOrNull(s: string): number | null {
  const n = Number(s.trim());
  return s.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : Math.round(n * 2) / 2;
}

function NumberRule({ id, label, value, onSave }: { id: string; label: string; value: number | null; onSave: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => { setText(value === null ? '' : String(value)); }, [value]);
  const commit = () => { const v = numOrNull(text); if (v !== value) onSave(v); };
  return (
    <div className="rule-line">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input num" inputMode="numeric" value={text} placeholder="검사 안 함"
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onEnter(commit)} />
    </div>
  );
}

function Rules({ rules }: { rules: ProjectRules }) {
  const [found, setFound] = useState<SpeakerDetection | null | undefined>(undefined);
  const [custom, setCustom] = useState(rules.speakerPattern ?? '');
  useEffect(() => { setCustom(rules.speakerPattern ?? ''); }, [rules.speakerPattern]);
  const set = (r: Partial<ProjectRules>) => void useApp.setRules(r);
  const presetId = rules.speakerPattern === null ? '' : SPEAKER_PRESETS.find((p) => p.pattern === rules.speakerPattern)?.id ?? 'custom';
  const [mode, setMode] = useState(presetId);
  useEffect(() => { setMode(presetId); }, [presetId]);
  const detect = async () => setFound(await useApp.detectSpeakerPattern());
  const toggles: [keyof ProjectRules, string][] = [['controlCodes', '제어 코드 유지'], ['noLeftoverJapanese', '일본어 글자 남기지 않기'], ['sameLineCount', '줄 수를 원문과 같게'], ['halfWidth', '문장부호·숫자·영문을 반각으로'], ['halfWidthBrackets', '괄호 （ ）도 반각으로'], ['notationCheck', '표기 검사'], ['unmask', '가린 글자는 풀어서 쓰기']];
  // The bracket rule only says how far the half-width rule goes; the mask rule is one of the notation checks.
  const off = (k: keyof ProjectRules): boolean => (k === 'halfWidthBrackets' && !rules.halfWidth) || (k === 'unmask' && !rules.notationCheck);
  return (
    <section className="card" aria-labelledby="g-rules">
      <div className="card-head"><span id="g-rules" className="card-title">형식 규칙 · 프로그램이 검사</span></div>
      <div className="pad rules">
        {toggles.map(([k, label]) => (
          <label key={k} className="rule-line check">
            <span>{label}</span>
            <input type="checkbox" checked={(rules[k] as boolean) && !off(k)} disabled={off(k)} onChange={(e) => set({ [k]: e.target.checked })} />
          </label>
        ))}
        <NumberRule id="g-max-lines" label="대사 최대 줄 수" value={rules.maxLines} onSave={(v) => set({ maxLines: v })} />
        <NumberRule id="g-max-width" label="한 줄 최대 글자 수" value={rules.maxLineWidthChars} onSave={(v) => set({ maxLineWidthChars: v })} />
        <div className="rule-line">
          <label htmlFor="g-speaker">화자 줄 패턴</label>
          <select id="g-speaker" className="input" value={mode} onChange={(e) => {
            const v = e.target.value;
            setMode(v);
            if (v === 'custom') return;
            set({ speakerPattern: v === '' ? null : SPEAKER_PRESETS.find((p) => p.id === v)!.pattern });
          }}>
            <option value="">없음</option>
            {SPEAKER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            <option value="custom">직접 입력</option>
          </select>
        </div>
        {mode === 'custom' && (
          <div className="rule-line">
            <label htmlFor="g-speaker-re">화자 줄 정규식</label>
            <input id="g-speaker-re" className="input mono" value={custom} placeholder="^【(.+?)】$" onChange={(e) => setCustom(e.target.value)}
              onBlur={() => set({ speakerPattern: custom.trim() || null })} onKeyDown={onEnter(() => set({ speakerPattern: custom.trim() || null }))} />
          </div>
        )}
        <div className="rule-line">
          <button type="button" className="btn small-btn" onClick={() => void detect()}>자동으로 찾기</button>
          {found === null && <span className="sub small">맞는 패턴을 찾지 못했어요</span>}
          {found && (
            <span className="row-gap small">
              <span>{SPEAKER_PRESETS.find((p) => p.id === found.presetId)?.label}</span>
              <span>{`대사의 ${Math.round(found.coverage * 100)}%가 맞아요`}</span>
              {found.pattern !== rules.speakerPattern && (
                <button type="button" className="btn ghost small-btn" onClick={() => set({ speakerPattern: found.pattern })}>이 패턴 쓰기</button>
              )}
            </span>
          )}
        </div>
        <span className="hint">화자 줄은 대사 첫 줄의 이름(예: 【이름】)이에요. 떼어서 이름은 용어집으로 한 번만 옮기고 다시 붙여요.</span>
      </div>
    </section>
  );
}

export function GlossaryView() {
  const app = useApp();
  const { glossary, glossaryDirty } = app;
  const rows = useMemo(() => orderedRows(app), [app.rowOrder, app.rowsById]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [asking, setAsking] = useState(false);
  if (!glossary) return <div className="empty sub">용어집을 읽는 중…</div>;
  const g: Glossary = glossary;
  const provisional = g.terms.filter((t) => t.status === 'provisional');
  const confirmed = g.terms.length - provisional.length;

  const choose = async (t: Term, target: string) => {
    setError(null);
    try {
      const r = await useApp.chooseTerm(t.id, target);
      setNotices((n) => [{ key: Date.now(), source: t.source, target, changed: r.changed.length, uncertain: r.uncertain }, ...n].slice(0, 5));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const draft = async (mode: DraftMode, choice: DraftChoice) => {
    setError(null);
    setDrafting(true);
    try {
      await useApp.draftGlossary(mode, choice);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDrafting(false);
    }
  };
  const confirm = async () => {
    setError(null);
    try {
      await useApp.confirmGlossary();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const confirmLabel = g.confirmedAt === null ? '용어집 확정' : glossaryDirty ? '다시 확정' : `확정됨 · ${dateLabel(g.confirmedAt)}`;

  return (
    <div className="glossary">
      <div className="page-head">
        <div className="col">
          <h1 className="page-title">용어집</h1>
          <span className="sub">{provisional.length > 0
            ? `용어 ${num(confirmed)}개 확정 · ${num(provisional.length)}개는 추천안으로 진행 중이에요`
            : `용어 ${num(confirmed)}개 확정`}</span>
        </div>
        <div className="row-gap">
          <button type="button" className="btn" disabled={drafting} onClick={() => setAsking(true)}>{g.terms.length > 0 ? '초안 다시 받기' : '초안 받기'}</button>
          <button type="button" className={`btn${g.confirmedAt === null || glossaryDirty ? ' primary' : ''}`}
            disabled={g.confirmedAt !== null && !glossaryDirty} onClick={() => void confirm()}>{confirmLabel}</button>
        </div>
      </div>
      {g.confirmedAt === null && <span className="hint">확정해야 전체 번역을 맡길 수 있어요. 결정 안 한 용어가 남아 있어도 확정할 수 있어요.</span>}
      {error && <span className="err-text" role="alert">{error}</span>}

      {notices.map((n) => (
        <div key={n.key} className="notice" role="status">
          <span>{`${n.source} → ${n.target} · 바꾼 문장 ${num(n.changed)}개`}</span>
          {n.uncertain.length > 0 && <>
            <span className="warn-text">{`조사를 확인할 문장 ${num(n.uncertain.length)}개`}</span>
            <button type="button" className="btn small-btn" onClick={() => useApp.showRows(n.uncertain)}>보기</button>
          </>}
          <div className="grow" />
          <button type="button" className="btn ghost small-btn" aria-label="알림 닫기" onClick={() => setNotices((x) => x.filter((y) => y.key !== n.key))}>닫기</button>
        </div>
      ))}

      {asking && <DraftDialog onClose={() => setAsking(false)} onStart={(m, c) => void draft(m, c)} />}
      {provisional.map((t) => <DecisionCard key={t.id} term={t} rows={rows} onChoose={choose} />)}

      <div className="glossary-grid">
        <TermList terms={g.terms} />
        <div className="col gap">
          <Characters cards={g.characters} />
          <Rules rules={g.rules} />
        </div>
      </div>
      <GuideLink />
    </div>
  );
}
