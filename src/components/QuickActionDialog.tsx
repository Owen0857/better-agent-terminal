import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { QuickAction } from '../types'
import { AgentPresetId, AGENT_PRESETS } from '../types/agent-presets'
import { validate, formatHotkey } from '../utils/quick-action-manager'

const PRESET_ICONS = ['✦', '⌘', '⚡', '🚀', '💡', '⭐', '🔧', '📦', '🎯', '🔥']
const PRESET_COLORS = [
  '#d97706', // Orange
  '#10a37f', // Green
  '#3b82f6', // Blue
  '#8b5cf6', // Purple
  '#ef4444', // Red
  '#f59e0b', // Amber
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#84cc16', // Lime
  '#64748b'  // Slate
]

interface QuickActionDialogProps {
  mode: 'create' | 'edit'
  action?: QuickAction  // edit 模式時提供
  onSave: (action: Omit<QuickAction, 'order'>) => void
  onCancel: () => void
}

export function QuickActionDialog({ mode, action, onSave, onCancel }: QuickActionDialogProps) {
  const { t } = useTranslation()

  // Form state
  const [label, setLabel] = useState(action?.label || '')
  const [icon, setIcon] = useState(action?.icon || '')
  const [type, setType] = useState<AgentPresetId>(action?.type || 'claude-code')
  const [modelOverride, setModelOverride] = useState(action?.modelOverride || '')
  const [command, setCommand] = useState(action?.command || '')
  const [color, setColor] = useState(action?.color || '#d97706')
  const [hotkey, setHotkey] = useState(action?.hotkey || '')
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const hotkeyInputRef = useRef<HTMLInputElement>(null)

  // Auto-prefill icon/color/label from agent preset when type changes (create mode only)
  useEffect(() => {
    if (mode === 'create') {
      const preset = AGENT_PRESETS.find(p => p.id === type)
      if (preset) {
        if (!label) setLabel(preset.name)
        if (!icon) setIcon(preset.icon)
        if (!color || color === '#d97706') setColor(preset.color)
      }
    }
  }, [type, mode, label, icon, color])

  // Hotkey recorder
  useEffect(() => {
    if (!isRecordingHotkey) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const formatted = formatHotkey(e)
      if (formatted) {
        setHotkey(formatted)
        setIsRecordingHotkey(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isRecordingHotkey])

  // Focus hotkey input when recording starts
  useEffect(() => {
    if (isRecordingHotkey && hotkeyInputRef.current) {
      hotkeyInputRef.current.focus()
    }
  }, [isRecordingHotkey])

  const handleSave = () => {
    const input: Partial<QuickAction> = {
      label,
      icon,
      type,
      modelOverride: modelOverride || undefined,
      command: command || undefined,
      color,
      hotkey: hotkey || undefined,
    }

    // Validate
    const validationErrors = validate(input, action?.id)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    // Save
    const savedAction: Omit<QuickAction, 'order'> = {
      id: action?.id || crypto.randomUUID(),
      label,
      icon,
      type,
      modelOverride: modelOverride || undefined,
      command: command || undefined,
      color,
      hotkey: hotkey || undefined,
      builtin: action?.builtin || false,
    }
    onSave(savedAction)
  }

  const isBuiltin = action?.builtin || false

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-content quick-action-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{mode === 'create' ? 'Create Quick Action' : 'Edit Quick Action'}</h3>
          <button className="dialog-close" onClick={onCancel}>×</button>
        </div>

        <div className="dialog-body">
          {errors.length > 0 && (
            <div className="validation-errors">
              {errors.map((err, i) => (
                <div key={i} className="validation-error">{err}</div>
              ))}
            </div>
          )}

          <div className="form-group">
            <label>Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AgentPresetId)}
              disabled={isBuiltin}
            >
              {AGENT_PRESETS.map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.icon} {preset.name}
                </option>
              ))}
            </select>
            {isBuiltin && <small className="form-hint">Builtin actions cannot change type</small>}
          </div>

          <div className="form-group">
            <label>Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="1-32 characters"
              maxLength={32}
            />
          </div>

          <div className="form-group">
            <label>Icon</label>
            <div className="preset-picker">
              {PRESET_ICONS.map((presetIcon, i) => (
                <button
                  key={i}
                  type="button"
                  className={`preset-icon-btn${icon === presetIcon ? ' selected' : ''}`}
                  onClick={() => setIcon(presetIcon)}
                  title={presetIcon}
                >
                  {presetIcon}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="Or type custom emoji (1-2 chars)"
              maxLength={2}
            />
          </div>

          <div className="form-group">
            <label>Color</label>
            <div className="preset-picker">
              {PRESET_COLORS.map((presetColor, i) => (
                <button
                  key={i}
                  type="button"
                  className={`preset-color-btn${color === presetColor ? ' selected' : ''}`}
                  style={{ backgroundColor: presetColor }}
                  onClick={() => setColor(presetColor)}
                  title={presetColor}
                />
              ))}
            </div>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>

          {type !== 'none' && (
            <div className="form-group">
              <label>Model Override</label>
              <input
                type="text"
                value={modelOverride}
                onChange={(e) => setModelOverride(e.target.value)}
                placeholder="e.g., claude-opus-4-6[1m]"
              />
              <small className="form-hint">Optional: override the default model</small>
            </div>
          )}

          {type === 'none' && (
            <div className="form-group">
              <label>Command</label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Shell command to execute"
              />
              <small className="form-hint">Required for Terminal type</small>
            </div>
          )}

          <div className="form-group">
            <label>Hotkey</label>
            <div className="hotkey-recorder">
              <input
                ref={hotkeyInputRef}
                type="text"
                value={isRecordingHotkey ? 'Press a key combination...' : hotkey}
                readOnly
                placeholder="Click to record"
                onClick={() => setIsRecordingHotkey(true)}
                className={isRecordingHotkey ? 'recording' : ''}
              />
              {hotkey && !isRecordingHotkey && (
                <button
                  className="hotkey-clear"
                  onClick={() => setHotkey('')}
                  title="Clear hotkey"
                >
                  ×
                </button>
              )}
            </div>
            <small className="form-hint">Optional: keyboard shortcut (e.g., Ctrl+1)</small>
          </div>
        </div>

        <div className="dialog-footer">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
