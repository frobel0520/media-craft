# 正式網址效能與安全標頭驗收紀錄（2026-11-20）

- **受測網址**：`https://media-craft.pages.dev`（Cloudflare Pages 正式站，HTTP/2 + Alt-Svc `h3`）
- **測試時間**：2026-11-20（UTC 08:59–09:01）
- **測試環境**：Linux 雲端沙盒 VM、Headless `Chrome/156.0.8078.79`（CDP，停用快取、獨立 BrowserContext）＋ `curl -sSI` 標頭核對
- **樣本數**：7 次清快取載入（`1280×800`）

## 1. HTTP 安全標頭與快取策略核對（`_headers` 生效驗證）

### 首頁（`GET /` → `HTTP/2 200`）
| 標頭 | 實測值 | 判定 |
| --- | --- | --- |
| `content-security-policy` | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | ✅ 生效 |
| `x-frame-options` | `DENY` | ✅ 生效 |
| `x-content-type-options` | `nosniff` | ✅ 生效 |
| `referrer-policy` | `no-referrer` | ✅ 生效 |
| `cross-origin-opener-policy` | `same-origin` | ✅ 生效 |
| `permissions-policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | ✅ 生效 |
| `cache-control` | `public, max-age=0, must-revalidate` | ✅ 生效 |

### WASM 核心（`GET /wasm/media_wasm.wasm` → `HTTP/2 200`）
| 標頭 | 實測值 | 判定 |
| --- | --- | --- |
| `content-type` | `application/wasm` | ✅ 生效 |
| `cache-control` | `public, max-age=31536000, immutable` | ✅ 生效 |

## 2. 線上 Web Vitals 與零上傳實測結果（7 次清快取樣本）

| 指標 | 門檻（`docs/03-system-design.md`） | 實測結果（`https://media-craft.pages.dev`） | 判定 |
| --- | --- | --- | --- |
| **LCP** | `< 1,500 ms` | `p50 = 336 ms` / `p95 = 460 ms`（樣本：`308, 328, 328, 336, 344, 352, 460`） | ✅ 通過 |
| **CLS** | `< 0.1` | `max = 0.0004` | ✅ 通過 |
| **TBT** | `< 100 ms` | `p50 = 0 ms` / `max = 2 ms`（樣本：`0, 0, 0, 0, 0, 0, 2`） | ✅ 通過 |
| **Rust WASM 就緒** | 100% 就緒 | `7/7` 次均顯示「Rust WASM 就緒 · 零上傳」 | ✅ 通過 |
| **第三方網路請求** | `0` | `0`（100% 僅存取 `https://media-craft.pages.dev`） | ✅ 通過 |
| **CSP 違規（`securitypolicyviolation`）** | `0` | `0` | ✅ 通過 |
| **瀏覽器錯誤（`error` / `unhandledrejection`）** | `0` | `0` | ✅ 通過 |
| **水平溢位（`1280×800`）** | `0` | `0` | ✅ 通過 |

## 3. 仍待人工驗證項目

- 實體手機（iOS Safari / Android Chrome）大圖批次處理與相簿匯入體驗。
