# IC-705 Bluetooth コントローラー (for CW)

**▶ 使う（公開ページ）: https://nqf18003.github.io/ic705-bt-controller/**

**⬇ ダウンロード（パソコン用 zip。インターネットが無くても使える）: https://github.com/nqf18003/ic705-bt-controller/releases/latest**

[English is below](#ic-705-bluetooth-controller-for-cw)

Icom IC-705 に Bluetooth（BLE）で接続し、ブラウザーから操作するシンプルなウェブページです。インストールは要りません。

## 使えるもの
- Android の Chrome、パソコンの Chrome・Edge（Web Bluetooth に対応したブラウザー）
- iPhone・iPad の Safari は Web Bluetooth に対応していないので使えません。

## できること
- 周波数の表示・コピー、つまみで周波数を合わせる（本体の TS と連動）、ダイヤルロック
- バンドの切り替え。本体がバンドごとに持つ 3 つの記憶（バンドスタッキングレジスター）を読み、バンドボタンの下に並べます。押すと、その周波数・モードへ移ります
  （本体が最後に使った記憶がどれかは読めないので、違うときは 3 つから選んでください。記憶を読むのに 1 バンド 3 秒ほどかかります）
  ページのボタンでバンドや記憶を移る前に、今の周波数・モードを使用中の記憶へしまいます（本体のバンドキーと同じ動き。本体の使用中の印はページから動かせないので、本体のバンドキーと混ぜて使うと、呼ばれる記憶がずれることがあります）
- RIT・ΔTX（±500 Hz）
- CW: スピード・キーの種類・ブレークイン
- モールスの文章を送る: 入力欄の文と、定型文 4 つ（M1〜M4。押すとすぐ送る）。本体のキーヤーが送信します（モードが CW・CW-R のとき。本当に電波が出ます。
  ブレークインが OFF のときは、本体の仕様でサイドトーンだけになり、電波は出ません）
- 送信出力（今の出力制限も表示）
- モード・フィルター（FIL1〜3・帯域幅）
- 受信: P.AMP・NOTCH・NB・NR
- 日本語・英語の切り替え、表示する項目の選択
- 広い画面（パソコン・タブレット・スマホの横向き）では 2 列に並べられます（右上のボタンで 1 列・2 列を切り替え）

## はじめて接続するとき
1. IC-705 の MENU → SET → Bluetooth設定 → Bluetooth を ON にする。
2. 同じ画面の「<<相手の機器からペアリング>>」を押して待ち受けにする。
3. このページの「接続」を押し、「ICOM BT(IC-705)」を選ぶ。
4. 一度接続できれば、次からは 2 の手順はいりません。

- スマホやパソコンの「設定」の Bluetooth からはペアリングしないでください（このページが直接接続します）。
- 本体の CI-V アドレスは初期値の A4 のままにしてください（MENU → SET → 外部端子 → CI-V → CI-V アドレス）。
- IC-705 がペアリングを覚えられる Bluetooth LE の機器は 2 台までです（本体の仕様。このページも Bluetooth LE で接続します）。
  3 台目が接続できないときは、本体の MENU → SET → Bluetooth設定 → ペアリング/接続 で、使わない機器を削除してからやり直してください。
- 「デモ」ボタンで、無線機が無くても画面を試せます。

## インターネットにつながらない所で使うには（オフライン）
山の上など、インターネットにつながらない所で使う方法は 2 つあります。

**A. ホーム画面に追加する（スマホ・タブレット・パソコン）**
1. インターネットにつながる所で、公開ページを Chrome で開きます。
2. Chrome のメニュー（︙）→「ホーム画面に追加」または「アプリをインストール」を押します（ストアからアプリを入れるわけではありません）。
3. 次からは、ホーム画面（パソコンはデスクトップなど）のアイコンから開きます。インターネットにつながらなくても開けます。
- インターネットにつながっているときに開くと、新しい版に自動で入れ替わります。

**B. zip をダウンロードする（パソコンだけ）**
1. [Releases](https://github.com/nqf18003/ic705-bt-controller/releases/latest) から `ic705-bt-controller-….zip` をダウンロードします。
2. zip を右クリック →「すべて展開」で展開します。
3. できたフォルダの中の `index.html` をダブルクリックして、Chrome か Edge で開きます。
- フォルダの中のファイルは、ばらばらにしないでください。
- 定型文などは、公開ページとは別に保存されます。
- 自動では新しい版になりません。新しい版は、もう一度ダウンロードしてください。
- スマホ・タブレットでは、zip 版は使えません（ダウンロードしたファイルからは Bluetooth が使えないため）。A の方法を使ってください。

## 本体で設定を変えたときは、少し待ってから操作してください
このページは本体の状態を順番に読みに行っているので、**本体のつまみやボタンで変えた設定が、ページの表示に出るまで少し時間がかかります**。
表示が変わる前にページで続けて操作すると、古い値のまま動くことがあります。本体で変えたら、ページの表示が変わるのを待ってから操作してください。
- 周波数・RIT/ΔTX のずらす量: すぐ（約 0.25 秒）
- モード・CW スピード・送信出力・帯域幅: 約 1 秒
- ロック・1目盛り（TS）・RIT/ΔTX の ON/OFF・ブレークイン・キーの種類・P.AMP・NOTCH・NB・NR など: 数秒（目安 4〜5 秒）
- 「表示する項目」で使わない欄を隠すと、読むものが減って少し速くなります。
- ページのボタンで変えたときは、ページの表示がすぐ変わります（本体へもすぐ送ります）。

## データの行き先
- 無線機とのやり取りは Bluetooth で接続した IC-705 とだけ行います。インターネットへは何も送りません。外部のスクリプトも読み込みません。
- ブラウザーの中に覚えるもの: 機器の識別番号（ランダムな文字列。無線機が相手を見分けるため）・言語・表示する項目・1 列か 2 列か・
  前に読んだバンドの記憶の周波数（次に接続したときに、どの記憶が変わったかを見分けるため）・CW の定型文と入力欄の文。
- オフラインで開けるように、このページのファイル（HTML・プログラム・アイコン）を端末の中に取っておきます（Service Worker）。ほかのサイトのファイルは取りに行きません。

## ご注意
- 個人が作ったもので、Icom とは関係ありません。使うときは自己責任でお願いします。
- 無線機との BLE の接続のしかたは、公開されている SatHunter と K7MDL2 の IC-705-BLE-Serial-Example を参考にしました。

---

# IC-705 Bluetooth Controller (for CW)

**▶ Open the page: https://nqf18003.github.io/ic705-bt-controller/**

**⬇ Download (zip for PC, works without internet): https://github.com/nqf18003/ic705-bt-controller/releases/latest**

A simple web page that connects to an Icom IC-705 over Bluetooth LE and controls it from the browser. No installation needed.

## Requirements
- Chrome on Android, or Chrome / Edge on a PC (browsers with Web Bluetooth)
- Safari on iPhone / iPad does not support Web Bluetooth.

## Features
- Frequency display and copy, tuning knob (follows the TS of the radio), dial lock
- Band buttons. The page reads the three band stacking registers of the radio for that band and shows them under the band buttons; press one to go to that frequency and mode
  (the radio does not tell which register was used last, so pick one of the three if needed; reading takes about 3 seconds per band)
  Before moving to another band or register with the page, the page stores the current frequency and mode into the register in use (like the band key of the radio). The page cannot move the in-use mark of the radio, so mixing the page and the band key of the radio may recall a different register
- RIT / ΔTX (±500 Hz)
- CW: speed, key type, break-in
- Send CW messages: type a message, or use 4 presets (M1-M4, sent at once). The keyer of the radio transmits it (in CW / CW-R mode; this really transmits.
  With break-in OFF the radio only plays the sidetone and does not transmit)
- TX power (also shows the current power limit)
- Mode and filter (FIL1-3, width)
- Receive: P.AMP, NOTCH, NB, NR
- Japanese / English, choose which sections to show
- Two-column layout on wide screens (PC, tablet, phone in landscape); switch 1 / 2 columns with the button at the top right

## First connection
1. On the IC-705: MENU → SET → Bluetooth Set → turn Bluetooth ON.
2. On the same screen, touch <<Pairing Reception>> to wait for pairing.
3. Press "Connect" on this page and choose "ICOM BT(IC-705)".
4. After the first time, step 2 is not needed.

- Do not pair from the Bluetooth settings of your phone or PC (this page connects directly).
- Keep the CI-V address of the radio at the default A4 (MENU → SET → Connectors → CI-V → CI-V Address).
- The IC-705 can keep only 2 Bluetooth LE devices paired (a limit of the radio; this page uses Bluetooth LE).
  If a third device cannot connect, delete an unused device in MENU → SET → Bluetooth Set → Pairing/Connect, then try again.
- The "Demo" button lets you try the page without a radio.

## Using without internet (offline)
There are two ways to use the page where there is no internet, such as on a mountain.

**A. Add to Home screen (phone, tablet, PC)**
1. Where you have internet, open the public page in Chrome.
2. Choose Chrome menu (⋮) → "Add to Home screen" or "Install app" (this does not install anything from an app store).
3. From then on, open it from the icon (on a PC, on the desktop etc.). It opens even without internet.
- When opened with internet, it updates to the new version automatically.

**B. Download the zip (PC only)**
1. Download `ic705-bt-controller-….zip` from [Releases](https://github.com/nqf18003/ic705-bt-controller/releases/latest).
2. Right-click the zip → "Extract All".
3. Double-click `index.html` in the extracted folder and open it with Chrome or Edge.
- Keep all files in the folder together.
- Presets are stored separately from the public page.
- It does not update by itself. Download it again for a new version.
- The zip version does not work on phones and tablets (Bluetooth is not available for downloaded files there). Use A instead.

## After changing a setting on the radio, wait a moment
This page reads the state of the radio one item at a time, so **a change made with the knobs or buttons of the radio takes a little time to appear on the page**.
If you operate the page before the display updates, it may act on the old value. After changing something on the radio, wait until the page shows it.
- Frequency, RIT/ΔTX offset: almost at once (about 0.25 s)
- Mode, CW speed, TX power, width: about 1 s
- Lock, step (TS), RIT/ΔTX on/off, break-in, key type, P.AMP, NOTCH, NB, NR, etc.: a few seconds (about 4-5 s)
- Hiding unused sections in "Sections to show" reduces the reading and makes it a little faster.
- When you change something with the buttons of the page, the page updates at once (and sends it to the radio at once).

## Where data goes
- The page talks only to the IC-705 connected over Bluetooth. Nothing is sent to the internet, and no external scripts are loaded.
- Stored in the browser: a device ID (a random string, so the radio can recognize this page), language, which sections to show, 1 or 2 columns,
  the band stack frequencies read last time (to tell which register changed at the next connection), and the CW presets and message.
- To open offline, the files of this page (HTML, program, icons) are kept on the device (Service Worker). Files of other sites are not fetched.

## Notes
- This is a personal project and is not affiliated with Icom. Use at your own risk.
- The BLE connection method is based on the public SatHunter and K7MDL2 IC-705-BLE-Serial-Example projects.
