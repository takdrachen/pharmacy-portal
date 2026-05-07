# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Japanese pharmacy (緑ヶ丘調剤薬局 – Midorigaoka Dispensing Pharmacy) staff portal: a single-page static web app for shift management, medicine database, announcements, employee records, and an AI chat assistant (Google Gemini).

## Development Workflow

There is **no build system, no package manager, and no test suite**. The project is pure HTML/CSS/Vanilla JS.

**To run locally:** open `index.html` in a browser directly, or serve it with any static HTTP server:
```bash
python3 -m http.server 8000
# or
npx serve .
```

**Deployment:** Netlify (config in `.netlify/netlify.toml`). The `publish` directory is the repo root. Push to the branch and Netlify deploys automatically.

There are no lint, test, or build commands.

## Architecture

### Single-Page Application Pattern

All sections (`dashboard`, `announcements`, `shifts`, `medicines`, `employees`, `ai-chat`, `settings`) are rendered in `index.html` as `<section>` elements. Navigation toggles the `.active` CSS class via `switchSection()` in `js/main.js`. The active section gets `display: block`; others are hidden.

### Script Load Order (Critical)

Scripts must load in this exact order (as in `index.html`):
1. `js/sheets-api.js` – defines `SheetsAPI` global
2. `js/storage.js` – defines `DataStorage` global; auto-initializes on load and fires `storageReady` event when done
3. `js/main.js` – initializes all sections, waits for `storageReady` before loading data
4. `js/medicine-panel.js` – medicine list rendering, depends on `DataStorage` and `main.js` functions
5. `js/dashboard-customize.js` – dashboard widget drag-and-drop and layout persistence
6. `js/settings.js` – Google Sheets connection UI and embedded GAS source code

All functions are globals (no ES modules). Functions defined in later scripts can call functions from earlier scripts.

### Data Storage Layer (`js/storage.js`)

`DataStorage` is a singleton that operates in one of three modes, determined at startup:

| Mode | Trigger | Behavior |
|------|---------|----------|
| `sheets` | `SheetsAPI.isConnected()` is true | Loads from Google Sheets on init; syncs writes async; polls every 30s |
| `server` | `/api/medicines` returns HTTP 200 | Loads from Express+SQLite API on init; syncs writes async |
| `local` | Neither above available | Pure localStorage; ships with sample data on first load |

The API is **synchronous-looking** but uses a write-through cache: `getAll()` / `getById()` return from the in-memory `_cache` immediately. `create()` / `update()` / `delete()` write to cache and localStorage synchronously, then call `_syncCreate` / `_syncUpdate` / `_syncDelete` in the background.

**Field naming convention:** internal JS uses `snake_case` (e.g., `sales_status`, `staff_name`). Google Sheets uses `camelCase` (e.g., `salesStatus`, `employeeName`). `DataStorage.FIELD_MAP_TO_SHEETS` and `FIELD_MAP_FROM_SHEETS` handle translation when syncing.

**Data tables:** `announcements`, `shifts`, `medicines`, `employees`
**localStorage keys:** prefixed with `pharmacy_` (e.g., `pharmacy_medicines`)

Cross-device sync fires a `dataSync` CustomEvent on `window` when data changes during polling. `refreshCurrentSection(table)` in `main.js` handles the re-render.

### Google Sheets Integration (`js/sheets-api.js`)

GAS Web Apps have CORS restrictions for POST requests, so **all communication uses GET requests**, including writes. Write payloads are JSON-encoded and passed as a `payload` URL parameter. `SheetsAPI` queues write operations sequentially (300ms delay between requests) to avoid GAS rate limits.

The full GAS server-side source code lives embedded inside `js/settings.js` in the `copyGasCode()` function. When a user sets up Sheets integration, they copy this code into Google Apps Script and deploy it as a Web App accessible to "Everyone".

### Medicine Panel (`js/medicine-panel.js`)

Medicine data is shared via `window.medicinesData` (set by `loadMedicines()` in `main.js`). The panel supports table and card views, toggled by `setMedicineViewMode()`, with the preference persisted to `localStorage.medicine_view_mode`.

The inline input card (collapsible) and the edit modal (in `main.js`) are two separate UIs for adding vs. editing medicines. The sales period field accepts `～` or `~` as a range separator (e.g., `2026年4月～2026年12月`) and is split into `sales_start_date` and `discontinuation_date` on save.

### AI Chat (`js/main.js`)

Uses Google Gemini 1.5 Flash API directly from the browser. The API key is stored in `localStorage.gemini_api_key`. Context is built by reading all current data from `DataStorage` and injecting it into the system prompt. Falls back to keyword-matching demo responses if the API key is absent or the call fails.

### Dashboard Customization (`js/dashboard-customize.js`)

Widget layout (order + visibility per column) is persisted to `localStorage.dashboard_layout`. Supports drag-and-drop both via the customize panel and directly on the dashboard cards (only when the customize panel is open, which reveals the drag handles).

## Key Conventions

- **All timestamps are JST (Asia/Tokyo).** Use `toJSTString()` from `storage.js` for new timestamps. Date display uses `formatDate()` / `formatDateISO()` from `main.js`.
- **HTML escaping is mandatory** before inserting user data into `innerHTML`. Use `escapeHtml()` (defined in both `main.js` and `medicine-panel.js` as `escapeHtmlMed()`).
- **Modals** are opened by adding `.active` class and closed by removing it. Backdrop clicks are handled globally via `document.addEventListener('click', ...)` in `main.js`.
- **Toast notifications** use `showToast(message, type)` where type is `'success'` | `'error'` | `'warning'` | `'info'`.
- **Destructive actions** go through `showConfirmDialog(title, message, okLabel)` which returns a Promise<boolean>.
- The holiday lookup table `holidays2026` in `main.js` is hardcoded for 2026 only and will need updating for other years.
- The Google Sheets `shifts` sheet stores `startTime`/`endTime` columns as plain text (format `@`) to prevent Google Sheets from converting `HH:mm` strings to Date objects. The `_fromSheetsFormat` converter handles the 1899-based Date artifact that appears when this conversion happens anyway.
