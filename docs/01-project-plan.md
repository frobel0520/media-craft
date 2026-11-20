# 01 — Project Plan（media-craft）

- **專案名稱**：`media-craft`（多媒體微服務中心 / 本地多媒體工作台）
- **專案級別**：公開級（純靜態 Web App + Rust WebAssembly，無後端、無資料庫、無帳號登入）
- **目標網址**：GitHub Pages（`https://frobel0520.github.io/media-craft/`）或 Cloudflare Pages（零月費）
- **建立日期**：2026-11-20

## 1. 問題定義與核心價值

日常使用線上圖片壓縮、格式轉換或去 EXIF 網站時，使用者必須將個人照片或敏感截圖上傳至陌生第三方伺服器，存在極高的隱私外洩風險，且常有檔案數量／大小限制與廣告干擾。

`media-craft` 旨在打造一個 **100% 瀏覽器本地執行、可由 CSP 驗證零上傳** 的模組化多媒體處理中心：
- **核心引擎採用 Rust 編譯為 WebAssembly（`wasm32-unknown-unknown`）**，提供安全、低記憶體、高效能的二進位中繼資料解析、無損 EXIF/GPS 剝離與本地 ZIP 打包。
- **硬體加速像素編碼搭配 Web Worker**，讓批次壓縮、尺寸縮放與 WebP/JPEG/PNG 格式轉換在背景執行，完全不阻塞主執行緒 UI。
- **架構面向多模組擴充**：Phase 1 專注於圖片工作台（Image Workbench），未來可平滑新增音訊、GIF、SVG 或 PDF 本地工具。

## 2. 階段規劃

### Phase 1（MVP — 本次實作）
1. **Rust 核心庫（`crates/media-core`）**：
   - 二進位格式偵測與標頭尺寸解析（JPEG、PNG、WebP、GIF、BMP）。
   - 隱私雷達：解析 JPEG Exif/TIFF IFD（相機廠牌型號、拍攝時間、軟體、GPS 座標存在性）、XMP、IPTC、COM，以及 PNG `eXIf`/`tEXt`/`iTXt`/`zTXt`/`tIME` 與 WebP `EXIF`/`XMP ` chunk。
   - 無損二進位中繼資料剝離（JPEG / PNG / WebP），不重新編碼影像像素即可 100% 清除隱私中繼資料。
   - 零相依 ZIP 封裝器（IEEE 802.3 CRC-32），供批次處理結果一鍵打包下載。
2. **Rust WASM 橋接層（`crates/media-wasm`）**：
   - 編譯為單一極輕量 `.wasm`（無額外肥大依賴），輸出 `inspect_image`、`strip_metadata`、`zip_create/add/finish` 等記憶體安全介面。
3. **Web 前端工作台（`web/`）**：
   - 支援拖放／多檔選取、批次處理佇列。
   - 模式切換：**壓縮與轉檔（WebP / JPEG / PNG + 品質滑桿 + 最大寬度縮放）** 與 **無損去 EXIF（保留原始畫質）**。
   - **Before / After 左右拖曳對比檢視**、壓縮前後大小與節省百分比統計、隱私標籤清除報告。
   - 完整 `light` / `dark` 深淺色模式、`375px` 手機與 `1280px` 桌面 RWD 零水平溢位、嚴格 `<meta>` CSP（`connect-src 'none'`）。

### Phase 2（後續可擴充模組）
- 進階影像工具（圖片裁切、浮水印、Favicon／PWA 圖示組一鍵生成）。
- 音訊輕量剪輯與 WAV/MP3 轉換。
- SVG 清理最佳化。

## 3. 驗收標準
- `cargo test`：Rust 核心所有格式偵測、EXIF 解析、JPEG/PNG/WebP 無損剝離與 ZIP 打包單元測試 100% 通過。
- `cargo build --target wasm32-unknown-unknown --release`：成功產出 `.wasm` 並整合進 `web/public/wasm/media_wasm.wasm`。
- 前端建置（`npm run build`）與自動化測試全綠；Headless Chromium 在 `1280×800` 與 `375×812`（light/dark）實測 0 水平溢位、0 console error、0 CSP violation。
