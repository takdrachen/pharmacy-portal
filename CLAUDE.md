# CLAUDE.md - Pharmacy Portal

## Project Overview

Japanese pharmacy staff portal (緑ヶ丘調剤薬局 情報共有ポータル) for information sharing and workflow management. Single-page application with zero build dependencies.

## Tech Stack

- **Frontend:** Vanilla HTML5, CSS3, JavaScript (no frameworks, no npm)
- **Icons:** Font Awesome 6.4 (CDN)
- **Fonts:** Google Fonts - Noto Sans JP (CDN)
- **Data:** Browser localStorage (primary), optional Google Sheets or Express+SQLite backends
- **Deployment:** Netlify (static hosting)

## File Structure

```
/
├── index.html                  # Single HTML entry point (all sections)
├── gas-code.js                 # Google Apps Script backend (deploy separately)
├── js/
│   ├── main.js                 # Core app: navigation, section init, data loading
│   ├── storage.js              # Data abstraction layer (localStorage/API/Sheets)
│   ├── sheets-api.js           # Google Sheets API client
│   ├── medicine-panel.js       # Medicine CRUD, filters, card/table views
│   ├── dashboard-customize.js  # Dashboard widget drag-and-drop
│   ├── settings.js             # Storage config, import/export, logging
├── css/
│   ├── style.css               # Global styles, CSS custom properties (design tokens)
│   ├── dashboard.css           # Dashboard widgets
│   ├── medicine-panel.css      # Medicine views
│   ├── ai-chat.css             # AI chat interface
│   ├── shift-medicine.css      # Shift/medicine calendar
│   ├── shift-presets.css       # Shift type presets
│   ├── employees.css           # Employee management
│   ├── settings.css            # Settings panel
├── .netlify/netlify.toml       # Netlify deployment config
└── README.md                   # Japanese user documentation
```

## Architecture

### Data Layer (`js/storage.js`)
The `DataStorage` class provides a unified CRUD API with automatic backend fallback:
- **Priority:** Google Sheets > Server API > localStorage
- **API:** `DataStorage.create(table, data)`, `.update(table, id, data)`, `.delete(table, id)`, `.getAll(table)`
- **Events:** `dataSync`, `storageModeChanged`, `storageReady` (CustomEvent on window)
- **Auto-sync:** 30-second polling when using cloud backends
- **Field mapping:** Converts between camelCase (Sheets) and snake_case (local)

### Section Pattern
Each feature module follows this convention:
- `init<Section>()` - Set up event listeners and UI
- `load<Section>()` - Fetch data from DataStorage
- `display<Section>()` - Render data to DOM
- `save<Section>()` - Persist changes via DataStorage

### localStorage Keys
```
pharmacy_announcements, pharmacy_shifts, pharmacy_medicines,
pharmacy_employees, pharmacy_sheets_config, medicine_view_mode
```

### UI Patterns
- **Modals:** `openXxxModal()` / `closeXxxModal()`
- **Toasts:** `showToast(message, type)` - type: 'success' | 'error' | 'info'
- **Confirm dialogs:** `showConfirmDialog(title, message, okLabel)` returns Promise
- **Input cards:** Collapsible form overlays for CRUD operations
- **DOM access:** Direct `getElementById()` / `querySelector()` (no virtual DOM)

## Data Models

**Announcements:** `{ id, title, category, priority, author, content, date, created_at, updated_at }`
- Categories: 業務連絡, 研修情報
- Priorities: 緊急, 重要, 通常

**Shifts:** `{ id, staff_name, date, shift_type, start_time, end_time, notes, created_at, updated_at }`
- Types: 早番, 日勤, 遅番, 全日

**Medicines:** `{ id, name, category, sales_status, discontinuation_date, alternative_medicine, notes, is_favorite, created_at, updated_at }`
- Sales statuses: 出荷調整中, 販売中止, その他, 新規採用

**Employees:** `{ id, name, furigana, position, employment_type, phone, email, hire_date, status, qualification, notes, created_at, updated_at }`

## Code Conventions

- **Language:** UI text and commit messages in Japanese; code identifiers in English
- **No build step:** Edit files directly, changes are live
- **No TypeScript, no linting, no tests** - manual QA only
- **Timezone:** All dates use JST (`Asia/Tokyo`), ISO 8601 with `+09:00` offset
- **Event handling:** Mix of inline `onclick` attributes and `addEventListener()`
- **Async:** Used for cloud operations; localStorage operations are synchronous
- **Error handling:** Try-catch with `console.log` for debugging

## Design Tokens (CSS Custom Properties in `css/style.css`)

- **Colors:** `--primary: #007aff`, `--accent: #00c896`, `--error: #ff3b30`
- **Spacing:** `--spacing-xs` through `--spacing-3xl`
- **Border radius:** `--radius-sm` through `--radius-full`
- **Shadows:** `--shadow-sm` through `--shadow-xl`

## Development Workflow

1. **No install needed** - open `index.html` in a browser or serve statically
2. **Edit any file** - changes take effect on reload (no compilation)
3. **Deployment** - push to `main`; Netlify auto-deploys from the repo root

## Common Tasks

- **Add a new section:** Add HTML in `index.html`, create JS init/load/display/save functions in `js/main.js` or a new module, add nav item, add CSS file
- **Add a data field:** Update the data model in `storage.js` field mappings, update HTML forms in `index.html`, update display logic in the relevant JS module
- **Modify styling:** Use existing CSS custom properties from `css/style.css` for consistency

## Important Notes

- No authentication - designed for trusted local pharmacy network use
- Data in localStorage is unencrypted and browser-specific
- Google Sheets integration requires deploying `gas-code.js` as a GAS Web App
- Japanese holidays for the current year are hardcoded in `js/main.js`
