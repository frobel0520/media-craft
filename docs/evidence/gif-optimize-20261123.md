# GIF 最佳化驗收

2026-11-23，Harbor 任務 `aa104868`。本機 Windows x64、Headless Chromium，測試 Rust 1.100.0 的正式瀏覽器 WASM 與合成 GIF。優化移除註解並重新分組 LZW 資料，保留影格編碼、調色盤、透明與動畫控制。

- 1280 × 800 與 375 × 812 都完成檔案輸入、最佳化與下載。兩影格 64 × 40 樣本由 18,352 bytes 降至 278 bytes，Pillow 逐影格解碼確認 RGBA 像素、尺寸、80／120 ms、循環 2 次一致。
- 重傳已精簡檔提供原檔下載。截斷檔會顯示錯誤。兩種寬度未觀察到水平溢位、第三方請求、CSP 違規或頁面例外。
- 從合成選檔到最佳化下載按鈕就緒，共 20 次，p50 18.7 ms、p95 47.9 ms，低於本機合成樣本的 1 秒 p95 門檻。
- Clippy、`wasm32-unknown-unknown` release、TypeScript 與 SPA 建置通過。Rust workspace 21 項測試在 Node WASI 通過。Windows native linker 因缺 SDK 的 `kernel32.lib` 未能執行，正式環境與本機實體手機尚待驗。
