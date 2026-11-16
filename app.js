// IC-705 Bluetooth コントローラー（2026-11-15 に「周波数読み取り」から名前を変えた）
// Web Bluetooth（BLE）で IC-705 につなぎ、CI-V で周波数・RIT/ΔTX・CW・送信パワー・モード・フィルター・受信・バンドを操作する。
// つなぐ手順は SatHunter（brills）と K7MDL2 の IC-705-BLE-Serial-Example を参考にした（実機で動作を確認済み）。
'use strict';

const SERVICE_UUID = '14cf8001-1ec2-d408-1b04-2eb270f14203';
const CHAR_UUID    = '14cf8002-1ec2-d408-1b04-2eb270f14203';
const RADIO_ADDR = 0xA4;   // IC-705 の CI-V アドレス（初期値）
const CTRL_ADDR  = 0xE0;   // こちら（コントローラー）のアドレス
const POLL_MS = 250;       // 読む間隔（周波数は毎回、ほかは 1 つずつ順に。本体で変えたときの連動を速くするため 0.5 秒から縮めた）
const APP_NAME = 'IC705 BT Reader';  // 無線機の一覧に出る名前（16 文字にそろえて送る）。
// ページの名前を変えてもこれは変えない（無線機は UUID と名前の組で機器を見分けるので、変えるとペアリングし直しになる）

const $ = (id) => document.getElementById(id);
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 調べるときだけ、すべてのやり取りを開発者ツールのコンソールに出す（アドレスの最後に ?debug を付けて開く）。
// 「すべてのやり取り」の表示はやめた（2026-11-15 ユーザーの希望）。ふだんは 0.25 秒ごとの記録の文字も作らない（2026-11-15 見直し。電池のため）
const DEBUG = /[?&]debug\b/.test(location.search);
// やり取りの記録の欄（バンドの記憶・モールス文）は、公開ページでは出さない（2026-11-15 ユーザーの希望）。
// このパソコンで試すとき（localhost）と ?debug のときだけ出す
const SHOW_LOG = DEBUG || ['localhost', '127.0.0.1'].includes(location.hostname);
if (SHOW_LOG) $('logBox').hidden = false;
function log(msg) {
  if (DEBUG) console.debug(msg);
}
// バンドの記憶だけの記録（2026-11-15）。いつもの記録は読み出しですぐ流れて消えるので、バンドの記憶の読み書きと
// バンドボタンで移った先・その理由だけを別に残す（古い順。つなぐたびに消す）。APP_VER は、古い版が開かれていないか見分けるため。
const APP_VER = '2026-11-17-21'; // 変えたら sw.js の CACHE も同じ名前に変える
function blog(msg) {
  log(msg);
  const el = $('bandLog');
  el.textContent = (el.textContent + `${new Date().toLocaleTimeString()} ${msg}\n`).slice(-6000);
}
const fmtMHz = (hz) => (hz / 1e6).toFixed(6);
// CW の文章の記録（2026-11-15 実機で単語が時々抜けたので、単語ごとの返事と時刻を残す。つなぐたびに消す）
function clog(msg) {
  log(msg);
  const d = new Date(), el = $('cwLog');
  const ts = d.toLocaleTimeString() + '.' + String(d.getMilliseconds()).padStart(3, '0');
  el.textContent = (el.textContent + `${ts} ${msg}\n`).slice(-8000);
}
let lastStatus = ['stHello'];   // 言語を切り替えたときに出し直すため、キーで覚える
function status(key, vars) { lastStatus = [key, vars]; $('status').textContent = t(key, vars); }

// この端末を無線機に見分けてもらうための番号（UUID の文字列 36 文字）。
// 秘密ではないが、毎回変わると無線機に別の機器として登録されるので、端末の中に覚えておく。
function clientId() {
  let id = null;
  try { id = localStorage.getItem('ic705bt.clientId'); } catch (e) { /* 保存できなくても動く */ }
  if (!id || id.length !== 36) {
    id = (crypto.randomUUID ? crypto.randomUUID() : '56a56730-e8bc-4900-81b6-ef33e973842b').toUpperCase();
    try { localStorage.setItem('ic705bt.clientId', id); } catch (e) { /* 無視 */ }
  }
  return id;
}

const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0) & 0x7f);

// ---- 周波数（BCD 5 バイト、下の桁から）を Hz に ----
function bcdToHz(bytes) {
  let hz = 0, scale = 1;
  for (const b of bytes) {
    hz += (b & 0x0f) * scale; scale *= 10;
    hz += (b >> 4) * scale;   scale *= 10;
  }
  return hz;
}
function hzToBcd(hz) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const lo = hz % 10; hz = Math.floor(hz / 10);
    const hi = hz % 10; hz = Math.floor(hz / 10);
    out.push((hi << 4) | lo);
  }
  return out;
}
function showFreq(hz) {
  const s = String(hz).padStart(7, '0');
  const mhz = s.slice(0, -6), khz = s.slice(-6, -3), h = s.slice(-3);
  $('freq').textContent = `${mhz}.${khz}.${h}`;
}

// ---- 届いたバイトを FE … FD のかたまりに分ける ----
class FrameParser {
  constructor(onFrame) { this.buf = []; this.onFrame = onFrame; }
  push(bytes) {
    for (const b of bytes) {
      this.buf.push(b);
      if (b === 0xFD) {
        const i = this.buf.indexOf(0xFE);
        if (i >= 0) this.onFrame(this.buf.slice(i));
        this.buf = [];
      }
      if (this.buf.length > 256) this.buf = [];
    }
  }
}

// ---- 本物の IC-705（Web Bluetooth） ----
class BleLink {
  async open(onBytes, onClose) {
    if (!navigator.bluetooth) {
      throw new Error(t('errNoBt'));
    }
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }, { name: 'ICOM BT(IC-705)' }],
      optionalServices: [SERVICE_UUID],
    });
    this.device.addEventListener('gattserverdisconnected', onClose);
    log(t('lgDevice', { name: this.device.name || t('lgNoName') }));
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.ch = await service.getCharacteristic(CHAR_UUID);
    this.ch.addEventListener('characteristicvaluechanged', (ev) => {
      onBytes(new Uint8Array(ev.target.value.buffer, ev.target.value.byteOffset, ev.target.value.byteLength));
    });
    await this.ch.startNotifications();
    const p = this.ch.properties;
    log(t('lgProps', { p: `write=${p.write} writeWithoutResponse=${p.writeWithoutResponse} notify=${p.notify} indicate=${p.indicate}` }));
    // 送り方の候補。K7MDL2 の例（ESP32）は「返事なしの書き込み」を使っている。
    // 長いデータを一度に送れないことがあるので、20 バイトずつに分ける方法も用意する。
    this.modes = [];
    if (p.writeWithoutResponse) this.modes.push({ resp: false, chunk: 0 }, { resp: false, chunk: 20 });
    if (p.write) this.modes.push({ resp: true, chunk: 0 }, { resp: true, chunk: 20 });
    if (!this.modes.length) this.modes.push({ resp: true, chunk: 0 }, { resp: true, chunk: 20 });
    this.mode = 0;
  }
  async writeWith(m, data) {
    const parts = [];
    if (m.chunk) for (let i = 0; i < data.length; i += m.chunk) parts.push(data.slice(i, i + m.chunk));
    else parts.push(data);
    for (const part of parts) {
      if (m.resp) await this.ch.writeValueWithResponse(part);
      else await this.ch.writeValueWithoutResponse(part);
      if (parts.length > 1) await sleep(20);
    }
  }
  async write(bytes) {
    const data = new Uint8Array(bytes);
    // うまく送れた方法を覚えて使い続ける。失敗したら次の方法を試す。
    while (this.mode < this.modes.length) {
      const m = this.modes[this.mode];
      try {
        await this.writeWith(m, data);
        if (!this.reported) { this.reported = true; log(t('lgWriteOk', { how: `${t(m.resp ? 'lgResp' : 'lgNoResp')}, ${t(m.chunk ? 'lgChunk' : 'lgWhole')}` })); }
        return;
      } catch (e) {
        log(t('lgWriteNg', { how: `${t(m.resp ? 'lgResp' : 'lgNoResp')}, ${t(m.chunk ? 'lgChunk' : 'lgWhole')}`, msg: e.message }));
        if (!this.device.gatt.connected) throw e;
        this.mode++;
        await sleep(50);
      }
    }
    throw new Error(t('errNoWrite'));
  }
  close() { try { this.device && this.device.gatt.connected && this.device.gatt.disconnect(); } catch (e) { /* 無視 */ } }
}

// ---- デモ用の偽の IC-705（本物が無くても画面を試せる） ----
class DemoLink {
  async open(onBytes, onClose) {
    this.onBytes = onBytes; this.onClose = onClose; this.hz = 7_015_000;
    this.lock = 0; this.ts = 0x01; this.off = [0x50, 0x01, 0x00]; this.rit = 0; this.dtx = 0; this.wpm = [0x01, 0x28]; this.pwr = [0x02, 0x55]; this.bk = 0x01; this.key = 0x02; this.src = 0x00; this.maxBat = 0x03; this.maxDc = 0x03; this.mode = 0x03; this.fil = 0x01; this.widths = { 1: 0x16, 2: 0x09, 3: 0x04 }; this.pbt1 = [0x01, 0x28]; this.pbt2 = [0x01, 0x28]; this.stack = { 0x03: [[7_010_000, 0x03, 0x01], [7_002_050, 0x03, 0x01], [7_002_000, 0x03, 0x01]], 0x05: [[14_048_400, 0x03, 0x01], [14_200_000, 0x01, 0x01], [14_074_000, 0x01, 0x01]], 0x10: [[50_141_000, 0x01, 0x01], [50_313_000, 0x01, 0x02], [51_000_000, 0x05, 0x01]] }; this.f16 = { 0x02: 1, 0x22: 0, 0x40: 0, 0x41: 0, 0x48: 0 };
    log(t('lgDemo'));
  }
  async write(bytes) {
    const reply = (arr) => setTimeout(() => this.onBytes(new Uint8Array(arr)), 30);
    if (bytes[0] === 0xFE && bytes[1] === 0xF1) {
      const cmd = bytes[3];
      if (cmd === 0x62) reply([0xFE, 0xF1, 0x00, 0x62, 0xFD]);
      if (cmd === 0x63) { reply([0xFE, 0xF1, 0x00, 0x63, 0x01, 0xFD]); reply([0xFE, 0xF1, 0x00, 0x64, 0xFD]); }
    } else if (bytes[4] === 0x03) {
      reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x03, ...hzToBcd(this.hz), 0xFD]);
    } else if (bytes[4] === 0x05) {
      this.hz = bcdToHz(bytes.slice(5, 10));
      reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]);
    } else if (bytes[4] === 0x10) {
      if (bytes.length > 6) { this.ts = bytes[5]; reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]); }
      else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x10, this.ts, 0xFD]);
    } else if (bytes[4] === 0x21) {
      const sub = bytes[5], set = bytes.length > 7, ok = () => reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]);
      if (sub === 0x00) { if (set) { this.off = bytes.slice(6, 9); ok(); } else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x21, 0x00, ...this.off, 0xFD]); }
      if (sub === 0x01) { if (set) { this.rit = bytes[6]; ok(); } else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x21, 0x01, this.rit, 0xFD]); }
      if (sub === 0x02) { if (set) { this.dtx = bytes[6]; ok(); } else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x21, 0x02, this.dtx, 0xFD]); }
    } else if (bytes[4] === 0x14 && [0x0C, 0x0A, 0x07, 0x08].includes(bytes[5])) {
      const k = { 0x0C: 'wpm', 0x0A: 'pwr', 0x07: 'pbt1', 0x08: 'pbt2' }[bytes[5]];
      if (bytes.length > 7) { this[k] = bytes.slice(6, 8); reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]); }
      else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x14, bytes[5], ...this[k], 0xFD]);
    } else if (bytes[4] === 0x1A && bytes[5] === 0x05 && bytes[6] === 0x02 && bytes[7] === 0x55) {
      if (bytes.length > 9) { this.key = bytes[8]; reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]); }
      else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x1A, 0x05, 0x02, 0x55, this.key, 0xFD]);
    } else if (bytes[4] === 0x1A && bytes[5] === 0x0B) {
      reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x1A, 0x0B, this.src, 0xFD]);
    } else if (bytes[4] === 0x1A && bytes[5] === 0x05 && bytes[6] === 0x00 && (bytes[7] === 0x36 || bytes[7] === 0x37)) {
      const k = bytes[7] === 0x36 ? 'maxBat' : 'maxDc';
      if (bytes.length > 9) { this[k] = bytes[8]; reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]); }
      else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x1A, 0x05, 0x00, bytes[7], this[k], 0xFD]);
    } else if (bytes[4] === 0x16 && bytes[5] in this.f16) {
      if (bytes.length > 7) { this.f16[bytes[5]] = bytes[6]; reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]); }
      else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x16, bytes[5], this.f16[bytes[5]], 0xFD]);
    } else if (bytes[4] === 0x16 && bytes[5] === 0x47) {
      if (bytes.length > 7) { this.bk = bytes[6]; reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]); }
      else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x16, 0x47, this.bk, 0xFD]);
    } else if (bytes[4] === 0x1A && bytes[5] === 0x01 && bytes.length > 9) {   // 書き込み
      if (this.stack[bytes[6]]) this.stack[bytes[6]][bytes[7] - 1] = [bcdToHz(bytes.slice(8, 13)), bytes[13], bytes[14]];
      reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]);
    } else if (bytes[4] === 0x1A && bytes[5] === 0x01) {
      const st = this.stack[bytes[6]] && this.stack[bytes[6]][bytes[7] - 1];
      if (!st) reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFA, 0xFD]);
      else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x1A, 0x01, bytes[6], bytes[7], ...hzToBcd(st[0]), st[1], st[2], 0x00, 0x00, 0x00, 0xFD]);
    } else if (bytes[4] === 0x26) {
      this.mode = bytes[6]; this.fil = bytes[8]; reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]);
    } else if (bytes[4] === 0x04) {
      reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x04, this.mode, this.fil, 0xFD]);
    } else if (bytes[4] === 0x06) {
      this.mode = bytes[5]; this.fil = bytes.length > 7 ? bytes[6] : 0x01; reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]);
    } else if (bytes[4] === 0x1A && bytes[5] === 0x03) {
      if (bytes.length > 7) { this.widths[this.fil] = bytes[6]; this.pbt1 = [0x01, 0x28]; this.pbt2 = [0x01, 0x28]; reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]); }
      else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x1A, 0x03, this.widths[this.fil], 0xFD]);
    } else if (bytes[4] === 0x17) {   // CW の文章（デモは受け付けるだけ）
      reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, this.mode === 0x03 || this.mode === 0x07 ? 0xFB : 0xFA, 0xFD]);
    } else if (bytes[4] === 0x16 && bytes[5] === 0x50) {
      if (bytes.length > 7) { this.lock = bytes[6]; reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0xFB, 0xFD]); }
      else reply([0xFE, 0xFE, CTRL_ADDR, RADIO_ADDR, 0x16, 0x50, this.lock || 0, 0xFD]);
    }
  }
  close() { setTimeout(() => this.onClose(), 0); }
}

// ---- つなぐ・読む ----
let link = null, pollTimer = null, granted = false, lastReply = 0;
let curHz = 0;              // 今の周波数（分かっている最新）
let locked = false;         // ダイヤルロック
let step = 0;               // つまみの ステップ（Hz）。0 = まだ決めていない
let stepFreq = 0;           // ステップを決めたとき（このページが最後に合わせたとき）の周波数
let pendingHz = 0;          // つまみで回したが、まだ送っていない周波数
let quietUntil = 0;         // この時刻までは周波数を読まない（回した直後に表示が戻らないように）
let pollCount = 0;
let radioTs = null;         // 本体の TS（チューニングステップ、Hz）。0 = OFF（1 Hz）。null = まだ分からない
let tsOnCode = 0x01;        // TS を ON にしたときの幅（本体から読んだ最後の値。初めは 100 Hz）
// 本体の TS の値（CI-V 10 の 00〜13）→ Hz
const TS_TABLE = [0, 100, 500, 1000, 5000, 6250, 8330, 9000, 10000, 12500, 20000, 25000, 50000, 100000];

// 返事を待っているもの（sendWait が使う）
const waiters = [];
// 読む命令を送り、その返事（同じ命令・番号で始まるもの。「できません」FA でもよい）が届くまで待つ（2026-11-15 ユーザーの希望）。
// まとめ読みで、帯が消えたときには全部の値がそろっているようにするため。返事が無くても、送り終えてから ms（1 秒）で次へ進む（止まらないように）。
// 返事が送り終える前に届くこともあるので、待つ準備は送る前にする。
// match を渡すと、その条件に合う返事を待つ（書き込みの返事 FB を待つときなど）。
async function sendWait(bytes, note, ms = 1000, match = null) {
  const body = bytes.slice(4, -1);
  let w;
  const got = new Promise((resolve) => {
    w = { match: match || ((f) => f[4] === 0xFA || body.every((b, i) => f[4 + i] === b)), resolve, timer: null };
    waiters.push(w);
  });
  try { await send(bytes, note); } catch (e) { log(t('lgSendFail', { msg: e.message })); }
  if (waiters.includes(w)) w.timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); w.resolve(null); }, ms);
  return got;
}
const parser = new FrameParser((f) => {
  if (DEBUG) log(t('lgRx', { hex: hex(f) }));
  if (f[1] === 0xF1) {                       // つなぐときの合図の返事
    if (f[3] === 0x63) log(t(f[4] === 0x01 ? 'lgPaired' : 'lgKnown'));
    if (f[3] === 0x64) { granted = true; log(t('lgGranted')); }
    return;
  }
  if (f[1] !== 0xFE || f[3] !== RADIO_ADDR) return;
  for (const w of waiters.slice()) if (w.match(f)) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(f); }
  const cmd = f[4];
  // 周波数: 0x03（読んだ返事）か 0x00（ダイヤルを回したときに無線機から届く知らせ）
  if ((cmd === 0x03 || cmd === 0x00) && f.length >= 11) {
    lastReply = Date.now();
    if (Date.now() < quietUntil || pendingHz) return;   // こちらで回している最中は上書きしない
    curHz = bcdToHz(f.slice(5, 10));
    if (vuBand() !== lastVu) { lastVu = vuBand(); showRx(); }   // 144/430 MHz 帯に入った・出たらプリアンプのボタンを直す
    showFreq(curHz);
    showBand();
    rememberBand();
    const bc = curBand() ? curBand().code : 0;
    if (bc !== lastBandCode) {
      const first = !lastBandCode, prev = lastBandCode; lastBandCode = bc;
      if (!first) { radioBandChanged(prev, bc); readRx('band'); }
    }
    if (!step) {   // つないだときに ステップを選ぶ（本体の TS が分かっていればそれに合わせる）
      setStep(radioTs || 1);
      stepFreq = curHz;
    }
  } else if (cmd === 0x10 && f.length >= 7) {
    const code = (f[5] >> 4) * 10 + (f[5] & 0x0f);
    const ts = TS_TABLE[code];
    if (code) tsOnCode = code;
    if (ts !== undefined && ts !== radioTs) { radioTs = ts; followRadioTs(); }
  } else if (cmd === 0x21 && f[5] === 0x00 && f.length >= 10) {
    onRadioOffset(bytesToOffset(f.slice(6, 9)));
  } else if (cmd === 0x21 && f[5] === 0x01 && f.length >= 8) {
    onRadioRit(f[6] === 0x01);
  } else if (cmd === 0x21 && f[5] === 0x02 && f.length >= 8) {
    onRadioDtx(f[6] === 0x01);
  } else if (cmd === 0x14 && f[5] === 0x0C && f.length >= 9) {
    onRadioCw('wpm', rawToWpm(bcd2ToNum(f.slice(6, 8))));
  } else if (cmd === 0x14 && f[5] === 0x0A && f.length >= 9) {
    onRadioCw('pct', rawToPct(bcd2ToNum(f.slice(6, 8))));
  } else if (cmd === 0x1A && f[5] === 0x05 && f[6] === 0x02 && f[7] === 0x55 && f.length >= 10) {
    onRadioCw('key', f[8]);
  } else if (cmd === 0x1A && f[5] === 0x0B && f.length >= 8) {
    power.src = f[6]; showPower();
  } else if (cmd === 0x1A && f[5] === 0x05 && f[6] === 0x00 && (f[7] === 0x36 || f[7] === 0x37) && f.length >= 10) {
    onRadioMax(f[7] === 0x36 ? 'bat' : 'dc', f[8]);
  } else if ((cmd === 0x04 || cmd === 0x01) && f.length >= 7) {
    onRadioMode(f[5], f.length >= 8 ? f[6] : null);
  } else if (cmd === 0x1A && f[5] === 0x03 && f.length >= 8) {
    onRadioWidth(bcd1ToNum(f[6]));
  } else if (cmd === 0x16 && RX_KEY[f[5]] && f.length >= 8) {
    onRadioRx(RX_KEY[f[5]], f[6]);
  } else if (cmd === 0x16 && f[5] === 0x47 && f.length >= 8) {
    onRadioCw('bk', f[6]);
  } else if (cmd === 0x16 && f[5] === 0x50 && f.length >= 8) {
    setLocked(f[6] === 0x01);
  } else if (cmd === 0xFA) {
    log(t('lgNg'));
  }
});

// ---- 本体から読み取り中（2026-11-15 ユーザーの希望） ----
// つないだ直後・バンドやモードを変えた直後のまとめ読みの間は、周波数の下に「本体から読み取り中…」の帯を出し、
// 操作（つまみ・ボタン）を止め、いつもの読み出し（poll）も止める（まとめ読みを早く終わらせるため）。
// total が分かっているとき（つないだ直後）は「8／15」のように進み具合も出す。
const load = { depth: 0, done: 0, total: null };
function showLoading() {
  const on = load.depth > 0 && !!link;
  document.body.classList.toggle('loading', on);
  $('loading').hidden = !on;
  if (!on) return;
  const n = load.total ? Math.min(load.done, load.total) : null;
  $('loadingText').textContent = n != null ? t('loadingN', { n, total: load.total }) : t('loading');
  $('loadingBar').style.width = n != null ? `${Math.round((n / load.total) * 100)}%` : '100%';
  $('loadingBar').classList.toggle('busy', n == null);
}
async function withLoading(total, fn) {
  if (++load.depth === 1) { load.done = 0; load.total = total; }
  showLoading();
  try { return await fn(); }
  finally { if (--load.depth === 0) load.total = null; showLoading(); }
}

// 送るのは 1 つずつ順番に（Bluetooth は同時に 2 つ書けないため）
let sendChain = Promise.resolve();
function send(bytes, note) {
  const job = sendChain.then(async () => {
    if (!link) return;
    if (DEBUG) log(t('lgTx', { hex: hex(bytes) }) + (note ? '  ' + note : ''));
    await link.write(bytes);
    if (load.depth) { load.done++; showLoading(); }
  });
  sendChain = job.catch(() => {});
  return job;
}
const civ = (...body) => [0xFE, 0xFE, RADIO_ADDR, CTRL_ADDR, ...body, 0xFD];

async function handshake() {
  const name = APP_NAME.padEnd(16, ' ').slice(0, 16);
  await send([0xFE, 0xF1, 0x00, 0x61, ...ascii(clientId()), 0xFD], t('nId'));
  await sleep(50);
  await send([0xFE, 0xF1, 0x00, 0x62, ...ascii(name), 0xFD], t('nName'));
  await sleep(50);
  await send([0xFE, 0xF1, 0x00, 0x63, 0xEE, 0x39, 0x09, 0x10, 0xFD], t('nToken'));
  for (let i = 0; i < 30 && !granted; i++) await sleep(100);   // 最大 3 秒、許可の返事を待つ
  if (!granted) log(t('lgNoGrant'));
}

// 前の回の読み出しが終わっていなければ、その回は飛ばす（2026-11-15 ユーザー報告「初めて OFF/RIT/ΔTX・キーの種類・帯域幅を
// さわると、勝手に戻ることがある」の対策）。前は 0.25 秒ごとに待たずに 4 つずつ積んでいたので、Bluetooth の書き込みが遅いと
// 送る列がどんどん長くなり、ボタンで送った命令が古い読み出しの後ろに並んで、その古い返事で表示が戻っていた。
let pollBusy = false;
async function poll() {
  // CW の文章を送っている間は読まない（2026-11-15 実機で単語が時々抜けた。やり取りを減らして本体のじゃまをしないため）
  if (!link || Date.now() < quietUntil || pendingHz || pollBusy || load.depth || cwBusy) return;
  pollBusy = true;
  pollCount++;
  try {
    // 表示していない項目は読まない（2026-11-15 ユーザーの希望で項目を隠せるようにした。やり取りも減る）
    // くるくる回して合わせるもの（周波数・ずらす量）は毎回（0.25 秒ごと）読む（ユーザーの希望）
    await send(civ(0x03));
    if (shown('secDtx')) await send(civ(0x21, 0x00));
    const { turn, slow } = pollLists();
    if (turn.length) await send(turn[pollCount % turn.length]);
    await send(slow[pollCount % slow.length]);
  } catch (e) { log(t('lgSendFail', { msg: e.message })); }
  finally { pollBusy = false; }
}

// 0.25 秒ごとに順に読むものの組（turn: 回して合わせるもの、slow: 押して切り替えるもの・めったに変わらないもの）
function pollLists() {
  // 3 つ目: 回して合わせるもの（CW スピード・送信パワー・帯域幅）を順に
  // 帯域幅は、幅を変えられないモード（FM など）やモードがまだ分からないときは読まない
  const turn = [];
  if (shown('secCw')) turn.push(civ(0x14, 0x0C));
  if (shown('secPwr')) turn.push(civ(0x14, 0x0A));
  if (shown('secFil') && widthMax(fil.mode) != null) turn.push(civ(0x1A, 0x03));
  // モードもこちらの組で読む（本体でモードを変えたときに早く気づき、NOTCH を合わせるため。2026-11-15）
  if (shown('secFil') || shown('secRx')) turn.push(civ(0x04));
  // 4 つ目: 押して切り替えるもの・めったに変わらないものを順に（全部表示で 15 個、それぞれ 3.75 秒ごと）
  const slow = [civ(0x16, 0x50), civ(0x10)];
  if (shown('secDtx')) slow.push(civ(0x21, 0x02), civ(0x21, 0x01));
  if (shown('secCw')) slow.push(civ(0x16, 0x47), civ(0x1A, 0x05, 0x02, 0x55));
  if (shown('secPwr')) slow.push(civ(0x1A, 0x0B), civ(0x1A, 0x05, 0x00, 0x36), civ(0x1A, 0x05, 0x00, 0x37));
  if (shown('secRx')) slow.push(civ(0x16, 0x02), civ(0x16, 0x22), civ(0x16, 0x40), civ(0x16, 0x41), civ(0x16, 0x48));
  return { turn, slow };
}
// つないだ直後に一度ずつ全部読む（2026-11-15。順に読むだけだと全部そろうまで 4 秒以上かかり、その間ボタンが効かなかった）
async function readAllOnce() {
  const { turn, slow } = pollLists();
  // モード（04）と受信の 4 つを先に読む（遅いと言われたので。2026-11-15）
  const first = (c) => c[4] === 0x04 || (c[4] === 0x16 && RX_KEY[c[5]]);
  const all = [...slow, ...turn];
  const head = all.filter(first).sort((x, y) => (y[4] === 0x04) - (x[4] === 0x04)), rest = all.filter((c) => !first(c));
  await withLoading(head.length + rest.length, async () => {
    for (const c of head) { if (!link) return; await sendWait(c); }
    await retryRx();                        // 受信で返事が来なかったものは、ここですぐ読み直す
    for (const c of rest) { if (!link) return; await sendWait(c); }
    // 全バンドの記憶の取り込み（preloadBands）は、つないだ直後にはしない: 実機では記憶 1 つを読むのに約 1 秒かかり、
    // 12 バンド × 3 つで 35 秒以上待つことになった（2026-11-15 ユーザーの記録）。バンドボタンを押したときに、そのバンドだけ読む。
  });
}
// 受信の 4 つ（P.AMP・NB・NR・ノッチ）を読み直す。バンドやモードが変わったとき（本体はバンドごとに設定を持つことがあるため）
// what = 'band': バンドが変わった → 5 つとも「分からない」に戻して、P.AMP から順に読む
// what = 'mode': モードが変わった → ノッチ（AN・MN）だけ読み直す。P.AMP・NB・NR は前の値のまま（2026-11-15 ユーザーと相談）
const RX_ALL = ['pamp', 'nb', 'nr', 'an', 'mn'];
// 今のモードで読む意味があるか（CW はオートノッチが無い、FM などはノッチ自体が無いので読まない。モードが分からないときは読む）
function rxNeeded(k) {
  if ((k === 'an' || k === 'mn') && fil.mode != null) {
    if (!notchOk()) return false;
    if (k === 'an' && !autoNotchOk()) return false;
  }
  return true;
}
async function readRx(what) {
  if (!link || !shown('secRx')) return;
  const keys = what === 'mode' ? ['an', 'mn'] : RX_ALL;
  for (const k of keys) rx[k] = null;   // 分かるまでボタンを押せなくする（古い値から次を計算しないように）
  showRx();
  await withLoading(null, async () => {
    for (const k of keys.filter(rxNeeded)) { if (!link) return; await sendWait(civ(0x16, RX_SUB[k])); }
    await retryRx(keys);
  });
}
// 受信でまだ分からないもの（返事が来なかったもの）を、2 回まで読み直す。今のモードで使えないもの（CW の AN など）は待たない
async function retryRx(keys = RX_ALL) {
  if (!shown('secRx')) return;
  for (let n = 0; n < 2; n++) {
    const miss = keys.filter((k) => rx[k] == null && rxNeeded(k));
    if (!miss.length || !link) return;
    log(t('lgRxRetry', { v: miss.join(', ') }));
    for (const k of miss) { if (!link) return; await sendWait(civ(0x16, RX_SUB[k])); }
  }
}

async function connect(kind) {
  if (link) return;
  granted = false; lastReply = 0; pollBusy = false; load.depth = 0; curHz = 0; step = 0; pendingHz = 0; pollCount = 0; radioTs = null; dtxOn = null; ritOn = null; cw.wpm = cw.pct = cw.bk = cw.key = null; resetPower(); fil.mode = fil.fil = fil.idx = null; resetRx(); bandMem = {}; stacks = {}; inUse = {}; lastBandCode = 0;
  // 前の回の後片付け（受け取り途中のかけらと、返事を待っている印。2026-11-15 見直し）
  parser.buf = [];
  for (const w of waiters.splice(0)) { clearTimeout(w.timer); w.resolve(null); }
  link = kind === 'demo' ? new DemoLink() : new BleLink();
  $('bandLog').textContent = ''; $('cwLog').textContent = '';
  blog(t('blVer', { v: APP_VER }));
  clog(t('blVer', { v: APP_VER }));
  setButtons(true);
  try {
    status('stConnecting');
    await link.open((b) => parser.push(b), onClosed);
    status('stHandshake');
    await handshake();
    if (shown('secDtx')) await startDtx();   // つないだら ΔTX を ON（ずらす量は 0 Hz から）。隠しているときは本体の RIT・ΔTX にさわらない
    await readAllOnce();
    await readCurStacks();                  // 今いるバンドの記憶 3 つだけ読んで、すぐ出す（約 3 秒）
    status('stConnected');
    const startedAt = Date.now();
    pollTimer = setInterval(() => {
      poll();
      if (!lastReply && Date.now() - startedAt > 5000) {
        status('stNoReply');
      }
    }, POLL_MS);
    poll();
  } catch (e) {
    if (e && e.name === 'NotFoundError') status('stNotChosen');
    else status('stFailed', { msg: e.message });
    log($('status').textContent);
    disconnect();
  }
}

function onClosed() {
  clearInterval(pollTimer); pollTimer = null;
  link = null;
  setButtons(false);
  status('stClosed');
  log(t('lgClosed'));
}
function disconnect() {
  if (!link) { setButtons(false); return; }
  const l = link, stopCw = cwBusy;
  clearInterval(pollTimer); pollTimer = null;
  link = null;
  setButtons(false);
  if (!stopCw) { l.close(); return; }
  // モールス文を送っている途中なら、先に本体へ「止めて」（17 FF）を送ってから切る（2026-11-15 見直し。
  // 送らずに切ると、本体はためた分を送り終わるまで電波を出し続ける）。前の書き込みが終わるのを待ち、0.8 秒で切る
  clog(t('cwStopped'));
  const stop = sendChain.then(() => l.write(civ(0x17, 0xFF)));
  Promise.race([stop, sleep(800)]).catch(() => {}).finally(() => l.close());
}
function setButtons(connected) {
  $('connect').disabled = connected;
  $('demo').disabled = connected;
  $('disconnect').disabled = !connected;
  updateControls();
}

// ---- ステップ（本体の TS と連動。ユーザーの説明による本体の動き） ----
// 本体の周波数の表示を押すと 1 kHz の桁の上に ▼ が出て TS が ON（このユーザーの設定では 100 Hz）、
// もう一度押すと ▼ が消えて TS が OFF（1 Hz）。ページも同じ 2 つの状態にする。
const fmtStep = (s) => (s >= 1000 ? `${s / 1000} kHz` : `${s} Hz`);
function setStep(s) {
  step = s;
  const tsBtn = $('stepTs');
  tsBtn.textContent = `${fmtStep(TS_TABLE[tsOnCode])}（▼）`;
  tsBtn.classList.toggle('on', s > 1);
  $('stepFine').classList.toggle('on', s === 1);
}
// 本体の TS が変わったら、ページの ステップを合わせる
function followRadioTs() {
  log(t('lgTs', { v: radioTs ? t('lgTsOn', { v: fmtStep(radioTs) }) : t('lgTsOff') }));
  setStep(radioTs || 1);
  stepFreq = curHz;
}
// ページのボタン → 本体の TS（1 Hz は OFF = 00、▼ のボタンは本体で最後に使っていた幅）
async function sendTs(code) {
  radioTs = TS_TABLE[code];
  try {
    await send(civ(0x10, code), t('nTs', { v: code ? fmtStep(TS_TABLE[code]) : 'OFF' }));
    setTimeout(() => send(civ(0x10)), 300);   // 本当に変わったか読み直す
  } catch (e) { log(t('lgSendFail', { msg: e.message })); }
}
document.querySelectorAll('#steps button').forEach((b) => {
  b.addEventListener('click', () => {
    if (!link || locked || !curHz) return;
    const code = b.id === 'stepTs' ? tsOnCode : 0x00;
    const s = TS_TABLE[code] || 1;
    setStep(s);
    sendTs(code);
    // 押した単位で四捨五入して送る（例: 7.006.880 で 1 kHz → 7.007.000）
    const r = Math.round(curHz / s) * s;
    stepFreq = r;
    if (r !== curHz) tuneTo(r, true);
  });
});

// ---- 周波数を変える ----
let flushTimer = null;
function tuneTo(hz, now) {
  hz = Math.max(30000, Math.min(470000000, hz));
  curHz = hz; pendingHz = hz; stepFreq = hz;
  showFreq(hz);
  showBand();
  rememberBand();
  quietUntil = Date.now() + 800;
  if (now) flush();
  else if (!flushTimer) flushTimer = setTimeout(flush, 60);   // 送りすぎないよう 60 ms ごとにまとめる
}
async function flush() {
  clearTimeout(flushTimer); flushTimer = null;
  if (!pendingHz || !link) { pendingHz = 0; return; }
  const hz = pendingHz;
  pendingHz = 0;
  quietUntil = Date.now() + 800;
  try { await send(civ(0x05, ...hzToBcd(hz))); } catch (e) { log(t('lgSendFail', { msg: e.message })); }
}

// ---- ロック ----
function setLocked(v) {
  if (locked === v) return;
  locked = v;
  updateControls();
}
// すべらせたときだけ切り替える（軽く押しただけ・まわりを押しただけでは変わらない。ユーザーの希望）
async function sendLock(want) {
  setLocked(want);
  try {
    await send(civ(0x16, 0x50, want ? 0x01 : 0x00), t(want ? 'nLock' : 'nUnlock'));
    setTimeout(() => send(civ(0x16, 0x50)), 300);   // 本当に変わったか読み直す
  } catch (e) { log(t('lgSendFail', { msg: e.message })); }
}
(() => {
  const track = $('lock'), thumb = track.querySelector('.thumb');
  const MIN = 3, MAX = 55;          // つまみの左端の位置（px）。style.css と合わせる
  let drag = null;
  track.addEventListener('pointerdown', (e) => {
    if (!link) return;
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
    drag = { x: e.clientX, start: locked ? MAX : MIN, pos: locked ? MAX : MIN };
    track.classList.add('dragging');
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.pos = Math.max(MIN, Math.min(MAX, drag.start + (e.clientX - drag.x)));
    thumb.style.left = drag.pos + 'px';
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    track.classList.remove('dragging');
    thumb.style.left = '';
    // 反対側の 4 分の 3 より先まですべらせたときだけ切り替える
    const goal = MIN + (MAX - MIN) * 0.75, back = MAX - (MAX - MIN) * 0.75;
    if (!locked && d.pos >= goal) sendLock(true);
    else if (locked && d.pos <= back) sendLock(false);
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
})();

function updateControls() {
  const on = !!link;
  showLoading();
  $('lockBox').classList.toggle('disabled', !on);
  $('lockBox').classList.toggle('on', on && locked);
  $('lock').setAttribute('aria-checked', String(locked));
  $('lockText').textContent = t(locked ? 'lockOn' : 'lockOff');
  document.querySelectorAll('#steps button').forEach((b) => { b.disabled = !on || locked; });
  knob.setEnabled(on && !locked);
  $('dtxSlider').disabled = !on;
  $('copy').disabled = !on;
  $('copyK').disabled = !on;
  $('wpm').disabled = !on;
  $('pwr').disabled = !on;
  document.querySelectorAll('#bk button, #keytype button').forEach((b) => { b.disabled = !on; });
  if (!on) { cwJob++; cwBusy = false; cw.wpm = cw.pct = cw.bk = cw.key = null; resetPower(); fil.mode = fil.fil = fil.idx = null; resetRx(); }
  showPower();
  showCw();
  showOffset();
  showFilter();
  showRx();
  showBand();
}

// ---- 大きなつまみ（指・マウスでつまんで回す。ホイールでも可。時計回りで上がる。10° で ステップ） ----
class Knob {
  constructor(canvas, onTurn) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.onTurn = onTurn;
    this.angle = 0; this.acc = 0; this.drag = null; this.enabled = false;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', () => this.up());
    canvas.addEventListener('pointercancel', () => this.up());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      this.onStart && this.onStart();
      this.turn(e.deltaY < 0 ? 10 : -10);
    }, { passive: false });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  setEnabled(v) { this.enabled = v; if (!v) this.drag = null; this.draw(); }
  pointAngle(e) {
    const r = this.c.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  }
  down(e) {
    if (!this.enabled) return;
    try { this.c.setPointerCapture(e.pointerId); } catch (err) { /* つかめなくても回せる */ }
    this.drag = this.pointAngle(e);
    this.onStart && this.onStart();
  }
  move(e) {
    if (this.drag === null) return;
    const a = this.pointAngle(e);
    let d = a - this.drag;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    this.drag = a;
    this.turn(d);
  }
  up() {
    if (this.drag === null) return;
    this.drag = null;
    this.onEnd && this.onEnd();
  }
  turn(deg) {
    this.angle += deg; this.acc += deg;
    const n = Math.trunc(this.acc / 10);
    if (n) { this.acc -= n * 10; this.onTurn(n); }
    this.draw();
  }
  draw() {
    const c = this.c, ctx = this.ctx;
    const size = c.clientWidth, dpr = window.devicePixelRatio || 1;
    if (!size) return;
    if (c.style.height !== size + 'px') c.style.height = size + 'px';   // いつも正方形に
    const px = Math.round(size * dpr);
    if (c.width !== px || c.height !== px) { c.width = px; c.height = px; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    const r = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = this.enabled ? 1 : 0.4;
    ctx.beginPath(); ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.fillStyle = col('--knob'); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = col('--line'); ctx.stroke();
    ctx.save(); ctx.translate(r, r); ctx.rotate(this.angle * Math.PI / 180);
    ctx.strokeStyle = col('--knob-tick'); ctx.lineWidth = 2;
    for (let i = 0; i < 36; i++) {      // まわりのギザギザ
      ctx.rotate(Math.PI / 18);
      ctx.beginPath(); ctx.moveTo(r - 4, 0); ctx.lineTo(r - 14, 0); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, -(r * 0.55), r * 0.13, 0, Math.PI * 2);   // 指を入れるくぼみ
    ctx.fillStyle = col('--knob-dimple'); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

const knob = new Knob($('knob'), (n) => {
  if (!link || locked || !curHz || !step) return;
  tuneTo(Math.round(curHz / step) * step + n * step, false);
});
knob.onStart = () => {
  if (!curHz) return;
  // 外（本体のダイヤルなど）で周波数が変わっていたら、その周波数で ステップを選び直す（FTDX10 版 v2.2.0 と同じ）
  // ステップは本体の TS に従う（周波数の下の桁では選ばない）
  if (!step) setStep(radioTs || 1);
};
knob.onEnd = () => flush();   // 手を離した瞬間に送る

// ---- RIT・ΔTX（ΔTX は 2026-11-15 順番の 2、RIT は同じ日にユーザーの希望で追加） ----
// IC-705 の RIT は受信だけ、ΔTX は送信だけを、同じ「ずらす量」だけずらす（取扱説明書 4-3・4-8）。CI-V 21 00（ずらす量）・21 01（RIT）・21 02（ΔTX）。
// ずらす量は 3 バイト: [10 Hz の桁 | 1 Hz の桁] [1 kHz の桁 | 100 Hz の桁] [符号 00=+ 01=−]、±9.999 kHz まで（Icom 共通の形）。
let offsetHz = 0;           // 本当のずらす量（スライダーの目盛りで丸めない）
let dtxOn = null;           // 本体の ΔTX（null = まだ分からない）
let ritOn = null;           // 本体の RIT（null = まだ分からない）
let offsetSentAt = 0;       // このページがずらす量・RIT・ΔTX を送った時刻（すぐ後の古い読み値で戻さないため）
let sliderBusy = false;     // スライダーを動かしている最中

function offsetToBytes(hz) {
  const a = Math.min(9999, Math.abs(Math.round(hz)));
  const d = [a % 10, Math.floor(a / 10) % 10, Math.floor(a / 100) % 10, Math.floor(a / 1000) % 10];
  return [(d[1] << 4) | d[0], (d[3] << 4) | d[2], hz < 0 ? 0x01 : 0x00];
}
function bytesToOffset(b) {
  const a = (b[0] & 0x0f) + (b[0] >> 4) * 10 + (b[1] & 0x0f) * 100 + (b[1] >> 4) * 1000;
  return b[2] === 0x01 ? -a : a;
}
const fmtOffset = (hz) => `${hz > 0 ? '+' : hz < 0 ? '−' : '±'}${Math.abs(hz)} Hz`;
// 今の状態: 'rit'・'dtx'・'off'・null（まだ分からない）
function shiftMode() {
  if (ritOn) return 'rit';
  if (dtxOn) return 'dtx';
  if (ritOn === false && dtxOn === false) return 'off';
  return null;
}

function showOffset() {
  const on = !!link;
  const m = on ? shiftMode() : null;
  $('dtxValue').textContent = fmtOffset(offsetHz);
  const st = $('dtxState');
  st.textContent = m === 'rit' ? t('ritOnState') : m === 'dtx' ? t('dtxOn') : m === 'off' ? t('shiftOffState') : '';
  st.classList.toggle('off', m === 'off');
  document.querySelectorAll('#shiftMode button').forEach((b) => {
    b.disabled = !on;
    b.classList.toggle('on', b.dataset.mode === m);
  });
  if (!sliderBusy) {
    // スライダーは ±500 Hz まで（ユーザーの希望）。本体でそれより大きくしたときは、数字だけ本当の値を出す
    $('dtxSlider').value = String(Math.max(-DTX_MAX, Math.min(DTX_MAX, offsetHz)));
  }
}
const DTX_MAX = 500;        // スライダーの端（Hz）。10 Hz ごと（2026-11-15 ユーザーの希望で ±200 → ±500）

// RIT・ΔTX・OFF を切り替える。本体と同じく RIT と ΔTX は同時に ON にしない（先に OFF にするほうを送る）
async function sendShiftMode(m, note) {
  ritOn = m === 'rit'; dtxOn = m === 'dtx'; offsetSentAt = Date.now();
  showOffset();
  try {
    if (m !== 'rit') await send(civ(0x21, 0x01, 0x00), '(RIT OFF)');
    if (m !== 'dtx') await send(civ(0x21, 0x02, 0x00), '(ΔTX OFF)');
    if (m === 'rit') await send(civ(0x21, 0x01, 0x01), note || '(RIT ON)');
    if (m === 'dtx') await send(civ(0x21, 0x02, 0x01), note || '(ΔTX ON)');
  } catch (e) { log(t('lgSendFail', { msg: e.message })); }
  offsetSentAt = Date.now();   // 送り終えた時刻から 1.5 秒は古い読み値で戻さない
}
// ずらす量だけを送る。RIT・ΔTX の切り替えはボタンだけで行い、スライダーでは切り替えない
// （2026-11-15 ユーザー報告: ΔTX のときにスライダーを動かすと、たまに RIT に切り替わった。
//   前は「両方 OFF ならスライダーで最後に使ったほうを ON」にしていて、本体から一瞬 OFF と読んだときに RIT が ON になったと思われる）
async function sendOffset(hz, note) {
  offsetHz = hz; offsetSentAt = Date.now();
  showOffset();
  try { await send(civ(0x21, 0x00, ...offsetToBytes(hz)), note || t('nOffset', { v: fmtOffset(hz) })); }
  catch (e) { log(t('lgSendFail', { msg: e.message })); }
  offsetSentAt = Date.now();
}
// つないだとき: ずらす量 0 Hz（ユーザーの希望）→ RIT OFF・ΔTX ON（前と同じ）
async function startDtx() {
  offsetHz = 0; offsetSentAt = Date.now();
  try { await send(civ(0x21, 0x00, ...offsetToBytes(0)), t('nOffset0')); } catch (e) { log(t('lgSendFail', { msg: e.message })); }
  await sendShiftMode('dtx');
}
// 本体から読んだ値に合わせる（本体のつまみで変えたら、このページが合わせる）
function onRadioOffset(hz) {
  if (sliderBusy || Date.now() - offsetSentAt < 1500 || hz === offsetHz) return;
  log(t('lgOffset', { v: fmtOffset(hz) }));
  offsetHz = hz;
  showOffset();
}
function onRadioDtx(on) {
  if (Date.now() - offsetSentAt < 1500 || on === dtxOn) return;
  dtxOn = on;
  log(t('lgDtx', { v: on ? 'ON' : 'OFF' }));
  showOffset();
}
function onRadioRit(on) {
  if (Date.now() - offsetSentAt < 1500 || on === ritOn) return;
  ritOn = on;
  log(t('lgRit', { v: on ? 'ON' : 'OFF' }));
  showOffset();
}

$('dtxSlider').addEventListener('input', () => {
  sliderBusy = true;
  $('dtxValue').textContent = fmtOffset(Number($('dtxSlider').value));
});
$('dtxSlider').addEventListener('change', () => {   // 手を離したときに送る
  sliderBusy = false;
  if (link) sendOffset(Number($('dtxSlider').value));
});
document.querySelectorAll('#shiftMode button').forEach((b) => {
  b.addEventListener('click', () => { if (link) sendShiftMode(b.dataset.mode); });
});
// ---- 周波数のコピー（ログソフトに貼るため） ----
// kilo = false: MHz（例 7.015000）、true: 1000 倍の kHz（例 7015.000。ユーザーの希望の「×1000」）
async function copyFreq(kilo) {
  if (!curHz) { status('stNoFreq'); return; }
  const text = kilo ? (curHz / 1e3).toFixed(3) : (curHz / 1e6).toFixed(6);
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (err) { /* 無視 */ }
    ta.remove();
  }
  const b = kilo ? $('copyK') : $('copy');
  b.textContent = t('copied');
  status('stCopied', { text, unit: kilo ? 'kHz' : 'MHz' });
  setTimeout(() => { b.textContent = t(kilo ? 'copyK' : 'copy'); }, 1500);
}
$('copy').addEventListener('click', () => copyFreq(false));
$('copyK').addEventListener('click', () => copyFreq(true));

// ---- CW スピード・ブレークイン・送信パワー（順番の 3） ----
// CW スピード 14 0C（0000=6 WPM 〜 0255=48 WPM）、送信パワー 14 0A（0000=最小 〜 0255=最大）、ブレークイン 16 47（00=OFF 01=SEMI 02=FULL）。
// キーの種類 1A 05 0255（00=ストレート 01=バグ 02=パドル。本体の MENU → KEYER → EDIT/SET → CW-KEY SET → Key Type と同じ）。
// 0000〜0255 は 2 バイトの BCD（例 0128 → 01 28）。
const cw = { wpm: null, pct: null, bk: null, key: null, sentAt: { wpm: 0, pct: 0, bk: 0, key: 0 }, busy: { wpm: false, pct: false } };

function numToBcd2(n) {
  n = Math.max(0, Math.min(255, Math.round(n)));
  return [Math.floor(n / 100), ((Math.floor(n / 10) % 10) << 4) | (n % 10)];
}
const bcd2ToNum = (b) => (b[0] >> 4) * 1000 + (b[0] & 0x0f) * 100 + (b[1] >> 4) * 10 + (b[1] & 0x0f);
const wpmToRaw = (w) => ((w - 6) * 255) / 42;
const rawToWpm = (v) => Math.round(6 + (v * 42) / 255);
const pctToRaw = (p) => (p * 255) / 100;
const rawToPct = (v) => Math.round((v * 100) / 255);

function showCw() {
  if (cw.wpm !== null && !cw.busy.wpm) { $('wpm').value = String(cw.wpm); $('wpmValue').textContent = `${cw.wpm} WPM`; }
  if (cw.pct !== null && !cw.busy.pct) { $('pwr').value = String(cw.pct); updatePowerBar(cw.pct); }
  document.querySelectorAll('#bk button').forEach((b) => b.classList.toggle('on', Number(b.dataset.bk) === cw.bk));
  document.querySelectorAll('#keytype button').forEach((b) => b.classList.toggle('on', Number(b.dataset.key) === cw.key));
  if (cwPresets) showCwMsg();
}
// 本体から読んだ値（本体で変えたら合わせる。送ってから 1.5 秒は古い読み値で戻さない）
function onRadioCw(key, value) {
  if (cw.busy[key] || Date.now() - cw.sentAt[key] < 1500 || cw[key] === value) return;
  cw[key] = value;
  showCw();
}
async function sendCw(key, value) {
  cw[key] = value; cw.sentAt[key] = Date.now();
  showCw();
  let bytes, note;
  if (key === 'wpm') { bytes = civ(0x14, 0x0C, ...numToBcd2(wpmToRaw(value))); note = t('nWpm', { v: value }); }
  if (key === 'pct') { bytes = civ(0x14, 0x0A, ...numToBcd2(pctToRaw(value))); note = t('nPwr', { v: value }); }
  if (key === 'key') { bytes = civ(0x1A, 0x05, 0x02, 0x55, value); note = t('nKey', { v: t('key' + value) }); }
  if (key === 'bk')  { bytes = civ(0x16, 0x47, value); note = t('nBk', { v: ['OFF', 'SEMI', 'FULL'][value] }); }
  try { await send(bytes, note); } catch (e) { log(t('lgSendFail', { msg: e.message })); }
  cw.sentAt[key] = Date.now();
}
function hookSlider(id, key, label) {
  const el = $(id);
  el.addEventListener('input', () => { cw.busy[key] = true; $(id + 'Value').textContent = label(Number(el.value)); });
  el.addEventListener('change', () => { cw.busy[key] = false; if (link) sendCw(key, Number(el.value)); });   // 手を離したときに送る
}
hookSlider('wpm', 'wpm', (v) => `${v} WPM`);
hookSlider('pwr', 'pct', (v) => { updatePowerBar(v); return $('pwrValue').textContent; });
document.querySelectorAll('#bk button').forEach((b) => {
  b.addEventListener('click', () => { if (link) sendCw('bk', Number(b.dataset.bk)); });
});
document.querySelectorAll('#keytype button').forEach((b) => {
  b.addEventListener('click', () => { if (link) sendCw('key', Number(b.dataset.key)); });
});

// ---- モールスの文章を送る（2026-11-15 ユーザーの希望。入力欄と定型文 4 つ） ----
// CI-V 17 + 文字（ASCII、1 回 30 文字まで）で本体のキーヤーが送信する。17 FF で止める（CI-V Reference Guide p.17）。
// 長い文章は空白のところで 29 文字以下に分け、1 つ送り終わるころ（今の CW スピードから計算）に次を送る。
// 定型文は localStorage の ic705bt.cwmsg に覚える（この端末の中だけ。どこへも送らない）。
const CW_OK = /[0-9A-Z/?.\-,:'()=+"@^ ]/;
const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '/': '-..-.', '?': '..--..', '.': '.-.-.-', '-': '-....-', ',': '--..--', ':': '---...', "'": '.----.', '(': '-.--.', ')': '-.--.-',
  '=': '-...-', '+': '.-.-.', '"': '.-..-.', '@': '.--.-.' };
const CW_DEFAULTS = ['CQ CQ CQ', '5NN TU', 'TU 73', 'QRZ?'];
var cwJob = 0, cwBusy = false;   // var: 起動時に showCwMsg が先に呼ばれても困らないように
function cwClean(s) {
  return Array.from(s.toUpperCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'")).filter((c) => CW_OK.test(c)).join('').replace(/\s+/g, ' ').trim();
}
// 単語ごとに分ける（29 文字より長い単語は 29 文字で切る。続きがあるものは最後に空白を足して、単語の間をあける）。
// 2026-11-15 実機: 30 文字ずつ「送り終わってから次」だと、つなぎ目に不自然な間があいた。
// 本体は送信中に届いた 17 を続きとしてためる（N1MM などと同じ使い方）と考え、小さく分けて、送り終わる少し前（CW_LEAD）に次を送る。
function cwChunks(s) {
  const out = [];
  for (const w of s.split(' ')) for (let i = 0; i < w.length; i += 29) out.push(w.slice(i, i + 29));
  return out.map((p, i) => (i < out.length - 1 ? p + ' ' : p));
}
const CW_LEAD = 1500;   // 送り終わる予定のこのミリ秒前に、次の単語を本体へ送っておく
// 送るのにかかる時間（ミリ秒）。1 単位 = 1200 / WPM ミリ秒。短点 1・長点 3・符号の間 1・文字の間 3・単語の間 7
function cwMs(s) {
  let units = 0, join = 0;
  for (const c of s) {
    if (c === '^') { join = 2; continue; }
    if (c === ' ') { units += 4; continue; }   // 文字の間 3 に足して 7
    const m = MORSE[c];
    if (!m) continue;
    for (const e of m) units += (e === '.' ? 1 : 3) + 1;
    units += join > 1 ? 0 : 2;                 // 符号の間 1 に足して文字の間 3（^ のあとの 1 文字目は続ける）
    if (join) join--;
  }
  return (units * 1200) / (cw.wpm || 20);
}
function cwSay(key, v) { $('cwStatus').textContent = key ? t(key, { v }) : ''; }
async function cwSendText(text) {
  if (!link || !cwCanSend()) return;
  const s = cwClean(text);
  if (!s) { cwSay('cwEmpty'); return; }
  if (cwBusy) await cwStop(true);
  const job = ++cwJob;
  cwBusy = true; showCwMsg();
  try {
    let end = Date.now();   // 本体にためた分を送り終わる予定の時刻
    cwSay('cwSending', s);
    clog(t('clText', { v: s, w: cw.wpm || '?' }));
    for (const p of cwChunks(s)) {
      while (end - Date.now() > CW_LEAD) { if (job !== cwJob || !link) return; await sleep(50); }
      // 本体が「できません」（FA）と返したら、0.5 秒あけて 3 回まで送り直す（ためる場所がいっぱいのときに備えて）
      let r = null;
      for (let n = 0; n < 4; n++) {
        if (job !== cwJob || !link) return;
        const t0 = Date.now();
        r = await sendWait(civ(0x17, ...ascii(p)), t('nCwMsg', { v: p.trim() }), 1000, (x) => x[4] === 0xFB || x[4] === 0xFA);
        const left = Math.round((end - Date.now()) / 100) / 10;
        clog(t('clWord', { v: p.trim(), r: r ? (r[4] === 0xFB ? 'OK' : t('clNg')) : t('blNone'), ms: Date.now() - t0, left: Math.max(0, left) }));
        if (!r || r[4] !== 0xFA) break;
        await sleep(500);
      }
      if (r && r[4] === 0xFA) { if (job === cwJob) cwSay('cwNg'); return; }
      end = Math.max(end, Date.now()) + cwMs(p);
    }
    while (Date.now() < end) { if (job !== cwJob || !link) return; await sleep(100); }
    clog(t('clEnd'));
    if (job === cwJob) cwSay(cw.bk === 0 ? 'cwDoneBkOff' : 'cwDone');
  } catch (e) { log(t('lgSendFail', { msg: e.message })); }
  finally { if (job === cwJob) { cwBusy = false; showCwMsg(); } }
}
async function cwStop(quiet) {
  cwJob++; cwBusy = false; showCwMsg();
  if (!quiet) cwSay('cwStopped');
  clog(t('cwStopped'));
  try { await send(civ(0x17, 0xFF), t('nCwStop')); } catch (e) { log(t('lgSendFail', { msg: e.message })); }
}
function cwCanSend() { return fil.mode == null || fil.mode === 0x03 || fil.mode === 0x07; }
function loadCwPresets() {
  try { const a = JSON.parse(localStorage.getItem('ic705bt.cwmsg') || 'null'); if (Array.isArray(a) && a.length === 4) return a.map(String); } catch (e) { /* 初めは決まった文 */ }
  return CW_DEFAULTS.slice();
}
var cwPresets = loadCwPresets();
function showCwMsg() {
  const on = !!link, ok = on && cwCanSend() && !cwBusy;
  // 送っている間は「止める」（と切る・言語など本体へ送らないもの）以外を押せなくする（2026-11-15 ユーザーの希望。
  // 送っている間に読みに行くのを止めたら単語が抜けなくなったので、ページのボタンで本体へ送る命令も止める）
  document.querySelectorAll('.cols section:not(#secCw), .tune, .unitrow').forEach((el) => { el.inert = cwBusy; el.classList.toggle('cwdim', cwBusy); });
  if (cwBusy) {
    $('wpm').disabled = true;
    document.querySelectorAll('#bk button, #keytype button').forEach((b) => { b.disabled = true; });
  } else if (on) {
    $('wpm').disabled = false;
    document.querySelectorAll('#bk button, #keytype button').forEach((b) => { b.disabled = false; });
  }
  $('cwText').disabled = !on || cwBusy;
  document.querySelectorAll('.cwp input').forEach((el) => { el.disabled = cwBusy; });
  $('cwSend').disabled = !ok;
  $('cwStop').disabled = !on || !cwBusy;
  $('cwStop').classList.toggle('danger', on && cwBusy);
  document.querySelectorAll('#cwPresets button').forEach((b, i) => {
    b.disabled = !ok || !cwClean(cwPresets[i]);
    b.querySelector('.fnval').textContent = cwClean(cwPresets[i]) || '--';
  });
  // 知らせ: CW でない > ブレークイン OFF（本体の仕様で電波は出ず、サイドトーンだけ。2026-11-15 実機で確認）
  const hints = [t('cwNotCw'), t('cwBkOff')], cur = $('cwStatus').textContent;
  if (!cwBusy) {
    if (on && !cwCanSend()) cwSay('cwNotCw');
    else if (on && cw.bk === 0) cwSay('cwBkOff');
    else if (hints.includes(cur)) cwSay('');
  }
}
// 念のため: 送っている間に押せなくした場所のクリックは、ここで止める（inert に加えて）
document.addEventListener('click', (e) => { if (cwBusy && e.target.closest && e.target.closest('.cwdim')) { e.stopPropagation(); e.preventDefault(); } }, true);
$('cwSend').addEventListener('click', () => cwSendText($('cwText').value));
// 入力欄の文も覚える（localStorage の ic705bt.cwtext。この端末の中だけ。2026-11-15 ユーザーの希望）
try { $('cwText').value = localStorage.getItem('ic705bt.cwtext') || ''; } catch (e) { /* 覚えていなくても動く */ }
$('cwText').addEventListener('input', () => { try { localStorage.setItem('ic705bt.cwtext', $('cwText').value); } catch (e) { /* 覚えられなくても動く */ } });
$('cwText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); cwSendText($('cwText').value); } });
$('cwStop').addEventListener('click', () => cwStop(false));
document.querySelectorAll('#cwPresets button').forEach((b, i) => b.addEventListener('click', () => cwSendText(cwPresets[i])));
document.querySelectorAll('.cwp input').forEach((el, i) => {
  el.value = cwPresets[i];
  el.addEventListener('input', () => {
    cwPresets[i] = el.value;
    try { localStorage.setItem('ic705bt.cwmsg', JSON.stringify(cwPresets)); } catch (e) { /* 覚えられなくても動く */ }
    showCwMsg();
  });
});

// ---- 最大出力（MAX TX PWR）。本体の FUNCTION → MAX TX PWR と同じ（ユーザーの希望） ----
// 送信パワー 100 % でも、実際はこの上限までしか出ない（ユーザー: 100 % でも 50 % 〔5 W〕だった）。
// 電源の種類 1A 0B（00=外部電源 01=バッテリーパック。今の電圧から本体が決める）、
// 最大送信出力 1A 05 0036（バッテリー: 00=0.5 01=1 02=2.5 03=5 W）・0037（外部電源: 00=0.5 01=1 02=2.5 03=5 04=10 W）
// （はじめは Po メーターで送信中の出力を出したが、ユーザーの希望でやめた）
const MAX_W = { bat: [0.5, 1, 2.5, 5], dc: [0.5, 1, 2.5, 5, 10] };
const power = { src: null, bat: null, dc: null };
function resetPower() { power.src = power.bat = power.dc = null; }
// 最大出力は読むだけ（切り替えボタンは、実機でもほとんど使わないのでやめた。ユーザーの希望）
function showPower() {
  const kind = power.src === 0x01 ? 'bat' : power.src === 0x00 ? 'dc' : null;
  $('powerSrc').textContent = link && kind ? t(kind === 'bat' ? 'srcBat' : 'srcDc') : '';
  const maxW = currentMaxW();
  $('maxpwrValue').textContent = link && maxW != null ? `${maxW} W` : '--';
  updatePowerBar(cw.busy.pct ? Number($('pwr').value) : cw.pct);
}
function onRadioMax(kind, code) {
  if (power[kind] === code) return;
  power[kind] = code;
  showPower();
}

// ---- 送信パワーの表示（本体の RF POWER の表示に合わせる。ユーザーの希望） ----
// 目盛りは 10 W = 100 %。最大出力（MAX TX PWR）は同じ目盛りの上の「上限の印」（5 W なら 50 % の位置）。
// 設定が上限を超えると、実際の送信出力は上限で止まる（取扱説明書 3-10「最大送信出力を超えている場合は、送信出力が制限され」）。
function currentMaxW() {
  const kind = power.src === 0x01 ? 'bat' : power.src === 0x00 ? 'dc' : null;
  const code = kind ? power[kind] : null;
  return code != null ? MAX_W[kind][code] : null;
}
function updatePowerBar(setPct) {
  const maxW = currentMaxW();
  const capPct = maxW != null ? maxW * 10 : 100;
  const known = setPct != null;
  const actual = known ? Math.min(setPct, capPct) : 0;
  const limited = known && setPct > capPct;
  $('pwrFill').style.width = `${actual}%`;
  $('pwrCap').style.left = `${capPct}%`;
  $('pwrCap').hidden = maxW == null;
  $('pwrOver').style.left = `${capPct}%`;
  $('pwrOver').style.width = `${100 - capPct}%`;
  $('pwrOver').hidden = maxW == null;
  $('pwrCapLabel').textContent = maxW != null ? `MAX ${maxW} W` : '';
  $('pwrCapLabel').style.left = `${capPct}%`;
  // 端（10 W）のときは、文字がはみ出さないように左へ寄せる
  $('pwrCapLabel').style.transform = capPct > 85 ? 'translateX(-100%)' : capPct < 15 ? 'none' : 'translateX(-50%)';
  // 設定は「% と、10 W を基準にした W」で出す（ユーザーの希望）
  const fw = (x) => (x < 1 ? x.toFixed(2) : x.toFixed(1));
  $('pwrValue').textContent = known ? t('pwrSetVal', { pct: setPct, w: fw(setPct / 10) }) : '-- %';
  $('pwrActual').textContent = known ? t('pwrActual', { pct: actual, w: fw(actual / 10) }) : '';
  $('pwrLimited').textContent = limited ? t('pwrLimited') : '';
}

// ---- フィルター（順番の 4） ----
// モードとフィルター: 04 で読む（返事 04 <モード> <フィルター>）、06 <モード> <フィルター> で変える。本体で変えたときの知らせ 01 も同じ形。
// モード 00=LSB 01=USB 02=AM 03=CW 04=RTTY 05=FM 06=WFM 07=CW-R 08=RTTY-R 17=DV、フィルター 01=FIL1 02=FIL2 03=FIL3。
// 帯域幅: 1A 03 <番号 1 バイト BCD>（今選んでいるフィルターの幅。公式 CI-V 説明書 p.19）
//   SSB・CW: 0〜9 = 50〜500 Hz（50 Hz ごと）、10〜40 = 600 Hz〜3.6 kHz（100 Hz ごと）
//   RTTY: 0〜31（〜2.7 kHz）、AM: 0〜49 = 200 Hz〜10 kHz（200 Hz ごと）。FM・WFM・DV は幅を変えられない。
const MODE_NAMES = { 0x00: 'LSB', 0x01: 'USB', 0x02: 'AM', 0x03: 'CW', 0x04: 'RTTY', 0x05: 'FM', 0x06: 'WFM', 0x07: 'CW-R', 0x08: 'RTTY-R', 0x17: 'DV' };
const fil = { mode: null, fil: null, idx: null, busy: false, sentAt: 0, modeSentAt: 0 };
const bcd1ToNum = (b) => (b >> 4) * 10 + (b & 0x0f);
const numToBcd1 = (n) => ((Math.floor(n / 10) % 10) << 4) | (n % 10);
// そのモードで幅を変えられる番号の上限（変えられないモードは null）
function widthMax(mode) {
  if (mode === 0x00 || mode === 0x01 || mode === 0x03 || mode === 0x07) return 40;
  if (mode === 0x04 || mode === 0x08) return 31;
  if (mode === 0x02) return 49;
  return null;
}
function idxToHz(mode, i) {
  if (mode === 0x02) return (i + 1) * 200;
  return i < 10 ? (i + 1) * 50 : (i - 4) * 100;
}
const fmtWidth = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz % 100 ? 2 : 1)} kHz` : `${hz} Hz`);

function showFilter() {
  if (cwPresets) showCwMsg();   // モードが CW のときだけ文章を送れる
  const on = !!link;
  const max = widthMax(fil.mode);
  document.querySelectorAll('#modes button').forEach((b) => {
    b.disabled = !on;
    b.classList.toggle('on', on && Number(b.dataset.mode) === fil.mode);
  });
  document.querySelectorAll('#fil button').forEach((b) => {
    b.disabled = !on || fil.mode == null;
    b.classList.toggle('on', on && Number(b.dataset.fil) === fil.fil);
  });
  const s = $('filWidth');
  s.disabled = !on || max == null || fil.idx == null;
  if (max != null) {
    s.max = String(max);
    $('filMin').textContent = fmtWidth(idxToHz(fil.mode, 0));
    $('filMax').textContent = fmtWidth(idxToHz(fil.mode, max));
  }
  if (!fil.busy) {
    if (on && max == null && fil.mode != null) $('filWidthValue').textContent = t('filFixed');
    else if (on && fil.idx != null && max != null) { s.value = String(Math.min(max, fil.idx)); $('filWidthValue').textContent = fmtWidth(idxToHz(fil.mode, fil.idx)); }
    else $('filWidthValue').textContent = '--';
  }
}
function onRadioMode(mode, filter) {
  if (Date.now() - fil.modeSentAt < 1500) return;
  const changed = mode !== fil.mode || (filter != null && filter !== fil.fil);
  if (!changed) return;
  fil.mode = mode;
  if (filter != null) fil.fil = filter;
  fil.idx = null;                           // モードやフィルターが変わったら幅を読み直す
  rememberBand();
  showFilter();
  showRx();
  if (widthMax(mode) != null) send(civ(0x1A, 0x03)).catch(() => {});
  if (!load.depth) readRx('mode');   // まとめ読み中はそちらで読むので、重ねて読まない
}
function onRadioWidth(idx) {
  if (fil.busy || Date.now() - fil.sentAt < 1500 || idx === fil.idx) return;
  fil.idx = idx;
  showFilter();
}
async function sendFilter(n) {
  if (fil.mode == null) return;
  fil.fil = n; fil.idx = null; fil.modeSentAt = Date.now();
  rememberBand();
  showFilter();
  try {
    await send(civ(0x06, fil.mode, n), t('nFil', { v: n }));
    fil.modeSentAt = Date.now();
    if (widthMax(fil.mode) != null) await send(civ(0x1A, 0x03));   // 新しいフィルターの幅を読む
  } catch (e) { log(t('lgSendFail', { msg: e.message })); }
}
// モードの切り替え（2026-11-15 ユーザーの希望）: 06 <モード>。フィルターを付けないと、本体がそのモードの決まったフィルターを選ぶ（CI-V Reference Guide p.17）。
// 送った後はモード・フィルター（04）と帯域幅（1A 03）を読み直す。
async function sendMode(mode) { return withLoading(null, () => sendModeInner(mode)); }
async function sendModeInner(mode) {
  fil.mode = mode; fil.fil = null; fil.idx = null; fil.modeSentAt = Date.now();
  rememberBand();
  showFilter();
  showRx();
  try {
    await send(civ(0x06, mode), t('nMode', { v: MODE_NAMES[mode] }));
    await sleep(200);                       // 先に並んでいた古い読み値の返事をやり過ごす
    fil.modeSentAt = 0;                     // 本体の返事（04）でフィルターを合わせる
    await send(civ(0x04));
    if (widthMax(mode) != null) await send(civ(0x1A, 0x03));
  } catch (e) { log(t('lgSendFail', { msg: e.message })); }
  await readRx('mode');
}
document.querySelectorAll('#modes button').forEach((b) => {
  b.addEventListener('click', () => { if (link) sendMode(Number(b.dataset.mode)); });
});
async function sendWidth(idx) {
  fil.idx = idx; fil.sentAt = Date.now();
  showFilter();
  try { await send(civ(0x1A, 0x03, numToBcd1(idx)), t('nWidth', { v: fmtWidth(idxToHz(fil.mode, idx)) })); }
  catch (e) { log(t('lgSendFail', { msg: e.message })); }
  fil.sentAt = Date.now();
  pbtCenter();   // 帯域幅を変えたら SHIFT を 0 に
}
$('filWidth').addEventListener('input', () => {
  fil.busy = true;
  $('filWidthValue').textContent = fmtWidth(idxToHz(fil.mode, Number($('filWidth').value)));
});
$('filWidth').addEventListener('change', () => { fil.busy = false; if (link) sendWidth(Number($('filWidth').value)); });   // 手を離したときに送る
document.querySelectorAll('#fil button').forEach((b) => {
  b.addEventListener('click', () => { if (link) sendFilter(Number(b.dataset.fil)); });
});

// ---- 受信: プリアンプ・NB・NR・ノッチ（2026-11-15 ユーザーの希望） ----
// 16 02 プリアンプ（00=OFF 01=P.AMP1 02=P.AMP2）、16 22 NB、16 40 NR、16 41 オートノッチ、16 48 マニュアルノッチ（どれも 00=OFF 01=ON）。
// 公式 CI-V 説明書の表は文字にすると説明が 1 行ずれて読めるので、番号の並び（16 47 ブレークイン・16 50 ロックが実機で合っている）から決めた。
// ノッチは本体の NOTCH ボタンと同じく OFF・AN（オート）・MN（マニュアル）の 3 つ。CW はオートノッチが無いので AN を止める。FM などはノッチ自体を止める。
// 144/430 MHz 帯のプリアンプは OFF/ON だけ（P.AMP2 は無い。CI-V Reference Guide の 16 02）。100 MHz 以上をその帯とみなして P.AMP2 を止める
const vuBand = () => curHz >= 100e6;
let lastVu = false;
let lastBandCode = 0;       // 最後に読んだ周波数のバンド（変わったら受信を読み直す）
const RX_SUB = { pamp: 0x02, nb: 0x22, nr: 0x40, an: 0x41, mn: 0x48 };
const RX_KEY = Object.fromEntries(Object.entries(RX_SUB).map(([k, v]) => [v, k]));
const rx = { pamp: null, nb: null, nr: null, an: null, mn: null, sentAt: {} };
const notchOk = () => fil.mode != null && widthMax(fil.mode) != null;            // SSB・CW・RTTY・AM
const autoNotchOk = () => notchOk() && fil.mode !== 0x03 && fil.mode !== 0x07;   // CW ではオートノッチは使えない
function resetRx() { rx.pamp = rx.nb = rx.nr = rx.an = rx.mn = null; }

function notchState() {
  if (rx.mn === 1) return 2;
  if (!autoNotchOk()) return rx.mn === 0 ? 0 : null;   // CW はオートノッチが無いので、マニュアルノッチだけで決める
  return rx.an === 1 ? 1 : (rx.an === 0 && rx.mn === 0 ? 0 : null);
}
// 受信の四角いボタン（本体の FUNCTION 画面ふう）。名前の下に今の値、ON のときは青い枠
function showRx() {
  const on = !!link;
  const tile = (id, val, lit, enabled) => {
    $(id).disabled = !on || !enabled || val == null;   // 値が分からない間は押せない（薄く表示）
    $(id).classList.toggle('on', on && lit);
    $(id + 'Val').textContent = on && val != null ? val : '--';
  };
  // 144/430 MHz 帯は OFF/ON だけ（01 = ON）
  const pampName = rx.pamp == null ? null : vuBand() ? (rx.pamp ? 'ON' : 'OFF') : ['OFF', 'P.AMP1', 'P.AMP2'][rx.pamp];
  tile('fnPamp', pampName, rx.pamp > 0, true);
  const n = notchState();
  tile('fnNotch', notchOk() ? (n == null ? null : ['OFF', 'AN', 'MN'][n]) : null, notchOk() && n > 0, notchOk());
  tile('fnNb', rx.nb == null ? null : rx.nb ? 'ON' : 'OFF', rx.nb === 1, true);
  tile('fnNr', rx.nr == null ? null : rx.nr ? 'ON' : 'OFF', rx.nr === 1, true);
}
function onRadioRx(key, value) {
  if (Date.now() - (rx.sentAt[key] || 0) < 1500 || rx[key] === value) return;
  rx[key] = value;
  showRx();
}
async function sendRx(key, value) {
  rx[key] = value; rx.sentAt[key] = Date.now();
  showRx();
  const names = { pamp: ['OFF', 'P.AMP1', 'P.AMP2'][value], nb: `NB ${value ? 'ON' : 'OFF'}`, nr: `NR ${value ? 'ON' : 'OFF'}`,
    an: `AN ${value ? 'ON' : 'OFF'}`, mn: `MN ${value ? 'ON' : 'OFF'}` };
  try { await send(civ(0x16, RX_SUB[key], value), `(${names[key]})`); } catch (e) { log(t('lgSendFail', { msg: e.message })); }
  rx.sentAt[key] = Date.now();
}
async function sendNotch(n) {
  // 先に OFF にするほうを送る（オートとマニュアルが同時に ON にならないように）
  if (n !== 1) await sendRx('an', 0);
  if (n !== 2) await sendRx('mn', 0);
  if (n === 1) await sendRx('an', 1);
  if (n === 2) await sendRx('mn', 1);
}
// 押すたびに次へ（本体と同じ）: P.AMP は OFF → P.AMP1 → P.AMP2 → OFF（144/430 MHz 帯は OFF ⇔ ON）、
// NOTCH は OFF → AN → MN → OFF（CW は AN が無いので OFF ⇔ MN）、NB・NR は OFF ⇔ ON
$('fnPamp').addEventListener('click', () => {
  if (!link || rx.pamp == null) return;
  sendRx('pamp', vuBand() ? (rx.pamp ? 0 : 1) : (rx.pamp + 1) % 3);
});
$('fnNotch').addEventListener('click', () => {
  if (!link || !notchOk()) return;
  const n = notchState() ?? 0;
  sendNotch(autoNotchOk() ? (n + 1) % 3 : (n === 2 ? 0 : 2));
});
$('fnNb').addEventListener('click', () => { if (link && rx.nb != null) sendRx('nb', rx.nb ? 0 : 1); });
$('fnNr').addEventListener('click', () => { if (link && rx.nr != null) sendRx('nr', rx.nr ? 0 : 1); });

// ---- 帯域幅を変えたら SHIFT（TWIN PBT）を 0 に（2026-11-15 ユーザーの希望） ----
// SHIFT のスライダーは、PBT1・PBT2 で絞りとシフトの両方を決めるので組み合わせが多く複雑になるため、やめた（ユーザーの希望）。
// 本体は帯域幅を変えると TWIN PBT をセンターに戻す（取扱説明書 4-7）が、念のためページからも
// PBT1 `14 07`・PBT2 `14 08` を 0128（センター）にして送る。PBT は読まない。
async function pbtCenter() {
  try {
    await send(civ(0x14, 0x07, 0x01, 0x28), t('nPbtCenter'));
    await send(civ(0x14, 0x08, 0x01, 0x28), t('nPbtCenter'));
  } catch (e) { log(t('lgSendFail', { msg: e.message })); }
}

// ---- バンドの切り替え（2026-11-15 ユーザーの希望） ----
// 本体のバンドキーと同じく、そのバンドで最後に使った周波数・モードへ移る。
// 1A 01 <バンド番号> 01 でバンドスタッキングレジスター（最後に使ったもの）を読み、
// 返事の周波数を 05、モード・データモード・フィルターを 26 00 で設定する（CI-V Reference Guide p.18・19・27）。
// 返事: 1A 01 <バンド> <01> <周波数 5 バイト> <モード> <フィルター> <データモード> …
// 1 秒たっても返事が無いときは、そのバンドの決まった周波数（BANDS の hz）へ移る。
const BANDS = [
  { code: 0x01, name: '1.9', lo: 1.8e6, hi: 2.0e6, hz: 1_810_000 },
  { code: 0x02, name: '3.5', lo: 3.4e6, hi: 4.1e6, hz: 3_510_000 },
  { code: 0x03, name: '7', lo: 6.9e6, hi: 7.5e6, hz: 7_010_000 },
  { code: 0x04, name: '10', lo: 9.9e6, hi: 10.5e6, hz: 10_110_000 },
  { code: 0x05, name: '14', lo: 13.9e6, hi: 14.5e6, hz: 14_050_000 },
  { code: 0x06, name: '18', lo: 17.9e6, hi: 18.5e6, hz: 18_080_000 },
  { code: 0x07, name: '21', lo: 20.9e6, hi: 21.5e6, hz: 21_050_000 },
  { code: 0x08, name: '24', lo: 24.4e6, hi: 25.1e6, hz: 24_900_000 },
  { code: 0x09, name: '28', lo: 28.0e6, hi: 30.0e6, hz: 28_050_000 },
  { code: 0x10, name: '50', lo: 50.0e6, hi: 54.0e6, hz: 50_050_000 },
  { code: 0x13, name: '144', lo: 144e6, hi: 148e6, hz: 144_050_000 },
  { code: 0x14, name: '430', lo: 420e6, hi: 450e6, hz: 430_050_000 },
];
// つないでいる間、バンドごとに最後の周波数・モード・フィルターを覚える（2026-11-15 ユーザー報告で追加）。
// ページが 05 で周波数を直接変えてバンドを移ると、本体は出ていくバンドのバンドスタッキングレジスターを更新しない
// （更新するのは本体のバンドキーのとき）ので、戻ってきたときに前の周波数にならなかった。
// 覚えたものがあればそれを使い、無ければ（つないでからまだ行っていないバンド）本体のレジスターを読む。本体のダイヤルで動かした分も覚える。
let bandMem = {};
function rememberBand() {
  const b = curBand();
  if (b && curHz) bandMem[b.code] = { hz: curHz, mode: fil.mode, filter: fil.fil };
}
const curBand = () => BANDS.find((b) => curHz >= b.lo && curHz <= b.hi) || null;

function showBand() {
  const on = !!link, cb = on ? curBand() : null;
  document.querySelectorAll('#bands button').forEach((btn) => {
    btn.disabled = !on || locked;
    btn.classList.toggle('on', !!cb && Number(btn.dataset.code) === cb.code);
  });
  // 今いるバンドの記憶 3 つ（読んであるときだけ出す）。ページが覚えている「使用中の記憶」（出ていくときにしまう先）だけ青い枠。
  // 前は「今の周波数と同じ記憶」に枠を付けていたので、同じ周波数の記憶が 2 つあると枠が 2 つ、ダイヤルを回すと枠が消えた
  // （2026-11-16 ユーザー報告「7 MHz で枠なし、144 MHz で 2 つ」）。IC-9700 の水色の枠と同じ意味にした。使用中が分からないときは枠なし
  const use = cb ? inUse[cb.code] : null;
  const list = cb ? stacks[cb.code] : null;
  $('stackBox').hidden = !list;
  document.querySelectorAll('#stack button').forEach((btn, i) => {
    const e = list && list[i];
    btn.disabled = !on || locked || !e;
    btn.querySelector('.fnname').textContent = e ? (MODE_NAMES[e.mode] || '--') : '--';   // 左・中央・右の文字は出さない（2026-11-15 ユーザーの希望）
    btn.querySelector('.fnval').textContent = e ? fmtMHz(e.hz) : '--';
    btn.classList.toggle('on', !!e && use === i);
  });
}
async function moveTo(hz, mode, filter, data, note) {
  curHz = hz; showFreq(hz); stepFreq = hz;
  quietUntil = Date.now() + 800;            // 移った直後に古い周波数で表示が戻らないように
  showBand();
  try {
    await send(civ(0x05, ...hzToBcd(hz)), note);
    if (mode != null) {
      // ページの覚えているモードもすぐ変える（古いモードを新しいバンドの分として覚えないように）
      fil.mode = mode; fil.fil = filter || 0x01; fil.idx = null; fil.modeSentAt = Date.now();
      showFilter(); showRx();
      await send(civ(0x26, 0x00, mode, data || 0x00, filter || 0x01));
      if (widthMax(mode) != null) await send(civ(0x1A, 0x03));
    }
    rememberBand();
    const bc = curBand() ? curBand().code : 0;
    if (bc !== lastBandCode) { lastBandCode = bc; await readRx('band'); } else if (mode != null) await readRx('mode');
  } catch (e) { log(t('lgSendFail', { msg: e.message })); }
}
// ---- バンドの記憶（バンドスタッキングレジスター）3 つを読んで、選べるようにする（2026-11-15 ユーザーと相談） ----
// 実機で分かったこと: 記憶は 1 バンドに 3 つ（番号 01・02・03 = 本体の画面の左・中央・右。CI-V Reference Guide p.19）。
// 本体は「今使っている記憶」に最後の周波数を入れるが、それが 3 つのどれかを読む命令は無く、記憶の中に順番や日付も無い。
// そこで、バンドボタンを押したときにそのバンドの 3 つを読み（実機では 1 つ約 1 秒）、バンドボタンの下に 3 つを並べて選べるようにする。
// 最初に移る先: 同じ端末で前に読んだときと比べて 1 つだけ変わっていればそれ（本体が最後に書いたもの）、
// 何も変わっていなければ前回使ったもの、見分けがつかなければ左。
// 出ていくバンドの記憶を書き直すこと（前の saveBandStack）はやめた: 左に書いても本体が使う記憶とは限らず、
// ユーザーの記憶を 1 つつぶし、実機では書き込みも失敗していた。
const STACK_WAIT = 2500;    // 記憶の返事を待つ時間（ミリ秒）。実機では返事まで約 1 秒かかる
let stackFail = 'blNone';   // 読めなかった理由（blNone = 返事が無い、blNg = 本体が「できません」FA）
const POS = ['posL', 'posC', 'posR'];
let stacks = {};            // バンド番号 → 記憶 3 つ（{ hz, mode, filter, data }。読めない・バンドの外は null）。つないでいる間だけ覚える
// 記憶を 1 つ読む。読めなければ null。送り終えてから STACK_WAIT 待ち、返事が無ければ 1 回だけ読み直す
async function readBandStack(b, note, reg) {
  stackFail = 'blNone';
  for (let n = 0; n < 2 && link; n++) {
    const f = await sendWait(civ(0x1A, 0x01, b.code, reg), note, STACK_WAIT);
    if (f && f[4] === 0x1A && f.length >= 17) return f;
    // 「できません」（FA）は、前に送った別の命令への遅れた返事のこともあるので、すぐあきらめずに 1 回読み直す（2026-11-15 見直し）
    if (f && f[4] === 0xFA) { stackFail = 'blNg'; await sleep(200); } else stackFail = 'blNone';
  }
  return null;
}
// 前に読んだ記憶（周波数だけ）と、前回使った番号を、この端末のブラウザーに覚える（localStorage の ic705bt.stacks。秘密ではない）
function loadSnap() {
  try { return JSON.parse(localStorage.getItem('ic705bt.stacks') || '{}') || {}; } catch (e) { return {}; }
}
function saveSnap(code, list, last) {
  const all = loadSnap();
  all[code] = { hz: list.map((e) => (e ? e.hz : 0)), last };
  try { localStorage.setItem('ic705bt.stacks', JSON.stringify(all)); } catch (e) { /* 覚えられなくても動く */ }
}
// そのバンドの記憶を 3 つ読んで stacks に入れる。戻り値は、最初に移る番号（0〜2）と理由。1 つも読めなければ null
async function loadStacks(b) {
  const list = [];
  let fail = '';
  for (let reg = 1; reg <= 3; reg++) {
    if (!link) return null;
    const f = await readBandStack(b, t('nBandRead', { v: b.name, p: t(POS[reg - 1]) }), reg);
    const hz = f ? bcdToHz(f.slice(8, 13)) : 0;
    if (!f) fail = t(stackFail);
    list.push(f && hz >= b.lo && hz <= b.hi ? { hz, mode: f[13], filter: f[14], data: f[15], raw: f.slice(8, f.length - 1) } : null);
  }
  const cell = (e) => (e ? fmtMHz(e.hz) : '-');
  blog(t('blRead', { v: b.name, a: cell(list[0]), b: cell(list[1]), c: cell(list[2]) }) + (fail ? ` (${fail})` : ''));
  if (!list.some(Boolean)) return null;
  stacks[b.code] = list;
  const snap = loadSnap()[b.code];
  let pick = -1, why = 'whyFirst';
  if (snap && Array.isArray(snap.hz)) {
    const changed = [0, 1, 2].filter((i) => list[i] && list[i].hz !== snap.hz[i]);
    if (changed.length === 1) { pick = changed[0]; why = 'whyDiff'; }
    else if (!changed.length && list[snap.last]) { pick = snap.last; why = 'whyLast'; }
  }
  if (pick < 0) pick = list.findIndex(Boolean);
  saveSnap(b.code, list, pick);
  inUse[b.code] = pick;
  return { pick, why };
}
// ページが覚える「使用中の記憶」（バンド番号 → 0〜2）。本体の使用中の印は CI-V で読めず動かせない（実験 A・B）ので、
// ページが自分で覚え、出ていく前に今の周波数・モードをそこへ書く（本体のバンドキーと同じ動き。2026-11-15 ユーザーと決めた）
let inUse = {};
async function writeInUse(b) {
  const list = b && stacks[b.code], i = b ? inUse[b.code] : null;
  const e = list && i != null ? list[i] : null;
  if (!e || !e.raw || !curHz || curHz < b.lo || curHz > b.hi) return;
  const mode = fil.mode != null ? fil.mode : e.mode, filter = fil.fil != null ? fil.fil : e.filter;
  if (e.hz === curHz && e.mode === mode && e.filter === filter) return;   // 変わっていなければ書かない
  const body = e.raw.slice();
  body.splice(0, 5, ...hzToBcd(curHz)); body[5] = mode; body[6] = filter;
  const hz = curHz;
  const r = await sendWait(civ(0x1A, 0x01, b.code, i + 1, ...body), t('nBandWrite', { v: b.name, p: t(POS[i]), f: fmtMHz(hz) }),
    STACK_WAIT, (x) => x[4] === 0xFB || x[4] === 0xFA);
  // 実機では書けているのに「書きました」の返事が届かないことがある（2026-11-15 実機: 返事なしでも中央が書き換わっていた）。
  // 返事が無いときは読み直して、周波数が入っていれば書けたとみなす
  let ok = !!r && r[4] === 0xFB;
  if (!r && link) {
    const f = await readBandStack(b, t('nBandRead', { v: b.name, p: t(POS[i]) }), i + 1);
    ok = !!f && bcdToHz(f.slice(8, 13)) === hz;
  }
  if (ok) {
    list[i] = { hz, mode, filter, data: e.data, raw: body };
    saveSnap(b.code, list, i);
    blog(t('blWrote', { v: b.name, p: t(POS[i]), f: fmtMHz(hz) }));
  } else {
    blog(t('blWriteFail', { v: b.name, p: t(POS[i]) }) + ` (${t(r ? 'blNg' : 'blNone')})`);
    delete stacks[b.code];   // 書けなかったら古い内容を使わない（次は bandMem か読み直し）
  }
}
// 本体のキーでバンドが変わったとき: 本体は出たバンドの使用中の記憶へしまったので、そのバンドは読み直す。
// 入ったバンドは、今の周波数と同じ記憶を使用中とみなす（無ければ読み直す）
function radioBandChanged(prev, bc) {
  if (load.depth) return;   // ページが移している最中は除く
  delete stacks[prev];
  const list = stacks[bc], i = list ? list.findIndex((e) => e && e.hz === curHz) : -1;
  if (i >= 0) inUse[bc] = i; else delete stacks[bc];
  const b = BANDS.find((x) => x.code === bc);
  if (b) blog(t('blRadioBand', { v: b.name }));
  showBand();
}
async function selectBand(code) {
  if (!link || locked || load.depth) return;
  const b = BANDS.find((x) => x.code === code);
  rememberBand();                           // 出ていくバンドの今の周波数を覚える
  const cur = curBand();
  await withLoading(null, async () => {
    try {
      const note = t('nBand', { v: b.name });
      const say = (hz, why) => blog(t('blMove', { v: b.name, f: fmtMHz(hz), why }));
      if (cur !== b) await writeInUse(cur);   // 出ていくバンドの使用中の記憶へしまう
      if (!link) return;
      const st = stacks[code], k = inUse[code];
      // 記憶を読んであるバンドは、ページが覚えている使用中の記憶へ移る（読まないので速い）
      if (cur !== b && st && k != null && st[k]) { const e = st[k]; say(e.hz, t('whyInUse', { p: t(POS[k]) })); await moveTo(e.hz, e.mode, e.filter, e.data, note); return; }
      // 記憶をまだ読んでいないバンドは、必ず読む（2026-11-15 ユーザー報告「144 MHz だけ記憶 3 つが出ない」。
      // 前は、つないでいる間に本体のキーなどで行ったバンドは、読まずにページが覚えている最後の周波数へ移っていたので、記憶のボタンが出なかった）
      const m = bandMem[code];
      // 記憶は読んであるが使用中が分からないバンドは、読み直さずに最後の周波数へ（速い）
      if (cur !== b && st && m) { say(m.hz, t('whySeen')); await moveTo(m.hz, m.mode, m.filter, m.data || 0x00, note); return; }
      const prevUse = inUse[code];
      const r = await loadStacks(b);
      if (!link) return;
      // つないでいる間に使ったバンドは、ページが覚えている最後の周波数へ戻る。その周波数と同じ記憶があれば、それを使用中にする
      // （本体のキーで出たなら、本体はそこへしまっている）。無ければ使用中は分からないので、どこにも書かない
      if (m && cur !== b) {
        const i = r ? stacks[code].findIndex((e) => e && e.hz === m.hz) : -1;
        if (i >= 0) { inUse[code] = i; saveSnap(code, stacks[code], i); } else delete inUse[code];
        say(m.hz, t('whySeen')); await moveTo(m.hz, m.mode, m.filter, m.data || 0x00, note); return;
      }
      // 今いるバンドのボタンは、記憶を読み直して下に並べるだけ（移らない）
      if (cur === b) {
        const i = r ? stacks[code].findIndex((e) => e && e.hz === curHz) : -1;
        // 今の周波数と同じ記憶があれば、それを使用中にする。無ければ使用中は分からないので、どこにも書かない（記憶をつぶさないため）
        // （前からページが使用中を覚えていれば、それをそのまま使う）
        if (i >= 0) { saveSnap(code, stacks[code], i); inUse[code] = i; } else if (prevUse != null) inUse[code] = prevUse; else delete inUse[code];
        showBand();
        return;
      }
      if (r) {
        const e = stacks[code][r.pick];
        say(e.hz, t(r.why, { p: t(POS[r.pick]) }));
        await moveTo(e.hz, e.mode, e.filter, e.data, note);
      } else { say(b.hz, t('whyDefault')); await moveTo(b.hz, null, null, null, note); }
    } catch (e) { log(t('lgSendFail', { msg: e.message })); }
  });
}
// つないだ直後に、今いるバンドの記憶 3 つを読んで Band Stacking Register を出す（2026-11-15 ユーザーの希望。
// 前はバンドボタンを押すまで出なかった）。今の周波数と同じ記憶があればそれを使用中にする（無ければ分からないので書かない）
async function readCurStacks() {
  if (!link || !shown('secBand')) return;
  // 周波数がまだ分からなければ読む（実機では、前の命令の遅れた返事などで 1 回では分からないことがあった。2026-11-15）。
  // 周波数の返事（03）だけを待ち、3 回まで読み直す
  for (let n = 0; n < 3 && !curHz && link; n++) await sendWait(civ(0x03), null, 1500, (f) => f[4] === 0x03);
  const b = curBand();
  if (!b) blog(t('blNoBand', { f: curHz ? fmtMHz(curHz) : '?' }));
  if (!b || !link) return;
  await withLoading(null, async () => {
    const r = await loadStacks(b);
    if (!link) return;
    const i = r ? stacks[b.code].findIndex((e) => e && e.hz === curHz) : -1;
    if (i >= 0) { inUse[b.code] = i; saveSnap(b.code, stacks[b.code], i); } else delete inUse[b.code];
    showBand();
  });
}
// 記憶を選ぶボタン（左・中央・右）: 今いるバンドの、その記憶の周波数・モードへ移る
async function selectStack(i) {
  const b = curBand();
  const e = b && stacks[b.code] && stacks[b.code][i];
  if (!link || locked || load.depth || !e) return;
  await withLoading(null, async () => {
    if (inUse[b.code] !== i) await writeInUse(b);   // 別の記憶を選ぶ前に、今の使用中の記憶へしまう（本体と同じ）
    if (!link || !stacks[b.code]) return;
    inUse[b.code] = i;
    saveSnap(b.code, stacks[b.code], i);
    blog(t('blMove', { v: b.name, f: fmtMHz(e.hz), why: t('whyPick', { p: t(POS[i]) }) }));
    await moveTo(e.hz, e.mode, e.filter, e.data, t('nBand', { v: b.name }));
  });
}
document.querySelectorAll('#bands button').forEach((btn) => {
  btn.addEventListener('click', () => selectBand(Number(btn.dataset.code)));
});
document.querySelectorAll('#stack button').forEach((btn, i) => {
  btn.addEventListener('click', () => selectStack(i));
});

// ---- 表示する項目（2026-11-15 ユーザーの希望。周波数・つまみ・ロック以外を隠せる） ----
// 選んだ項目は localStorage（ic705bt.hidden）に覚える。隠した項目は本体から読まない。
const SECTIONS = ['secBand', 'secDtx', 'secCw', 'secPwr', 'secFil', 'secRx'];
let hiddenSecs = [];
try { hiddenSecs = JSON.parse(localStorage.getItem('ic705bt.hidden') || '[]').filter((x) => SECTIONS.includes(x)); } catch (e) { hiddenSecs = []; }
const shown = (id) => !hiddenSecs.includes(id);
function applySections() {
  for (const id of SECTIONS) $(id).hidden = !shown(id);
  document.querySelectorAll('input[data-sec]').forEach((c) => { c.checked = shown(c.dataset.sec); });
}
document.querySelectorAll('input[data-sec]').forEach((c) => {
  c.addEventListener('change', () => {
    hiddenSecs = SECTIONS.filter((id) => (id === c.dataset.sec ? !c.checked : !shown(id)));
    try { localStorage.setItem('ic705bt.hidden', JSON.stringify(hiddenSecs)); } catch (e) { /* 覚えられなくても動く */ }
    applySections();
  });
});
applySections();

$('connect').addEventListener('click', () => connect('ble'));
$('demo').addEventListener('click', () => connect('demo'));
$('disconnect').addEventListener('click', () => { disconnect(); status('stDisconnected'); });
updateControls();
// ---- 1 列・2 列の切り替え（2026-11-15 ユーザーの希望。右上、言語のボタンの隣） ----
// 選んだほうを localStorage（ic705bt.cols に '1' か '2'）に覚える。まだ選んでいなければ、画面の幅が 900 px 以上のとき 2 列。
let colsPref = null;
try { const v = localStorage.getItem('ic705bt.cols'); if (v === '1' || v === '2') colsPref = v; } catch (e) { /* 覚えていなくても動く */ }
const wideScreen = window.matchMedia('(min-width: 900px)');
// 幅 600 px 未満（スマホの縦向き）は 2 列にすると欄が重なって使えないので、いつも 1 列にしてボタンも出さない。
const narrowScreen = window.matchMedia('(max-width: 599px)');
const twoCols = () => !narrowScreen.matches && (colsPref ? colsPref === '2' : wideScreen.matches);
function applyCols() {
  document.body.classList.toggle('cols2', twoCols());
  $('colsBtn').hidden = narrowScreen.matches;
  $('colsBtn').textContent = t(twoCols() ? 'cols1Button' : 'cols2Button');
}
$('colsBtn').addEventListener('click', () => {
  colsPref = twoCols() ? '1' : '2';
  try { localStorage.setItem('ic705bt.cols', colsPref); } catch (e) { /* 無視 */ }
  applyCols();
});
wideScreen.addEventListener('change', applyCols);
narrowScreen.addEventListener('change', applyCols);

// 日本語・英語の切り替え（このページだけ。本体の言語設定は変えない）
function renderLang() {
  applyTexts();
  applyCols();
  $('status').textContent = t(lastStatus[0], lastStatus[1]);
  updateControls();
}
$('lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'ja' : 'en';
  try { localStorage.setItem('ic705bt.lang', lang); } catch (e) { /* 無視 */ }
  renderLang();
});
if (!navigator.bluetooth) status('stNoBt'); else status('stHello');
renderLang();

// オフライン対応（sw.js）。https・localhost で開いたときだけ。zip 版（ファイルから開く）では使わない
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => log('sw: ' + e));
}
