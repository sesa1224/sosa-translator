import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import { RenderService, type RenderReply, type RenderRequest } from '../../src/main/render/renderService.js';

class FakeWin extends EventEmitter {
  sent: RenderRequest[] = [];
  destroyed = false;
  send(r: RenderRequest): void {
    this.sent.push(r);
    this.emit('sent', r);
  }
  destroy(): void {
    this.destroyed = true;
  }
  reply(r: { ok: true; png: Uint8Array } | { ok: false; error: string }, at = this.sent.length - 1): void {
    this.emit('done', { ...r, id: this.sent[at].id } as RenderReply);
  }
}

function setup(timeoutMs?: number) {
  const wins: FakeWin[] = [];
  const svc = new RenderService({ createWindow: () => { const w = new FakeWin(); wins.push(w); return w; }, timeoutMs });
  return { svc, wins };
}

const nextSent = (w: FakeWin) => new Promise<RenderRequest>((resolve) => w.once('sent', resolve));
const tick = () => new Promise((r) => setTimeout(r, 0));
const job = { base: Uint8Array.from([1]), regions: [], fonts: {}, defaultFontPath: null };

test('작업은 하나씩 차례로 보내지고, 오류 응답은 그 작업만 실패시킨다', async () => {
  const { svc, wins } = setup();
  const a = svc.render(job);
  const b = svc.thumbnail(Uint8Array.from([2]), 64);
  await tick();
  expect(wins).toHaveLength(1);
  expect(wins[0].sent).toHaveLength(1);
  expect(wins[0].sent[0].kind).toBe('render');
  const second = nextSent(wins[0]);
  wins[0].reply({ ok: false, error: '폰트를 읽을 수 없음' });
  await expect(a).rejects.toThrow('그림을 찍지 못했습니다: 폰트를 읽을 수 없음');
  expect((await second).kind).toBe('thumbnail');
  wins[0].reply({ ok: true, png: Uint8Array.from([9, 9]) });
  expect(await b).toEqual(Uint8Array.from([9, 9]));
  expect(wins).toHaveLength(1);
  svc.dispose();
  expect(wins[0].destroyed).toBe(true);
});

test('창이 죽으면 새 창으로 한 번 더, 또 죽으면 실패. 그 뒤 작업은 정상', async () => {
  const { svc, wins } = setup();
  const a = svc.sheet({ cells: [], columns: 5, cellSize: 100 });
  await tick();
  wins[0].emit('closed');
  await tick();
  expect(wins).toHaveLength(2);
  expect(wins[0].destroyed).toBe(true);
  expect(wins[1].sent[0].kind).toBe('sheet');
  wins[1].emit('closed');
  await expect(a).rejects.toThrow('그림을 찍지 못했습니다');

  const b = svc.render(job);
  await tick();
  expect(wins).toHaveLength(3);
  wins[2].reply({ ok: true, png: Uint8Array.from([7]) });
  expect(await b).toEqual(Uint8Array.from([7]));
  svc.dispose();
});

test('응답이 시간 안에 없으면 새 창으로 다시 보낸다', async () => {
  const { svc, wins } = setup(30);
  const a = svc.render(job);
  await tick();
  for (let i = 0; i < 200 && !wins[1]?.sent[0]; i++) await new Promise((r) => setTimeout(r, 5));
  expect(wins[0].destroyed).toBe(true);
  expect(wins[1].sent[0].kind).toBe('render');
  wins[1].reply({ ok: true, png: Uint8Array.from([5]) });
  expect(await a).toEqual(Uint8Array.from([5]));
  svc.dispose();
});

test('폰트는 창마다 한 번만 보낸다', async () => {
  const { svc, wins } = setup();
  const font = Uint8Array.from([1, 2, 3]);
  const withFont = { ...job, regions: [], fonts: { 'C:/f.ttf': font } };
  const a = svc.render(withFont);
  await tick();
  expect(Object.values(wins[0].sent[0].fonts ?? {})).toEqual([font]);
  wins[0].reply({ ok: true, png: Uint8Array.from([1]) });
  await a;
  const b = svc.render(withFont);
  await tick();
  expect(Object.keys(wins[0].sent[1].fonts ?? {})).toEqual([]);
  expect(Object.keys(wins[0].sent[1].fontKeys ?? {})).toEqual(['C:/f.ttf']);
  wins[0].reply({ ok: true, png: Uint8Array.from([1]) });
  await b;
  svc.dispose();
});
