import { useEffect, useState } from 'react';
import { DEFAULT_DECIDE_MODEL, type AppSettings, type StageModels, type ThemeName } from '../../shared/api';
import { useApp } from '../state';
import { FontPicker } from './FontPicker';
import { ImageFolderSettings } from './ImageView';
import { FontEmbedSection } from './PatchView';
import { TextWindowSettings } from './TextWindowSettings';

const STAGES: [Exclude<keyof StageModels, 'glossaryRead'>, string][] = [['glossary', '용어집 정리'], ['translate', '전체 번역'], ['review', '검수'], ['patchNotes', '패치노트 정리']];

/** Names shown for each theme; the first two keep the words the settings used before there were more. */
const THEME_CARDS: { id: ThemeName; name: string; note?: string }[] = [
  { id: 'dark', name: '어두운', note: '기본 청록' }, { id: 'light', name: '밝은', note: '기본' },
  { id: 'moon', name: '붉은 달밤' }, { id: 'ember', name: '촛불 어둠' }, { id: 'murim', name: '먹빛 강호' },
  { id: 'deep', name: '심우주 청록' }, { id: 'rpg', name: '고전 RPG 파랑' }, { id: 'hanji', name: '한지와 먹' },
];

export function SettingsView() {
  const { settings, claudePath } = useApp();
  const [label, setLabel] = useState('');
  const [id, setId] = useState('');
  const [cli, setCli] = useState(settings?.claudePath ?? '');
  const [dir, setDir] = useState(settings?.projectsDir ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setCli(settings?.claudePath ?? ''); }, [settings?.claudePath]);
  useEffect(() => { setDir(settings?.projectsDir ?? ''); }, [settings?.projectsDir]);

  if (!settings) return null;

  const save = async (patch: Partial<AppSettings>) => {
    setError(null);
    try {
      await useApp.updateSettings(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addModel = async () => {
    const m = { id: id.trim(), label: label.trim() };
    if (!m.id || !m.label) return setError('모델 이름과 id 를 모두 적어 주세요');
    if (settings.models.some((x) => x.id === m.id)) return setError('이미 있는 모델 id 입니다');
    await save({ models: [...settings.models, m] });
    setLabel('');
    setId('');
  };
  const removeModel = (mid: string) => {
    const models = settings.models.filter((m) => m.id !== mid);
    const chatModel = settings.chatModel === mid || !models.some((m) => m.id === settings.chatModel) ? models[0].id : settings.chatModel;
    return save({ models, chatModel });
  };

  return (
    <div className="settings">
      <h1 className="page-title">설정</h1>

      <section className="card settings-card" aria-labelledby="set-theme">
        <span id="set-theme" className="card-title">테마</span>
        <div className="theme-grid" role="radiogroup" aria-labelledby="set-theme">
          {THEME_CARDS.map(({ id, name, note }) => (
            <button key={id} type="button" role="radio" aria-checked={settings.theme === id} aria-label={name}
              className={`theme-card${settings.theme === id ? ' on' : ''}`} onClick={() => void save({ theme: id })}>
              {/* The swatch carries the theme's own tokens, so it shows that theme while another is on. */}
              <span className="theme-swatch" data-theme={id} aria-hidden="true"><i /><i /><i /><i /></span>
              <span className="theme-name">{name}</span>
              {note && <span className="mute small">{note}</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="card settings-card" aria-labelledby="set-stages">
        <span id="set-stages" className="card-title">단계별 모델</span>
        <div className="stage-grid">
          <div className="field">
            <label htmlFor="stage-glossaryRead">대본 읽기</label>
            <select id="stage-glossaryRead" className="input" value={settings.stageModels.glossaryRead ?? ''}
              onChange={(e) => {
                const { glossaryRead: _old, ...rest } = settings.stageModels;
                void save({ stageModels: e.target.value ? { ...rest, glossaryRead: e.target.value } : rest });
              }}>
              <option value="">용어집 정리와 같음</option>
              {settings.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          {STAGES.map(([k, label]) => (
            <div key={k} className="field">
              <label htmlFor={`stage-${k}`}>{label}</label>
              <select id={`stage-${k}`} className="input" value={settings.stageModels[k]}
                onChange={(e) => void save({ stageModels: { ...settings.stageModels, [k]: e.target.value } })}>
                {!settings.models.some((m) => m.id === settings.stageModels[k]) && <option value={settings.stageModels[k]}>{settings.stageModels[k]}</option>}
                {settings.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          ))}
          <div className="field">
            <label htmlFor="stage-decide">판단 필요 추천</label>
            <select id="stage-decide" className="input" value={settings.stageModels.decide ?? DEFAULT_DECIDE_MODEL}
              onChange={(e) => void save({ stageModels: { ...settings.stageModels, decide: e.target.value } })}>
              {!settings.models.some((m) => m.id === (settings.stageModels.decide ?? DEFAULT_DECIDE_MODEL)) && <option value={settings.stageModels.decide ?? DEFAULT_DECIDE_MODEL}>{settings.stageModels.decide ?? DEFAULT_DECIDE_MODEL}</option>}
              {settings.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <span className="hint">용어집 초안(대본 읽기와 정리), 전체 번역, 검수를 맡길 때 각각 이 모델을 써요. 대본 읽기를 비우면 용어집 정리 모델로 읽어요.</span>
      </section>

      <section className="card settings-card" aria-labelledby="set-models">
        <span id="set-models" className="card-title">모델</span>
        <div className="field narrow">
          <label htmlFor="chat-default-model">채팅 기본 모델</label>
          <select id="chat-default-model" className="input" value={settings.chatModel} onChange={(e) => void save({ chatModel: e.target.value })}>
            {settings.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <ul className="model-list">
          {settings.models.map((m) => (
            <li key={m.id}>
              <span>{m.label}</span>
              <span className="mono sub small">{m.id}</span>
              <div className="grow" />
              <button type="button" className="btn ghost small-btn" aria-label={`${m.label} 삭제`} disabled={settings.models.length <= 1}
                title={settings.models.length <= 1 ? '모델이 하나 이상 있어야 합니다' : undefined}
                onClick={() => void removeModel(m.id)}>삭제</button>
            </li>
          ))}
        </ul>
        <div className="model-add">
          <div className="field"><label htmlFor="model-label">모델 이름</label>
            <input id="model-label" className="input" value={label} placeholder="Claude Opus 6" onChange={(e) => setLabel(e.target.value)} /></div>
          <div className="field"><label htmlFor="model-id">모델 id</label>
            <input id="model-id" className="input mono" value={id} placeholder="claude-opus-6" onChange={(e) => setId(e.target.value)} /></div>
          <button type="button" className="btn" onClick={() => void addModel()}>모델 추가</button>
        </div>
        <span className="hint">새 모델이 나오면 여기서 추가해요. 프로그램을 고치지 않아도 돼요.</span>
      </section>

      <section className="card settings-card" aria-labelledby="set-cli">
        <span id="set-cli" className="card-title">Claude CLI</span>
        <div className="inline-field">
          <div className="field grow"><label htmlFor="cli-path">Claude CLI 경로</label>
            <input id="cli-path" className="input mono" value={cli} placeholder="비우면 자동으로 찾아요" onChange={(e) => setCli(e.target.value)} /></div>
          <button type="button" className="btn" aria-label="CLI 경로 적용" onClick={() => void save({ claudePath: cli.trim() || null })}>적용</button>
        </div>
        <span className="small">
          {claudePath ? <>지금 쓰는 경로 <span className="mono accent-text path-text">{claudePath}</span></> : <span className="warn-text">Claude CLI를 찾지 못했어요</span>}
        </span>
      </section>

      <section className="card settings-card" aria-labelledby="set-dir">
        <span id="set-dir" className="card-title">프로젝트 폴더 위치</span>
        <div className="inline-field">
          <div className="field grow"><label htmlFor="projects-dir">프로젝트 폴더</label>
            <input id="projects-dir" className="input mono" value={dir} onChange={(e) => setDir(e.target.value)} /></div>
          <button type="button" className="btn" aria-label="프로젝트 폴더 적용" disabled={!dir.trim()}
            onClick={() => void save({ projectsDir: dir.trim() })}>적용</button>
        </div>
        <span className="hint">새 프로젝트가 이 폴더 아래에 만들어져요. 이미 있는 프로젝트는 옮기지 않아요.</span>
      </section>

      <FontPicker />
      <TextWindowSettings />
      <FontEmbedSection />
      <ImageFolderSettings />
      {error && <span className="err-text" role="alert">{error}</span>}
    </div>
  );
}

