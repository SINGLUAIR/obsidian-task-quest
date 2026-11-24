# Task Quest（Obsidian プラグイン）

タスクを完了するとレベルが上がる、ゲーム風のタスク管理プラグインです。
Obsidian のサイドバー（またはタブ）にタスク一覧を表示します。

## 機能

- **タスク入力フォーム**：タイトル／概要／タスク分解（項目を自由に追加・削除）／優先順位（低・中・高・緊急）／締め切り日
- **カード表示**：1タスク＝1枠。タスク分解の項目にチェックボックス、進捗を % のゲージで表示
- **並び順**
  1. 「緊急」は締め切りに関係なく常に一番上（枠が赤くなる）
  2. それ以外は **締め切りが近い順**
  3. 締め切りが同じ日なら **優先順位が高い順**（高 → 中 → 低）
  4. 締め切りなしのタスクは、締め切りありのタスクの後ろ
- **締め切りアラート**：締め切りの 5 日前（超過を含む）から、締め切り日の文字が赤く・大きくなる
- **タスク完了**：全てのチェックを付けると「タスク完了！」ポップアップが出て、タスクが消え、完了数がカウントされる
  （タスク分解が 0 件のタスクには「✓ 完了」ボタンを表示）
- **レベルシステム**：Lv0→1 は 10 件、Lv1→2 は 11 件、Lv2→3 は 12 件…と、必要数が 1 件ずつ増える。
  現在のレベル・累計完了数・次のレベルまでのゲージを表示し、レベルアップ時はポップアップでお知らせ
- **編集・削除**：鉛筆アイコンで編集（文字を変えていない項目はチェック状態を維持）、ゴミ箱アイコンで削除（確認あり）
- **保存**：データは Vault 内の `.obsidian/plugins/obsidian-task-quest/data.json` に保存（外部 API は使いません）
- **UI**：Obsidian のダークテーマに合わせた黒地 × 紫ボタン

## インストール方法（Mac）

### 0. 事前準備

- [Node.js](https://nodejs.org/)（LTS 版）をインストール
- [Git](https://git-scm.com/) が使えること（ターミナルで `git --version` が動けば OK。無ければ案内に従って Xcode Command Line Tools を入れてください）
- Obsidian で **テスト用の Vault** を作り、`設定 → コミュニティプラグイン` で **制限モードをオフ** にする

### 1. プラグインフォルダにクローン

ターミナルを開いて、以下を実行します（`<Vaultのパス>` は自分の Vault の場所に置き換えてください）。

```bash
cd "<Vaultのパス>/.obsidian/plugins"
# plugins フォルダが無ければ先に作る:  mkdir -p "<Vaultのパス>/.obsidian/plugins"
git clone https://github.com/SINGLUAIR/obsidian-task-quest.git
cd obsidian-task-quest
```

> ヒント：Finder で Vault フォルダを開き、`Command + Shift + .` で隠しフォルダ（`.obsidian`）を表示できます。
> ターミナルに `cd ` と打ってからフォルダをドラッグ＆ドロップするとパスが入力されます。

### 2. 依存関係のインストールとビルド

```bash
npm install
npm run build
```

`main.js` が生成されれば成功です。

### 3. Obsidian で有効化

1. Obsidian を再起動（または `設定 → コミュニティプラグイン` の再読み込みボタン）
2. `設定 → コミュニティプラグイン → インストール済みプラグイン` で **Task Quest** をオンにする
3. 左のリボンのチェックリストアイコン、またはコマンドパレット（`Cmd + P`）の「Task Quest: タスク一覧を開く」で表示

### 更新するとき

```bash
cd "<Vaultのパス>/.obsidian/plugins/obsidian-task-quest"
git pull
npm install
npm run build
```

## VS Code での開発方法

1. VS Code で `<Vaultのパス>/.obsidian/plugins/obsidian-task-quest` フォルダを開く
2. VS Code のターミナル（`` Ctrl + ` ``）で以下を実行（ファイル保存のたびに自動ビルドされます）

   ```bash
   npm run dev
   ```

3. `main.ts` や `styles.css` を編集して保存
4. Obsidian でコマンドパレット（`Cmd + P`）→「アプリを再読み込み（Reload app without saving）」で反映
   - コミュニティプラグイン [Hot-Reload](https://github.com/pjeby/hot-reload) を入れると自動で再読み込みされて便利です
5. エラーは Obsidian の開発者ツール（`Cmd + Option + I`）の Console で確認できます
6. 完成したら `npm run build`（型チェック付きの本番ビルド）で確認

### ファイル構成

| ファイル | 役割 |
| --- | --- |
| `main.ts` | プラグイン本体（ビュー・フォーム・並び替え・レベル計算など） |
| `styles.css` | 見た目（黒地 × 紫テーマ） |
| `manifest.json` | プラグイン情報（ID・名前・バージョン） |
| `esbuild.config.mjs` | ビルド設定（`main.ts` → `main.js`） |
| `package.json` / `tsconfig.json` | npm スクリプトと TypeScript 設定 |
| `versions.json` | プラグインのバージョンと対応 Obsidian バージョン |

`main.js` はビルドで生成されるファイルなので Git には含めていません。

## ライセンス

MIT
