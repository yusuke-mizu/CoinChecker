# Coin Checker

BTCC掲載のUSDT銘柄を動的に取得し、4H / 1H / 15M のテクニカル指標から **LONG / SHORT を別々に採点**する、読み取り専用の判断支援ツールです。

自動売買・注文・決済・ポジション操作は実装していません。分析結果はメモリ上のみで、DBには保存しません。

## できること

- BTCC USDT銘柄の動的取得（CoinGecko）と、OHLCV取得可能なOKX USDT SWAPとの交差
- 全銘柄のバッチ分析（1銘柄失敗でも全体は止まらない）
- TOP LONG / TOP SHORT
- ソート可能な一覧（価格、24h、スコア、トレンド、RSI、MACD、ADX、出来高、BTC相関、判定）
- 行クリックでスコア内訳と Lightweight Charts（自前OHLCV）
- MARKET RISK 0–100（警告のみ。自動停止はしない）
- BTCドミナンス（CoinGecko `/global`）
- 自動更新 5 / 15 / 30分 / OFF

## 調査結果（データソース）

### BTCC公式API

- TradeOpenAPI: REST `https://api1.btloginc.com:9081`
  - 銘柄一覧 `GET /v1/config/symbollist` は login token + 署名が必要
  - 発注・建玉・決済系エンドポイントあり → **未使用**
- Quote WebSocket `wss://kapi1.btloginc.com:9082` の `ReqKline` も認証必須

### TradingView

- 公開のテクニカルREST APIはない
- 利用規約でスクレイピング禁止
- Lightweight Charts（Apache-2.0）は **自前OHLCVの描画のみ**

### 本アプリが使う公開データ

| 役割 | ソース |
| --- | --- |
| BTCC USDT銘柄一覧 | CoinGecko `GET /exchanges/btcc/tickers` |
| OHLCV / 24h / 銘柄交差 | OKX public SWAP |
| BTCドミナンス | CoinGecko `GET /global` |
| 指標 | 自前計算（EMA / RSI / MACD / ADX） |

OKX candles のレート制限: **20 req / 2s**。そのため全銘柄はクライアントから `/api/analyze-batch` を分割呼び出しします。

DXY / NASDAQ / 米10年 / ETF は公式の無料APIを配線していないため、市場環境スコアでは 0 点（理由を表示）です。

## ローカル起動

```bash
cd coin-checker
npm install
copy .dev.vars.example .dev.vars
npm run dev
```

ブラウザで http://localhost:3000 を開き、「分析開始」を押します。全銘柄は数分かかることがあります。

## GitHub

このディレクトリ（`coin-checker/`）が Git リポジトリです。ホームディレクトリの Git とは別です。初回コミット済みで、remote `origin` は `https://github.com/yusuke-mizu/CoinChecker.git` を指しています。

GitHub CLI は入っていますが、まだログインしていません。次を実行してください。

```bash
gh auth login
git push -u origin main
```

まだ GitHub 上にリポジトリが無い場合（`Repository not found`）:

```bash
gh auth login
gh repo create CoinChecker --private --source=. --remote=origin --push
```

## Cloudflare（どこからでも見る準備）

このアプリは静的サイトではありません。`/api/*` の Route Handler があるため、**Cloudflare Pages（output: `dist`）では動きません。** OpenNext で **Workers** にデプロイします。

Workers Builds のデフォルト `npm run build` は OpenNext です（`next build` だけだと `.open-next` が無く、`wrangler deploy` が失敗します）。

Pages で `dist` を探す設定は使わないでください。

### 1. 初回デプロイ（手元）

```bash
npx wrangler login
npm run deploy
```

成功すると `https://coin-checker.<あなたのサブドメイン>.workers.dev` で公開されます。

### 2. GitHub からの自動デプロイ

**Pages プロジェクトは使わないでください。** 失敗ログに `pages_build_output_dir` や `Output directory "dist"` が出ていたら、それは Pages です。そのプロジェクトは削除するか切断し、Worker を作り直します。

**A. Cloudflare Dashboard（Workers Builds）**

1. Workers & Pages → **Create** → **Workers**（Pages ではない）
2. Connect GitHub でこのリポジトリを選ぶ
3. ビルド設定:

| 項目 | 値 |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/`（リポジトリ直下） |
| Output directory | 空のまま（`dist` にしない） |

**B. GitHub Actions**（`.github/workflows/deploy.yml`）

リポジトリ Secrets:

- `CLOUDFLARE_API_TOKEN` … Workers の Edit 権限がある API トークン
- `CLOUDFLARE_ACCOUNT_ID` … ダッシュボード右サイドバーの Account ID

`main` への push で `npm run deploy` が走ります。

### 補足

- `export const runtime = "edge"` は使いません（OpenNext 未対応）
- キャッシュ用 R2 は未接続です（ISR は使っていないため）
- Workers から CoinGecko / OKX へ外向き fetch します。APIキーは不要です
