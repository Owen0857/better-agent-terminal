import { useState, useEffect, useRef, memo } from 'react'
import type { TerminalInstance } from '../types'
import { ActivityIndicator } from './ActivityIndicator'
import { getAgentPreset } from '../types/agent-presets'

export interface SessionTabProps {
  terminal: TerminalInstance
  isActive: boolean
  onClick: () => void
  onRename: (id: string, alias: string) => void
  onEditDescription: (id: string, description: string) => void
  editMode?: 'rename' | 'description' | null
  onEditModeEnd?: () => void
}

export const SessionTab = memo(function SessionTab({
  terminal,
  isActive,
  onClick,
  onRename,
  onEditDescription,
  editMode,
  onEditModeEnd,
}: SessionTabProps) {
  const isAgent = terminal.agentPreset && terminal.agentPreset !== 'none'
  const agentConfig = isAgent ? getAgentPreset(terminal.agentPreset!) : null
  const isWorktreeTerminal = !!terminal.worktreePath
  const displayName = terminal.alias || terminal.title

  const [localEditMode, setLocalEditMode] = useState<'rename' | 'description' | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlurRef = useRef(false)

  const activeEdit = editMode ?? localEditMode

  // When external editMode arrives, initialise the input value
  useEffect(() => {
    if (editMode === 'rename') {
      setEditValue(terminal.alias || terminal.title)
    } else if (editMode === 'description') {
      setEditValue(terminal.description || '')
    }
  }, [editMode, terminal.id, terminal.alias, terminal.title, terminal.description])

  // Focus input whenever editing starts, and select all text
  useEffect(() => {
    if (activeEdit) {
      setTimeout(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.select()
      }, 0)
    }
  }, [activeEdit])

  const commitEdit = () => {
    if (activeEdit === 'rename') {
      onRename(terminal.id, editValue.trim())
    } else if (activeEdit === 'description') {
      onEditDescription(terminal.id, editValue.trim())
    }
    setLocalEditMode(null)
    onEditModeEnd?.()
  }

  const cancelEdit = () => {
    setLocalEditMode(null)
    onEditModeEnd?.()
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(terminal.alias || terminal.title)
    setLocalEditMode('rename')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      skipBlurRef.current = true
      commitEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      skipBlurRef.current = true
      cancelEdit()
    }
  }

  const handleBlur = () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false
      return
    }
    commitEdit()
  }

  // Build tooltip: original title + optional description
  const tooltipParts: string[] = [terminal.title]
  if (terminal.description) tooltipParts.push('---', terminal.description)
  const tooltip = tooltipParts.join('\n')

  return (
    <div
      className={[
        'session-tab',
        isActive ? 'active' : '',
        isAgent ? 'agent-terminal' : '',
      ].filter(Boolean).join(' ')}
      style={agentConfig ? { '--agent-color': agentConfig.color } as React.CSSProperties : undefined}
      title={tooltip}
      onClick={activeEdit ? undefined : onClick}
      onDoubleClick={handleDoubleClick}
    >
      {isAgent && agentConfig && (
        <span className="session-tab-icon">{agentConfig.icon}</span>
      )}
      {isWorktreeTerminal && (
        <span className="session-tab-icon" title={terminal.worktreeBranch || 'worktree'}>🌳</span>
      )}

      {activeEdit ? (
        <input
          ref={inputRef}
          className="session-tab-edit-input"
          value={editValue}
          placeholder={activeEdit === 'description' ? '提示說明…' : ''}
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="session-tab-name">{displayName}</span>
      )}

      <ActivityIndicator terminalId={terminal.id} size="small" />
    </div>
  )
})
