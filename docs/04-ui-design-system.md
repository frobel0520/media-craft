# 04 — UI Design System（GCP × iOS）

本文件定義 `media-craft` 全站共通的視覺風格與無障礙設計規範，作為 Phase 1 圖片工作台與未來 Phase 2 多媒體模組（SVG、Favicon、音訊、GIF 等）的統一設計基準。

## 1. 設計原則

1. **GCP Console 的結構清晰**：中性灰白表面分層、明確的單一品牌主色、語意化狀態膠囊、低干擾的工具列與摘要資訊。
2. **iOS HIG 的溫潤直覺**：克制留白與呼吸感、大圓角卡片、分段控制器（Segmented Control）、分組清單（Grouped List）與自然觸控回饋。
3. **無障礙優先（WCAG AA+）**：不單靠顏色傳達資訊、所有互動元件最小觸控高度 `44px`、明顯的鍵盤 `:focus-visible` 外框、尊重 `prefers-reduced-motion`。

## 2. 色彩與表面分層（Design Tokens）

| Token | Light（淺色） | Dark（深色） | 用途 |
| --- | --- | --- | --- |
| `--bg` | `#F5F5F7` | `#0F1115` | 畫布底色（iOS Grouped 背景） |
| `--surface` | `#FFFFFF` | `#1C1F26` | 主要卡片與面板表面 |
| `--surface-subtle` | `#F1F3F4` | `#262A34` | 次要容器、分段控制器槽底、輸入區 |
| `--border` | `rgba(15, 23, 42, 0.09)` | `rgba(255, 255, 255, 0.11)` | 卡片與元件邊框 |
| `--text` | `#1F1F1F` | `#F1F3F4` | 主要文字（對比度 `> 12:1`） |
| `--text-muted` | `#5F6368` | `#9AA0A6` | 次要說明文字（對比度 `> 5.5:1`） |
| `--accent` | `#1A73E8` | `#8AB4F8` | 品牌主色（GCP Blue），用於主要 CTA、選中態與焦點環 |
| `--accent-hover` | `#1557B0` | `#AECBFA` | 主色 hover 態 |
| `--ok` | `#137333` | `#81C995` | 成功、安全、節省體積、WASM 就緒 |
| `--warn` | `#B06000` | `#FDD663` | 隱私警示（GPS / EXIF 偵測） |
| `--danger` | `#C5221F` | `#F28B82` | 錯誤訊息與危險操作 |

## 3. 排版與幾何系統

- **字體**：`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Noto Sans TC', system-ui, sans-serif`
- **數字對齊**：檔案大小、尺寸、節省百分比與耗時一律套用 `font-variant-numeric: tabular-nums`。
- **圓角層級**：
  - 面板／卡片／Modal：`16px`（`--radius-lg`）
  - 按鈕／輸入框／分段選項：`10px`（`--radius-md`）
  - 膠囊狀態標籤：`999px`（`--radius-pill`）
- **間距節奏**：以 `4px` 為基準單位（`8 / 12 / 16 / 20 / 24px`）。

## 4. 工作台骨架與元件語言（Canva × Photoshop × iOS）

- **上方欄（Top Application Bar，單層 `56px`）**：半透明毛玻璃背景（`backdrop-filter: saturate(180%) blur(16px)`），左側為側邊欄切換鈕＋多彩科技光圈 Icon＋`media-craft / 模組名`；右側為 WASM 零上傳狀態膠囊＋`系統 / 淺色 / 深色` 三段式主題切換（預設跟隨系統）。
- **左側導覽欄（Collapsible Sidebar）**：
  - 桌面版（`>= 960px`）：支援展開（`232px`，圖示＋名稱＋狀態）與收合窄軌（`72px`，Canva / Photoshop 風格純圖示＋tooltip）一鍵切換，狀態持久化於 `localStorage`。
  - 行動版（`< 960px`）：自動轉為滑出式抽屜（Drawer + 半透明遮罩 + `Escape` 關閉），確保 `375px` 零水平溢位。
- **模式切換（Segmented Control）**：iOS 分段控制器槽底（`--surface-subtle`）配純白懸浮選中卡（`--surface` + 微陰影 + 主色指示）。
- **拖放區（Dropzone）**：柔和虛線框、清楚單一步驟引導，拖入時切換為主色淡底高亮。
- **任務佇列（Grouped List）**：卡片化分組清單，左側圓角縮圖、中央資訊與狀態膠囊、右側對齊操作按鈕。

## 5. 無障礙驗收基準

- 所有按鈕、輸入框、下拉選單與頁籤最小高度 `>= 44px`（行動裝置與桌面一致好點）。
- 鍵盤焦點一律顯示 `2px solid var(--accent)`（`outline-offset: 2px`）。
- 動態統計與處理狀態標記 `aria-live="polite"`；錯誤訊息標記 `role="alert"`。
- `@media (prefers-reduced-motion: reduce)` 下關閉所有過渡與微動畫。
