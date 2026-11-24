# 靜態 SEO 與分享中繼資料驗收

2026-11-23，Harbor 任務 `681b4cdd`。以 `1298b44` 為基準完成本機 Windows x64／Node 24.22.1 建置。新增資料沿用單一正式入口 `https://media-craft.pages.dev/`。

- `npm run build` 通過。Chromium 從產物讀出 canonical、OG 網址與可解析的 `WebApplication` JSON-LD，讀取 robots、sitemap、llms 與分享圖均為 HTTP 200。
- XML 解析確認 sitemap 僅列首頁，robots 指向同一個 sitemap。Pillow 完整解碼 1200 × 630、91,246 bytes 的 OG PNG。既有 manifest 連結仍在。
- 加入後 HTML 為 2.88 kB（gzip 1.21 kB）。分享圖只在中繼資料引用，未增加頁面程式碼、樣式或任何外部服務。正式站索引／快取實際結果待部署後驗證。
