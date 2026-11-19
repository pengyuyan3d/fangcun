// 无头自检 v2：方块破碎的规则验证（对照 Block Blast 机制）
const fs = require('fs');
const vm = require('vm');
const path = process.argv[2] || 'index.html';

const html = fs.readFileSync(path, 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const noop = () => {};
const gradient = () => ({ addColorStop: noop });
const CTX = new Proxy({
  canvas: { width: 0, height: 0 },
  createLinearGradient: gradient, createRadialGradient: gradient,
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  measureText: () => ({ width: 10 }),
}, { get(o, k) { return k in o ? o[k] : noop; }, set(o, k, v) { o[k] = v; return true; } });
const mkCanvas = () => ({ width: 300, height: 150, style: {}, getContext: () => CTX });

const store = {};
const sandbox = {
  console, Math, Date, JSON, performance: { now: () => Date.now() },
  devicePixelRatio: 1, innerWidth: 720, innerHeight: 1180,
  requestAnimationFrame: () => 0, setTimeout: () => 0,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
  document: { getElementById: () => mkCanvas(), createElement: () => mkCanvas(), addEventListener: noop },
  AudioContext: function () {
    const p = () => ({ value: 0, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop });
    return {
      currentTime: 0, sampleRate: 44100, destination: {}, state: 'running',
      createGain: () => ({ gain: p(), connect: noop }),
      createBuffer: (c, len) => ({ getChannelData: () => new Float32Array(len) }),
      createBufferSource: () => ({ buffer: null, start: noop, stop: noop, connect: noop }),
      createBiquadFilter: () => ({ type: '', frequency: p(), Q: p(), connect: noop }),
      createOscillator: () => ({ type: '', frequency: p(), connect: noop, start: noop, stop: noop }),
    };
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = noop;
sandbox.removeEventListener = noop;

vm.createContext(sandbox);
try { vm.runInContext(code, sandbox, { filename: 'game.js' }); }
catch (e) { console.error('RUNTIME ERROR:', e.message); console.error(e.stack.split('\n').slice(0, 4).join('\n')); process.exit(3); }

const G = sandbox.__g, place = sandbox.__place, step = sandbox.__step;
const newGame = sandbox.__newGame, revive = sandbox.__revive;
const hammer = sandbox.__hammer, reroll = sandbox.__reroll;

function run(sec) { for (let i = 0; i < sec * 60; i++) step(1 / 60); }
function clearGrid() { for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) G.grid[r][c].ci = -1; }
function unit(ci) { return { cells: [[0, 0]], bbox: { w: 1, h: 1 }, ci: ci === undefined ? 0 : ci }; }
function prep() {
  if (G.mode !== 'play') newGame();
  clearGrid();
  G.tray = [unit(1), null, null];
  G.combo = 0; G.comboLeft = 3; G.score = 0; G.state = 'idle';
}

const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra || '']);

// 1 行消除
prep();
for (let c = 0; c < 7; c++) G.grid[0][c].ci = 1;
const okRow = place(0, 0, 7); run(1);
check('放满一行会消除', okRow && G.grid[0].every(x => x.ci < 0));

// 2 列消除
prep();
for (let r = 0; r < 7; r++) G.grid[r][3].ci = 1;
place(0, 7, 3); run(1);
check('放满一列会消除', G.grid.every(row => row[3].ci < 0));

// 3 计分：连击 0 时消 1 行 = 放置 1 分 + 10 分
prep();
G.grid[7][7].ci = 1;
for (let c = 0; c < 7; c++) G.grid[0][c].ci = 1;
place(0, 0, 7); run(1);
check('首次单行得分 = 1 + 10', G.score === 11, 'score=' + G.score);

// 4 连击递增与加成
prep();
G.grid[7][7].ci = 1;
G.combo = 1;
for (let c = 0; c < 7; c++) G.grid[0][c].ci = 1;
place(0, 0, 7); run(1);
// 连击 1 时单行：10*(1*1+1) = 20，加放置 1 = 21
check('连击 1 时单行得 21', G.score === 21 && G.combo === 2, 'score=' + G.score + ' combo=' + G.combo);

// 5 一次消两行的加成
prep();
G.combo = 0; G.score = 0;
G.grid[7][7].ci = 1;
for (let c = 0; c < 7; c++) { G.grid[0][c].ci = 1; G.grid[1][c].ci = 1; }
G.tray = [{ cells: [[0,0],[0,1]], bbox: { w: 1, h: 2 }, ci: 2 }, null, null];
place(0, 0, 7); run(1);
// 两行：10*(0*2 + 2*3/2)=30，放置 2 = 32
check('一次两行得 32', G.score === 32 && G.combo === 2, 'score=' + G.score + ' combo=' + G.combo);

// 6 连击宽容三次
prep();
G.combo = 5; G.comboLeft = 3;
G.grid[7][7].ci = 1;
for (let i = 0; i < 3; i++) {
  G.tray = [unit(0), null, null];
  G.grid[5][i].ci = -1;
  place(0, 5, i); run(1);
}
const comboAfter3 = G.combo;
G.tray = [unit(0), null, null];
place(0, 5, 3); run(1);
check('3 次没消除连击还在', comboAfter3 === 5, 'combo=' + comboAfter3);
check('第 4 次没消除连击归零', G.combo === 0, 'combo=' + G.combo);

// 7 全清奖励
prep();
G.score = 0;
for (let c = 0; c < 7; c++) G.grid[0][c].ci = 1;
place(0, 0, 7); run(1);
check('清空棋盘额外 +300', G.score === 311, 'score=' + G.score);

// 8 非法/越界
prep();
G.grid[2][2].ci = 3;
check('占用格拒绝', place(0, 2, 2) === false);
G.tray = [{ cells: [[0,0],[1,0]], bbox: { w: 2, h: 1 }, ci: 0 }];
check('越界拒绝', place(0, 0, 7) === false);

// 9 锤子
prep();
G.hammers = 1;
G.grid[4][4].ci = 2;
const hOk = hammer(4, 4);
check('锤子敲掉一个格子', hOk && G.grid[4][4].ci < 0 && G.hammers === 0);

// 10 换一批
prep();
G.rerolls = 1;
const oldIds = G.tray.map(t => t && t.cells);
const rOk = reroll();
check('换一批会换掉手牌', rOk && G.rerolls === 0 && G.tray.every(t => t && t.cells));

// 11 复活清三行
prep();
G.reviveUsed = false;
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) G.grid[r][c].ci = 0;
G.mode = 'over';
const filledBefore = G.grid.flat().filter(x => x.ci >= 0).length;
revive();
const filledAfter = G.grid.flat().filter(x => x.ci >= 0).length;
check('复活清掉三行并回到游戏', G.mode === 'play' && filledAfter <= filledBefore - 24,
  'before=' + filledBefore + ' after=' + filledAfter);

// 12 放不下即结束
prep();
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) G.grid[r][c].ci = ((r + c) % 2 === 0) ? 0 : -1;
G.tray = [unit(0), { cells: [[0,0],[1,0]], bbox: { w: 2, h: 1 }, ci: 1 }, null];
place(0, 0, 1); run(1);
// 直接验证判定函数
check('放不下时游戏结束', G.mode === 'over', 'mode=' + G.mode);

// 13 渲染冒烟：所有界面状态都画一遍，抓崩溃
const render = sandbox.__render;
function smoke(name, fn) {
  try { fn(); render(); check('渲染·' + name, true); }
  catch (e) { check('渲染·' + name, false, e.message); }
}
smoke('标题页', () => { G.mode = 'title'; });
smoke('游戏中+道具条', () => { newGame(); G.combo = 4; G.comboLeft = 2; G.score = 486; });
smoke('锤子模式', () => { G.hammerMode = true; });
smoke('消除动画', () => {
  G.hammerMode = false;
  for (let c = 0; c < 7; c++) G.grid[0][c].ci = 1;
  G.grid[7][7].ci = 3;
  G.tray = [unit(2), null, null];
  place(0, 0, 7);
  for (let i = 0; i < 10; i++) { step(1 / 60); render(); }
});
smoke('结束页可复活', () => { G.mode = 'over'; G.overT = 1; G.reviveUsed = false; });
smoke('结束页已复活', () => { G.reviveUsed = true; });

// 14 放不下的手牌会被标记
newGame();
clearGrid();
G.tray[0] = { cells: [[0,0],[1,0],[2,0]], bbox: { w: 3, h: 1 }, ci: 0 };
let fitFlags = sandbox.__fit();
check('空盘时三格横条可放', fitFlags[0] === true, JSON.stringify(fitFlags));
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) G.grid[r][c].ci = ((r + c) % 2 === 0) ? 0 : -1;
fitFlags = sandbox.__fit();
check('棋盘格残留时三格横条放不下', fitFlags[0] === false, JSON.stringify(fitFlags));

// 15 吸附容错：差一格也能吸到最近的合法位
newGame();
clearGrid();
G.grid[0][1].ci = 0;
G.tray[0] = { cells: [[0,0],[1,0]], bbox: { w: 2, h: 1 }, ci: 3 };
const geo = sandbox.__geo();
const snap = sandbox.__snapTest(0, geo.BX + geo.CELL * 0.8, geo.BY);
const snapValid = snap.ok && G.grid[snap.r][snap.c].ci < 0 && G.grid[snap.r][snap.c + 1].ci < 0;
check('偏差半格仍吸附到合法位', snapValid, JSON.stringify(snap));

// 16 分数滚动到目标值
newGame();
clearGrid();
G.score = 0; G.scoreShown = 0;
G.grid[7][7].ci = 1;
for (let c = 0; c < 7; c++) G.grid[0][c].ci = 1;
G.tray = [unit(2), null, null];
place(0, 0, 7);
run(2);
check('分数滚动追上实际分', Math.abs(G.scoreShown - G.score) < 0.01, 'shown=' + G.scoreShown + ' real=' + G.score);

let fail = 0;
for (const [n, ok, extra] of results) { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  (' + extra + ')' : '')); }
console.log(fail ? `\n${fail} 项失败` : '\n全部通过 ' + results.length + ' 项');
process.exit(fail ? 1 : 0);
