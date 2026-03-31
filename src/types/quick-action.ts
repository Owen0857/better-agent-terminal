import { AgentPresetId } from './agent-presets'

/**
 * Quick Action Button 資料模型
 * 用於 ThumbnailBar 的可配置快速操作按鈕
 */
export interface QuickAction {
  id: string              // uuid（builtin 使用固定 id）
  label: string           // 1~32 字元
  icon: string            // emoji/symbol，1~2 字元
  type: AgentPresetId     // 'claude-code' | 'gemini-cli' | 'codex-cli' | 'copilot-cli' | 'none'
  modelOverride?: string  // 覆寫模型，例如 'claude-opus-4-6[1m]'
  command?: string        // 自訂指令（type='none' 時使用）
  color: string           // hex color，用於 hover 效果
  hotkey?: string         // 快捷鍵，例如 'Ctrl+1', 'Alt+C'
  builtin: boolean        // true = 不可刪除
  order: number           // 排序順序（左至右，0-based）
}

/**
 * 預設的 Quick Actions（不可刪除）
 * 1. Claude Code (builtin-claude)
 * 2. Terminal (builtin-terminal)
 */
export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'builtin-claude',
    label: 'Claude',
    icon: '✦',
    type: 'claude-code',
    color: '#d97706',
    builtin: true,
    order: 0,
  },
  {
    id: 'builtin-terminal',
    label: 'Terminal',
    icon: '⌘',
    type: 'none',
    color: '#888888',
    builtin: true,
    order: 1,
  },
]
