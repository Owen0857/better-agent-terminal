import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { TerminalInstance } from '../types'
import { TerminalThumbnail } from './TerminalThumbnail'
import { getAgentPreset } from '../types/agent-presets'

interface ThumbnailBarProps {
  terminals: TerminalInstance[]
  focusedTerminalId: string | null
  onFocus: (id: string) => void
  onAddTerminal?: () => void
  onAddClaudeAgent?: () => void
  onAddClaudeAgent1M?: () => void
  onAddTerminalWithCommand?: (command: string) => void
  onReorder?: (orderedIds: string[]) => void
  showAddButton: boolean
  height?: number
  collapsed?: boolean
  onCollapse?: () => void
}

export function ThumbnailBar({
  terminals,
  focusedTerminalId,
  onFocus,
  onAddTerminal,
  onAddClaudeAgent,
  onAddClaudeAgent1M,
  onAddTerminalWithCommand,
  onReorder,
  showAddButton,
  height,
  collapsed = false,
  onCollapse
}: ThumbnailBarProps) {
  const { t } = useTranslation()
  // Check if these are agent terminals or regular terminals
  const firstTerminal = terminals[0]
  const isAgentList = firstTerminal?.agentPreset && firstTerminal.agentPreset !== 'none'
  const label = isAgentList
    ? (getAgentPreset(firstTerminal.agentPreset!)?.name || 'Agent')
    : t('terminal.terminals')

  // All hooks must be declared before any conditional return (React rules of hooks)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<'before' | 'after'>('before')

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    // Make the drag ghost semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.4'
    }
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1'
    }
    setDraggedId(null)
    setDropTargetId(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    // Only handle drags that originated from a thumbnail (not resize handles etc.)
    if (!draggedId || id === draggedId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    // Determine if dropping before or after based on mouse position
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const pos = e.clientY < midY ? 'before' : 'after'

    setDropTargetId(id)
    setDropPosition(pos)
  }, [draggedId])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the element (not entering a child)
    const related = e.relatedTarget as HTMLElement | null
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      setDropTargetId(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetId || !onReorder) return

    const currentOrder = terminals.map(t => t.id)
    const draggedIndex = currentOrder.indexOf(draggedId)
    if (draggedIndex === -1) return

    // Remove dragged item
    currentOrder.splice(draggedIndex, 1)

    // Calculate new index based on drop position
    let newIndex = currentOrder.indexOf(targetId)
    if (dropPosition === 'after') {
      newIndex += 1
    }

    // Insert at new position
    currentOrder.splice(newIndex, 0, draggedId)
    onReorder(currentOrder)

    setDraggedId(null)
    setDropTargetId(null)
  }, [draggedId, dropPosition, terminals, onReorder])

  // Collapsed state - show icon bar
  if (collapsed) {
    return (
      <div
        className="collapsed-bar collapsed-bar-bottom"
        onClick={onCollapse}
        title={t('terminal.expandThumbnails')}
      >
        <div className="collapsed-bar-icon">🖼️</div>
        <span className="collapsed-bar-label">{label}</span>
      </div>
    )
  }

  const style = height ? { height: `${height}px`, flex: 'none' } : undefined

  return (
    <div className="thumbnail-bar" style={style}>
      <div className="thumbnail-bar-header">
        <span>{label}</span>
        <div className="thumbnail-bar-actions">
          {onAddClaudeAgent && (
            <button className="thumbnail-action-btn thumbnail-action-claude" onClick={onAddClaudeAgent} title="Claude Code (SDK Agent)">
              ✦ Claude
            </button>
          )}
          {onAddClaudeAgent1M && (
            <button className="thumbnail-action-btn thumbnail-action-claude1m" onClick={onAddClaudeAgent1M} title="Claude Code (SDK Agent + 1M context)">
              ✦ Claude 1M
            </button>
          )}
          {onAddTerminalWithCommand && (
            <button className="thumbnail-action-btn thumbnail-action-opus" onClick={() => onAddTerminalWithCommand('claude --model=opus[1m] --dangerously-skip-permissions')} title="Terminal: claude --model=opus[1m] --dangerously-skip-permissions">
              Super Opus 1M
            </button>
          )}
          {onAddTerminal && (
            <button className="thumbnail-action-btn thumbnail-action-terminal" onClick={onAddTerminal} title="Terminal: claude (wait for enter)">
              ⌘ Terminal
            </button>
          )}
          {onCollapse && (
            <button className="thumbnail-collapse-btn" onClick={onCollapse} title={t('terminal.collapsePanel')}>
              ▼
            </button>
          )}
        </div>
      </div>
      <div className="thumbnail-list">
        {terminals.map(terminal => (
          <div
            key={terminal.id}
            draggable={!!onReorder}
            onDragStart={(e) => handleDragStart(e, terminal.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, terminal.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, terminal.id)}
            className={`thumbnail-drag-wrapper${
              dropTargetId === terminal.id && draggedId !== terminal.id
                ? ` drop-${dropPosition}`
                : ''
            }${draggedId === terminal.id ? ' dragging' : ''}`}
          >
            <TerminalThumbnail
              terminal={terminal}
              isActive={terminal.id === focusedTerminalId}
              onClick={() => onFocus(terminal.id)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
