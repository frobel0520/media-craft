# 03 — System Design（media-craft）

## 1. 整體架構（Zero-Upload Client-Side Pipeline）

```text
[User Browser (Main Thread — React / TypeScript UI)]
   │  File / Blob (ArrayBuffer) — never leaves device
   ▼
[Dedicated Web Worker (src/workers/media.worker.ts)]
   ├── 1. Rust WASM: inspect_image(bytes)
   │      -> Format, Width×Height, EXIF/GPS/XMP/Camera/Software tags
   ├── 2a. Mode = "lossless-strip"
   │      -> Rust WASM: strip_metadata(bytes) (zero pixel re-encoding)
   ├── 2b. Mode = "compress-convert"
   │      -> createImageBitmap + OffscreenCanvas (resize + WebP/JPEG/PNG encode)
   │      -> Rust WASM: inspect_image(output) (verify 0 metadata leakage)
   └── 3. Batch Export
          -> Rust WASM: zip_begin / zip_add_file / zip_finish -> .zip Blob
```

## 2. Rust Workspace 模組設計

- **`crates/media-core`**（`#![forbid(unsafe_code)]`，零外部相依）
  - `format.rs`：Magic bytes 偵測與標頭解析（JPEG SOF0/SOF2、PNG IHDR、WebP VP8/VP8L/VP8X、GIF、BMP）。
  - `exif.rs`：TIFF Header（Little/Big Endian `II`/`MM`）與 IFD0 / ExifIFD / GPSIFD 解析器，萃取 `Make`、`Model`、`Software`、`DateTime`、`DateTimeOriginal` 與是否含 `GPS` 座標。
  - `strip.rs`：
    - `strip_jpeg()`：保留 `SOI`、`APP0`（JFIF）、`DQT`、`DHT`、`DRI`、`SOF*`、`SOS`..`EOI`；移除 `APP1`–`APP15`（EXIF/XMP/IPTC/ICC）與 `COM`。
    - `strip_png()`：保留關鍵區塊（`IHDR`、`PLTE`、`IDAT`、`IEND`）與視覺必要區塊（`tRNS`、`sRGB`、`gAMA`、`cHRM`、`acTL`/`fcTL`/`fdAT`）；移除 `eXIf`、`tEXt`、`zTXt`、`iTXt`、`tIME`、`pHYs` 等中繼資料區塊，並驗證／維持 CRC-32。
    - `strip_webp()`：解析 RIFF 容器，移除 `EXIF` 與 `XMP ` chunk，更新 `VP8X` 旗標位元（清除 bit 3 EXIF 與 bit 2 XMP）並重算 RIFF 總長度。
  - `zip.rs`：純 Rust ZIP（Store method + IEEE 802.3 CRC-32）封裝器，無壓縮負擔（圖片本身已壓縮）且相容 macOS / Windows / Linux 內建解壓工具。
  - `json.rs`：輕量 JSON 序列化器，將 `InspectReport` 安全轉成 JSON 字串回傳給 JS Worker。
  - `svg.rs`：SVG 安全清理與最佳化（嚴格 XML tokenizer → 白名單清理 → 序列化，輸出前再以同一 tokenizer 重新解析確認合法）。
    - 移除整個子樹：`script`、`foreignObject`、`iframe`／`embed`／`object`、`metadata`、帶命名空間前綴（Inkscape／Sodipodi 等）與白名單外的元素；`use`／`image`／`feImage` 的 href 被移除後一併刪除。
    - 移除屬性：`on*` 事件、含 `javascript:`／`vbscript:` 的值、`xml:base`、非 `xlink`／`xml` 的命名空間屬性；`attributeName` 指向 `href`／`on*`／`style` 的動畫元素整個移除。
    - 引用：`href`／`xlink:href` 只保留 `#id`；`image`／`feImage` 另允許 `data:image/{png,jpeg,gif,webp,avif};base64`。所有 `url(...)`（屬性、`style` 屬性、`<style>`）只允許 `url(#id)`；`<style>` 含 `@import`、外部 url、`expression(`、反斜線跳脫等就整段移除。
    - 一律移除 DOCTYPE、處理指令（含 `xml-stylesheet`）、註解與非預定義實體（實體不展開，避免 billion laughs）；預設移除標籤之間的空白（文字元素與 `xml:space="preserve"` 內保留）。
    - 上限：20 MiB、巢狀 256 層、非 UTF-8 或格式錯誤直接拒絕，不做「盡量修好」的寬鬆解析。
- **`crates/media-wasm`**（`cdylib`，目標 `wasm32-unknown-unknown`）
  - 提供極簡線性記憶體 ABI（`alloc`、`dealloc`、`inspect_image_json`、`strip_metadata_wasm`、`build_zip_wasm`、`clean_svg_wasm`／`svg_last_report`／`svg_last_error`、`last_output_ptr`、`last_output_len`），免除龐大 JS glue code，讓 WASM 體積壓在 ~50 KB 以內且無需外部工具即可直接以 `WebAssembly.instantiate` 載入。

## 3. 安全與效能基準

- **CSP（`<meta http-equiv="Content-Security-Policy">`）**：
  - `default-src 'self'`
  - `script-src 'self' 'wasm-unsafe-eval'`
  - `worker-src 'self' blob:`
  - `img-src 'self' blob: data:`
  - `style-src 'self' 'unsafe-inline'`
  - `connect-src 'none'`（核心隱私保證：瀏覽器底層阻擋任何對外 `fetch` / `XHR` / `WebSocket`）
  - `object-src 'none'; base-uri 'self'; form-action 'self'`
- **記憶體安全**：
  - 每次檔案處理結束後明確 `URL.revokeObjectURL` 釋放預覽記憶體，避免批次處理數十張圖時造成瀏覽器記憶體洩漏。
  - Rust 核心限制單檔處理上限（例如 100 MiB）與整數溢位保護（`checked_add` / `saturating_*`），防止畸形檔案造成 panic 或 OOM。
- **效能目標**：
  - 首頁 LCP < 1.5s、CLS = 0、TBT < 100ms。
  - `375×812` 手機與 `1280×800` 桌面 0 水平溢位，所有互動按鈕最小觸控高度 `>= 38px`。
