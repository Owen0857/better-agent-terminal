# Session Tab Design

**Date:** 2026-05-11
**Scope:** Replace bottom preview cards with compact session tabs; add rename + description support

---

## Goals

1. Replace the current bottom preview area (thumbnail cards with live text preview) with compact, browser-tab-style session tabs.
2. Allow renaming a tab (sets `alias` on `TerminalInstance`).
3. Allow setting an optional description (提示說明) shown as tooltip on hover.
4. Both alias and description persist across app restarts via existing workspace serialization.

## Non-Goals

- Dual-mode preview/tab toggle — tab-only.
- Showing description inline inside the tab (tooltip only).

---

## Architecture

### Approach: New `SessionTab` component (Option B — rebase-friendly)

Create a new `src/components/SessionTab.tsx` to replace `TerminalThumbnail` at the usage site in `ThumbnailBar.tsx`. The existing `TerminalThumbnail.tsx` is left untouched so upstream changes to it never conflict.

```
ThumbnailBar.tsx          — swap <TerminalThumbnail> → <SessionTab> (one-line change)
SessionTab.tsx            — NEW: compact tab render + inline rename input
types/index.ts            — add description?: string to TerminalInstance
workspace-store.ts        — add description to serialize/deserialize (~4 lines)
panels.css                — new .session-tab-* classes appended after existing rules
```

---

## Data Model

### `TerminalInstance` (src/types/index.ts)

Add one optional field:

```ts
description?: string;   // user-set tooltip / 提示說明
```

`alias` already exists and already persists — no change needed.

### Serialization (src/stores/workspace-store.ts)

In the two serialize locations (L601, L660) and the deserialize location (L309 area):

```ts
// serialize
description: t.description,

// deserialize
t.id === id ? { ...t, description } : t
```

---

## `SessionTab` Component

**File:** `src/components/SessionTab.tsx`

**Props:**
```ts
interface SessionTabProps {
  terminal: TerminalInstance
  isActive: boolean
  onClick: () => void
  onRename: (id: string, alias: string) => void
  onEditDescription: (id: string, description: string) => void
  // Set by ThumbnailBar when user picks Rename/Edit Description from context menu
  editMode?: 'rename' | 'description' | null
  onEditModeEnd?: () => void
}
```

`ThumbnailBar` tracks `editTarget: { id: string; mode: 'rename' | 'description' } | null` and passes `editMode` down. When `SessionTab` finishes editing it calls `onEditModeEnd` to clear the state.

**Render (non-editing state):**
```
<div class="session-tab [active] [agent-terminal]"
     title={tooltipText}
     onClick={onClick}
     onDoubleClick={→ inline rename}>
  <span class="session-tab-icon">{agentIcon | worktreeIcon}</span>
  <span class="session-tab-name">{alias ?? title}</span>
  <ActivityIndicator size="small" />
</div>
```

**Tooltip text:**
- No alias, no description → `terminal.title` (original title)
- Has alias → `terminal.title` (so user can see original)
- Has description → append `\n---\n{description}`

**Inline rename (double-click or editMode='rename'):**
- Replace name span with `<input>` pre-filled with current `alias ?? title`
- `Enter` / `onBlur` → call `onRename(id, value)` + `onEditModeEnd()`; empty value clears alias
- `Escape` → cancel + `onEditModeEnd()`

**Inline description (editMode='description'):**
- Replace name span with `<input>` pre-filled with current `description ?? ''`
- `Enter` / `onBlur` → call `onEditDescription(id, value)` + `onEditModeEnd()`; empty clears description
- `Escape` → cancel + `onEditModeEnd()`

---

## `ThumbnailBar` Changes

Single change: swap import and JSX tag.

```tsx
// Before
import { TerminalThumbnail } from './TerminalThumbnail'
// ...
<TerminalThumbnail terminal={terminal} isActive={...} onClick={...} />

// After
import { SessionTab } from './SessionTab'
// ...
<SessionTab
  terminal={terminal}
  isActive={...}
  onClick={...}
  onRename={(id, alias) => workspaceStore.renameTerminal(id, alias)}
  onEditDescription={(id, desc) => workspaceStore.setTerminalDescription(id, desc)}
/>
```

Context menu in `ThumbnailBar` gains two new items: **Rename** and **Edit Description**.
- "Rename" triggers inline rename mode on the target tab
- "Edit Description" triggers an inline description input on the target tab (same pattern as rename)

---

## Context Menu

Existing `thumbMenu` state gains a trigger ref. New menu items:

```
Rename              → set isRenaming=true on target SessionTab
Edit Description    → open description input
──────────────────
Close Terminal      (existing)
```

---

## CSS (append to panels.css)

```css
/* Session Tabs */
.session-tab { ... }          /* flex-row, ~32px height, auto-width, max-width 180px */
.session-tab.active { ... }   /* accent border-bottom */
.session-tab.agent-terminal { ... }
.session-tab-icon { ... }
.session-tab-name { ... }     /* text-overflow: ellipsis */
.session-tab-rename-input { ... }

/* Bar shrinks — override existing .thumbnail-bar min-height */
.thumbnail-bar { min-height: 44px; }
```

---

## Persistence Contract

| Field | Stored in | Survives restart |
|---|---|---|
| `alias` | workspace-store serialize | ✅ already works |
| `description` | workspace-store serialize | ✅ after this change |

---

## Rebase Strategy

Files modified in upstream-owned code:

| File | Change size | Conflict risk |
|---|---|---|
| `ThumbnailBar.tsx` | ~5 lines (swap component) | Low |
| `types/index.ts` | +1 optional field | Very low |
| `workspace-store.ts` | +1 field ×3 locations | Low |
| `panels.css` | append-only new section | Very low |

`SessionTab.tsx` is entirely new — no upstream conflict ever.
`TerminalThumbnail.tsx` is untouched — upstream changes apply cleanly.
