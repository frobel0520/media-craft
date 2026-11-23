# media-craft

100% 瀏覽器本地執行的 **Rust + WebAssembly 多媒體工作台**（多媒體微服務中心）——支援圖片壓縮、格式轉換（WebP / JPEG / PNG）、尺寸縮放、隱私雷達（EXIF / GPS / 相機資訊偵測）、無損二進位去 EXIF 與批次打包下載 ZIP。

所有處理皆在您的裝置瀏覽器背景（Web Worker + Rust WASM）完成，HTML 嚴格鎖定 `connect-src 'self'` CSP，**檔案絕不上傳至任何外部伺服器**。

## 架構概覽

- **`crates/media-core`**（`#![forbid(unsafe_code)]`，零外部相依）：
  - Magic-byte 格式偵測與標頭尺寸解析（JPEG / PNG / WebP / GIF / BMP）。
  - TIFF/EXIF IFD 解析器（相機廠牌型號、拍攝時間、軟體、GPS 座標偵測）與 PNG/WebP 中繼資料掃描。
  - 無損二進位中繼資料剝離（JPEG / PNG / WebP，0% 重新編碼畫質損失）。
  - 零相依 ZIP 封裝器（IEEE 802.3 CRC-32）。
  - SVG 安全清理與最佳化（移除腳本、事件屬性、外部引用、DOCTYPE／實體、註解與編輯器資料，保留 viewBox）。
- **`crates/media-wasm`**：
  - 編譯為極輕量 `wasm32-unknown-unknown`（~47 KB）供瀏覽器直接載入。
- **`web/`**（Vite + React + TypeScript）：
  - Web Worker 非同步執行 Rust WASM + 硬體加速 `OffscreenCanvas` 圖片壓縮與轉檔。
  - Before / After 左右拉桿對比、深淺色雙主題、375px 手機與 1280px 桌面響應式版面。

## 本機開發與建置

```bash
# 1. 執行 Rust 單元測試
cargo test --workspace

# 2. 編譯 Rust WASM 核心並複製至前端 public 目錄
rustup target add wasm32-unknown-unknown
cargo build -p media-wasm --target wasm32-unknown-unknown --release
mkdir -p web/public/wasm
cp target/wasm32-unknown-unknown/release/media_wasm.wasm web/public/wasm/media_wasm.wasm

# 3. 啟動前端開發伺服器或建置正式版
cd web
npm ci
npm run dev
# 或 npm run build
```

## 文件

- 專案計畫：[`docs/01-project-plan.md`](docs/01-project-plan.md)
- 系統設計：[`docs/03-system-design.md`](docs/03-system-design.md)
