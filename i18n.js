// 日本語・英語の切り替え（このページの表示だけ。本体の言語設定は変えない）
// 文字を足すときは、日本語と英語の両方を書く。{name} は t() に渡した値で置きかわる。
'use strict';

const TEXTS = {
  // 画面
  title:        ['IC-705 Bluetooth コントローラー', 'IC-705 Bluetooth Controller'],
  copy:         ['周波数をコピー', 'Copy frequency'],
  copyK:        ['×1000 をコピー', 'Copy ×1000'],
  copied:       ['コピーしました', 'Copied'],
  knob:         ['周波数つまみ', 'Tuning knob'],
  stepLabel:    ['1目盛り（本体の TS と連動）', 'Step (linked to TS on the radio)'],
  lockAria:     ['ロック（すべらせて切り替え）', 'Lock (slide to switch)'],
  lockOn:       ['ロック ON', 'Lock ON'],
  lockOff:      ['ロック OFF', 'Lock OFF'],
  dtxTitle:     ['RIT・ΔTX（受信または送信をずらす）', 'RIT / ΔTX (offset RX or TX)'],
  dtxAria:      ['ずらす量', 'Offset'],
  dtxOn:        ['ΔTX ON（送信をずらす）', 'ΔTX ON (TX offset)'],
  ritOnState:   ['RIT ON（受信をずらす）', 'RIT ON (RX offset)'],
  shiftOffState: ['OFF（RIT か ΔTX のボタンで ON）', 'OFF (press RIT or ΔTX to turn on)'],
  cwTitle:      ['CW', 'CW'],
  pwrTitle:     ['送信パワー', 'TX power'],
  wpm:          ['CW スピード', 'CW speed'],
  keyType:      ['キーの種類', 'Key type'],
  key0:         ['ストレート', 'Straight'],
  key1:         ['バグ', 'Bug'],
  key2:         ['パドル', 'Paddle'],
  bk:           ['ブレークイン', 'Break-in'],
  pwr:          ['送信パワー', 'RF power'],
  min:          ['最小', 'Min'],
  max:          ['最大', 'Max'],
  maxPwr:       ['今の出力制限（MAX TX PWR）', 'Current limit (MAX TX PWR)'],
  pwrSet:       ['送信パワー（RF POWER）', 'RF POWER'],
  pwrSetVal:    ['{pct} %（{w} W）', '{pct} % ({w} W)'],
  pwrActual:    ['実際の送信出力 {pct} %（{w} W）', 'Actual output {pct} % ({w} W)'],
  pwrLimited:   ['最大出力（MAX TX PWR）で制限されています', 'Limited by MAX TX PWR'],
  srcBat:       ['電源: バッテリーパック', 'Power: battery pack'],
  srcDc:        ['電源: 外部電源', 'Power: external DC'],
  filTitle:     ['モード・フィルター', 'Mode / Filter'],
  mode:         ['モード', 'Mode'],
  filWidth:     ['帯域幅（WIDTH）', 'Width'],
  filFixed:     ['このモードでは変えられません', 'Fixed in this mode'],
  rxTitle:      ['受信（P.AMP・NOTCH・NB・NR。押すたびに切り替え）', 'Receive (P.AMP / NOTCH / NB / NR: tap to switch)'],
  pamp:         ['プリアンプ（P.AMP）', 'Preamp (P.AMP)'],
  notchAuto:    ['AN（オート）', 'AN (auto)'],
  notchManual:  ['MN（マニュアル）', 'MN (manual)'],
  showTitle:    ['表示する項目', 'Sections to show'],
  showNote:     ['周波数・つまみ・ロックはいつも表示します。表示しない項目は本体から読まないので、やり取りが減ります。',
                 'Frequency, knob and lock are always shown. Hidden sections are not read from the radio, so there is less traffic.'],
  bandTitle:    ['バンド（MHz。そのバンドで最後に使った周波数・モードへ）', 'Band (MHz: goes to the last frequency and mode used on that band)'],
  loading:      ['本体から読み取り中… しばらくお待ちください', 'Reading from the radio... please wait'],
  loadingN:     ['本体から読み取り中… {n}／{total}', 'Reading from the radio... {n}/{total}'],
  lgRxRetry:    ['受信の値の返事が無かったので読み直す: {v}', 'No reply for receive values, reading again: {v}'],
  connect:      ['つなぐ', 'Connect'],
  disconnect:   ['切る', 'Disconnect'],
  demo:         ['デモ', 'Demo'],
  firstTime:    ['はじめてつなぐとき', 'First-time connection'],
  first1:       ['IC-705 の MENU → SET → Bluetooth設定 → Bluetooth を ON にする。',
                 'On the IC-705: MENU → SET → Bluetooth Set → turn Bluetooth ON.'],
  first2:       ['同じ画面の「<<相手の機器からペアリング>>」を押して待ち受けにする。',
                 'On the same screen, touch <<Pairing Reception>> to wait for pairing.'],
  first3:       ['このページの「つなぐ」を押し、「ICOM BT(IC-705)」を選ぶ。',
                 'Press "Connect" on this page and choose "ICOM BT(IC-705)".'],
  first4:       ['一度つながれば、次からは 2 の手順はいりません。', 'After the first time, step 2 is not needed.'],
  first5:       ['本体の CI-V アドレスは初期値の A4 のままにしてください（MENU → SET → 外部端子 → CI-V → CI-V アドレス）。変えているとつながりません。',
                 'Keep the CI-V address of the radio at the default A4 (MENU → SET → Connectors → CI-V → CI-V Address). Otherwise this page cannot connect.'],
  firstNote:    ['スマホやパソコンの「設定」の Bluetooth からはペアリングしないでください（このページが直接つなぎます）。',
                 'Do not pair from the Bluetooth settings of your phone or PC (this page connects directly).'],
  logTitle:     ['やり取りの記録', 'Communication log'],
  langButton:   ['English', '日本語'],

  // お知らせ（一番下の行）
  stHello:      ['「つなぐ」を押して、一覧から「ICOM BT(IC-705)」を選んでください。', 'Press "Connect" and choose "ICOM BT(IC-705)" from the list.'],
  stNoBt:       ['このブラウザは Web Bluetooth が使えません（Android の Chrome、パソコンの Chrome・Edge なら使えます）。「デモ」で画面だけ試せます。',
                 'This browser does not support Web Bluetooth (use Chrome on Android, or Chrome/Edge on a PC). You can try the screen with "Demo".'],
  errNoBt:      ['このブラウザは Web Bluetooth が使えません。Android の Chrome か、パソコンの Chrome・Edge で開いてください。',
                 'This browser does not support Web Bluetooth. Open this page in Chrome on Android, or Chrome/Edge on a PC.'],
  stConnecting: ['つないでいます…', 'Connecting…'],
  stHandshake:  ['無線機とあいさつしています…', 'Handshaking with the radio…'],
  stConnected:  ['つながりました。つまみを回すと周波数が変わります。', 'Connected. Turn the knob to change the frequency.'],
  stNoReply:    ['周波数の返事がありません。はじめての場合は、無線機を「<<相手の機器からペアリング>>」にしてからつなぎ直してください。',
                 'No reply from the radio. If this is the first time, put the radio in <<Pairing Reception>> and connect again.'],
  stNotChosen:  ['機器が選ばれませんでした。', 'No device was chosen.'],
  stFailed:     ['つなげませんでした: {msg}', 'Could not connect: {msg}'],
  stClosed:     ['切れました。', 'Disconnected.'],
  stDisconnected: ['切りました。', 'Disconnected.'],
  stNoFreq:     ['まだ周波数が分かりません。', 'The frequency is not known yet.'],
  stCopied:     ['周波数 {text} {unit} をコピーしました。ログソフトに貼り付けてください。', 'Copied {text} {unit}. Paste it into your logging software.'],

  // やり取りの記録
  lgDevice:     ['選んだ機器: {name}', 'Device: {name}'],
  lgNoName:     ['(名前なし)', '(no name)'],
  lgProps:      ['キャラクタリスティックの性質: {p}', 'Characteristic properties: {p}'],
  lgWriteOk:    ['送り方: {how}', 'Write method: {how}'],
  lgWriteNg:    ['送り方（{how}）で失敗: {msg}', 'Write method ({how}) failed: {msg}'],
  lgResp:       ['返事あり', 'with response'],
  lgNoResp:     ['返事なし', 'without response'],
  lgWhole:      ['一度に', 'whole'],
  lgChunk:      ['20 バイトずつ', '20-byte chunks'],
  errNoWrite:   ['どの送り方でも送れませんでした', 'No write method worked'],
  lgDemo:       ['デモの無線機につなぎました', 'Connected to the demo radio'],
  lgRx:         ['受信 {hex}', 'RX {hex}'],
  lgTx:         ['送信 {hex}', 'TX {hex}'],
  lgPaired:     ['ペアリングが受け付けられました', 'Pairing accepted'],
  lgKnown:      ['登録済みの機器としてつながりました', 'Connected as a registered device'],
  lgGranted:    ['CI-V を使ってよいと返事がありました', 'CI-V access granted'],
  lgNg:         ['無線機が「できません」(FA) と返しました', 'The radio replied NG (FA)'],
  lgNoGrant:    ['許可の返事（FE F1 00 64 FD）が来ませんでしたが、読んでみます', 'No access reply (FE F1 00 64 FD); trying anyway'],
  lgSendFail:   ['送れませんでした: {msg}', 'Send failed: {msg}'],
  lgClosed:     ['切断', 'Disconnected'],
  lgTs:         ['本体の TS: {v}', 'Radio TS: {v}'],
  lgTsOn:       ['{v}（▼ あり）', '{v} (▼ on)'],
  lgTsOff:      ['OFF（1 Hz）', 'OFF (1 Hz)'],
  lgOffset:     ['本体でずらす量が変わりました: {v}', 'Offset changed on the radio: {v}'],
  lgRit:        ['本体の RIT: {v}', 'Radio RIT: {v}'],
  lgDtx:        ['本体の ΔTX: {v}', 'Radio ΔTX: {v}'],

  // 送った命令の説明（記録用）
  nId:          ['(この端末の番号)', '(client ID)'],
  nName:        ['(この端末の名前)', '(client name)'],
  nToken:       ['(合図)', '(token)'],
  nTs:          ['(TS {v})', '(TS {v})'],
  nLock:        ['(ロック)', '(lock)'],
  nUnlock:      ['(ロック解除)', '(unlock)'],
  nOffset:      ['(ずらす量 {v})', '(offset {v})'],
  nOffset0:     ['(ずらす量 0 Hz。初めは 0)', '(offset 0 Hz at start)'],
  nWpm:         ['(CW スピード {v} WPM)', '(CW speed {v} WPM)'],
  nPwr:         ['(送信パワー {v} %)', '(RF power {v} %)'],
  nKey:         ['(キーの種類 {v})', '(key type {v})'],
  nBk:          ['(ブレークイン {v})', '(break-in {v})'],
  nFil:         ['(フィルター FIL{v})', '(filter FIL{v})'],
  nPbtCenter:   ['(SHIFT〔PBT〕を 0 に)', '(SHIFT [PBT] to 0)'],
  nBandSaveRead: ['({v} MHz 帯の本体の記憶を読む)', '(read radio band stack for {v} MHz)'],
  nBandSave:    ['({v} MHz 帯の本体の記憶を {f} MHz に書き直す)', '(update radio band stack for {v} MHz to {f} MHz)'],
  lgBandSaveFail: ['{v} MHz 帯の本体の記憶を書き直せませんでした', 'Could not update the radio band stack for {v} MHz'],
  nBand:        ['({v} MHz 帯へ)', '(to {v} MHz band)'],
  nBandRead:    ['({v} MHz 帯で最後に使った周波数を読む)', '(read last frequency on {v} MHz band)'],
  nMode:        ['(モード {v})', '(mode {v})'],
  nWidth:       ['(帯域幅 {v})', '(width {v})'],
};

let lang = 'ja';
try { if (localStorage.getItem('ic705bt.lang') === 'en') lang = 'en'; } catch (e) { /* 保存できなくても動く */ }

function t(key, vars) {
  const pair = TEXTS[key];
  let s = pair ? pair[lang === 'en' ? 1 : 0] : key;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

// data-i18n="キー" の部品の文字、data-i18n-aria="キー" の部品の読み上げ名を今の言語にする
function applyTexts() {
  document.documentElement.lang = lang;
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}
