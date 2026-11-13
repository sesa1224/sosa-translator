import { expect, test } from 'vitest';
import { composeSpeaker, detectSpeakerPattern, SPEAKER_PRESETS, speakerNames, splitSpeaker } from '../../src/core/text/speaker.js';
import type { TextUnit } from '../../src/core/types.js';

const D = (source: string): TextUnit => ({ id: source, kind: 'dialogue', source, needsDecision: false, refs: [] });
const bracket = SPEAKER_PRESETS.find(p => p.id === 'bracket')!.pattern;
test('패턴 찾기', () => {
  const units = [D('\\C[4]【アーテル】\\C[0]\n「もちろん無料で」'), D('\\C[4]【ギア】\\C[0]\n「ふん」'), D('地の文だけ'), D('【アーテル】\n「え？」')];
  expect(detectSpeakerPattern(units)).toMatchObject({ presetId: 'bracket', coverage: 1 });
  expect(detectSpeakerPattern([D('あ\nい'), D('う\nえ')])).toBeNull();
});
test('떼고 다시 붙이기', () => {
  const s = splitSpeaker('\\C[4]【アーテル】\\C[0]\n「冗談よ、\nちゃんと払うわ」', bracket);
  expect(s).toEqual({ speakerLine: '\\C[4]【アーテル】\\C[0]', speaker: 'アーテル', body: '「冗談よ、\nちゃんと払うわ」' });
  expect(composeSpeaker(s.speakerLine!, s.speaker!, '아텔', '「농담이야,\n제대로 낼게」')).toBe('\\C[4]【아텔】\\C[0]\n「농담이야,\n제대로 낼게」');
});
test('안 맞거나 한 줄이면 떼지 않는다', () => {
  expect(splitSpeaker('【注意】', bracket)).toEqual({ speakerLine: null, speaker: null, body: '【注意】' });
  expect(splitSpeaker('ただの文\n二行目', bracket).speakerLine).toBeNull(); expect(splitSpeaker('あ\nい', null).body).toBe('あ\nい');
});
test('화자 이름 모으기', () => {
  expect(speakerNames([D('【アーテル】\nあ'), D('【アーテル】\nい'), D('【ギア】\nう'), { ...D('え'), speaker: 'リナ' }], bracket)).toEqual([{ name: 'アーテル', count: 2 }, { name: 'ギア', count: 1 }, { name: 'リナ', count: 1 }]);
});

// Extra coverage beyond the plan's assertions.
test('다른 프리셋과 잘못된 패턴', () => {
  expect(detectSpeakerPattern([D('\\N<リナ>\nあ'), D('\\n<ギア>\nい'), D('ただ\nの文')])).toMatchObject({ presetId: 'name-code' });
  expect(detectSpeakerPattern([D('リナ：\nあ'), D('ギア:\nい')])).toMatchObject({ presetId: 'colon', coverage: 1 });
  expect(splitSpeaker('【あ】\nい', '([')).toEqual({ speakerLine: null, speaker: null, body: '【あ】\nい' });
  expect(composeSpeaker('\\N<リナ>', 'リナ', '리나', '본문')).toBe('\\N<리나>\n본문');
  expect(detectSpeakerPattern([D('한 줄')])).toBeNull();
});
