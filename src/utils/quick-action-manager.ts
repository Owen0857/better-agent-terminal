import { QuickAction, DEFAULT_QUICK_ACTIONS } from '../types/quick-action'
import { settingsStore } from '../stores/settings-store'

/**
 * Quick Action Manager
 * 提供 CRUD API + validation + hotkey matching
 */

/**
 * 取得所有 Quick Actions（已排序）
 * @returns sorted copy of quick actions
 */
export function getAll(): QuickAction[] {
  const settings = settingsStore.getSettings()
  const actions = settings.quickActions || DEFAULT_QUICK_ACTIONS
  // 總是回傳 sorted copy，避免直接修改 store 內部狀態
  return [...actions].sort((a, b) => a.order - b.order)
}

/**
 * 根據 ID 取得單一 Quick Action
 */
export function getById(id: string): QuickAction | undefined {
  return getAll().find(a => a.id === id)
}

/**
 * 新增 Quick Action（插入最左側，order=0）
 */
export function add(action: Omit<QuickAction, 'order'>): QuickAction {
  // Validate input first
  const errors = validate(action)
  if (errors.length > 0) {
    throw new Error(`Invalid quick action: ${errors.join(', ')}`)
  }

  const current = getAll()
  // 新 action 插入最左側（order=0），其他 action 的 order+1
  const updated = current.map(a => ({ ...a, order: a.order + 1 }))
  const newAction: QuickAction = { ...action, order: 0 }
  updated.push(newAction)
  settingsStore.setQuickActions(updated)
  return newAction
}

/**
 * 更新 Quick Action
 * Builtin action 的 type, builtin, id 欄位不可修改
 */
export function update(id: string, updates: Partial<QuickAction>): void {
  const current = getAll()
  const index = current.findIndex(a => a.id === id)
  if (index === -1) {
    throw new Error(`Quick action not found: ${id}`)
  }

  const action = current[index]

  // Prepare merged object
  let mergedAction: QuickAction
  if (action.builtin) {
    // 過濾掉 type, builtin, id 欄位的修改
    const { type, builtin, id: _id, ...allowedUpdates } = updates
    mergedAction = { ...action, ...allowedUpdates }
  } else {
    mergedAction = { ...action, ...updates }
  }

  // Validate merged result
  const errors = validate(mergedAction, id)
  if (errors.length > 0) {
    throw new Error(`Invalid quick action update: ${errors.join(', ')}`)
  }

  current[index] = mergedAction
  settingsStore.setQuickActions(current)
}

/**
 * 刪除 Quick Action
 * Builtin action 不可刪除
 */
export function remove(id: string): boolean {
  const current = getAll()
  const action = current.find(a => a.id === id)

  if (!action) {
    console.warn('[quickActionManager] Action not found:', id)
    return false
  }

  if (action.builtin) {
    console.warn('[quickActionManager] Cannot delete builtin action:', id)
    return false
  }

  const updated = current.filter(a => a.id !== id)
  settingsStore.setQuickActions(updated)
  return true
}

/**
 * 重新排序 Quick Actions
 * @param orderedIds 新的排序（左至右）
 */
export function reorder(orderedIds: string[]): void {
  const current = getAll()
  const currentIdSet = new Set(current.map(a => a.id))

  // Detect invalid IDs
  const invalidIds = orderedIds.filter(id => !currentIdSet.has(id))
  if (invalidIds.length > 0) {
    throw new Error(`Invalid action IDs in reorder: ${invalidIds.join(', ')}`)
  }

  const idSet = new Set(orderedIds)

  // Safety net: append 未在 orderedIds 中的 action（防止遺失）
  const missingIds = current.filter(a => !idSet.has(a.id)).map(a => a.id)
  const finalOrder = [...orderedIds, ...missingIds]

  // 重新計算 order 欄位（0-based index）
  const updated = finalOrder
    .map((id, index) => {
      const action = current.find(a => a.id === id)
      if (!action) return null
      return { ...action, order: index }
    })
    .filter((a): a is QuickAction => a !== null)
  settingsStore.setQuickActions(updated)
}

/**
 * 驗證 Quick Action 輸入
 * @param input 待驗證的資料
 * @param excludeId 排除的 ID（用於 edit 模式，排除自己）
 * @returns 錯誤訊息陣列（空陣列表示通過驗證）
 */
export function validate(input: Partial<QuickAction>, excludeId?: string): string[] {
  const errors: string[] = []

  // Label 長度：1~32 字元
  if (input.label !== undefined) {
    if (input.label.length < 1 || input.label.length > 32) {
      errors.push('Label must be 1-32 characters')
    }
  }

  // Icon 長度：最多 2 字元
  if (input.icon !== undefined) {
    if (input.icon.length === 0 || input.icon.length > 2) {
      errors.push('Icon must be 1-2 characters')
    }
  }

  // Command 必填：當 type='none' 時
  if (input.type === 'none' && !input.command) {
    errors.push('Command is required when type is "none"')
  }

  // Hotkey 衝突檢查
  if (input.hotkey) {
    const current = getAll()
    const conflict = current.find(a => {
      if (excludeId && a.id === excludeId) return false
      return a.hotkey === input.hotkey
    })
    if (conflict) {
      errors.push(`Hotkey "${input.hotkey}" is already used by "${conflict.label}"`)
    }
  }

  return errors
}

/**
 * 格式化 hotkey（標準化 modifier 順序）
 * @param event KeyboardEvent
 * @returns 格式化的 hotkey 字串，例如 'Ctrl+Shift+C'
 */
export function formatHotkey(event: KeyboardEvent): string | null {
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Meta')

  // 要求至少一個 modifier（避免攔截普通按鍵）
  if (modifiers.length === 0) return null

  // 排除純 modifier 按鍵
  const key = event.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null

  return [...modifiers, key].join('+')
}

/**
 * 匹配 hotkey（用於 global listener）
 * @param event KeyboardEvent
 * @param hotkey 儲存的 hotkey 字串
 * @returns 是否匹配
 */
export function matchHotkey(event: KeyboardEvent, hotkey: string): boolean {
  const formatted = formatHotkey(event)
  return formatted === hotkey
}
