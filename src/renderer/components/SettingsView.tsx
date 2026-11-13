import { useEffect, useState } from 'react';
import type { AppSettings } from '../../shared/api';
import { useApp } from '../state';

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
        <div className="seg" role="radiogroup" aria-labelledby="set-theme">
          {(['dark', 'light'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={settings.theme === t} className={settings.theme === t ? 'on' : ''}
              onClick={() => void save({ theme: t })}>{t === 'dark' ? '어두운' : '밝은'}</button>
          ))}
        </div>
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
          {claudePath ? <>지금 쓰는 경로 <span className="mono accent-text">{claudePath}</span></> : <span className="warn-text">Claude CLI를 찾지 못했어요</span>}
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

      {error && <span className="err-text" role="alert">{error}</span>}
    </div>
  );
}
