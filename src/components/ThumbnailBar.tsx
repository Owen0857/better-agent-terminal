import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TerminalInstance, QuickAction } from '../types'
import { TerminalThumbnail } from './TerminalThumbnail'
import type { AgentPreset } from '../types/agent-presets'
import { getAgentPreset } from '../types/agent-presets'
import { QuickActionContextMenu } from './QuickActionContextMenu'

interface ThumbnailBarProps {
  terminals: TerminalInstance[]
  focusedTerminalId: string | null
  onFocus: (id: string) => void
  onAddTerminal?: () => void
  onAddWorktreeTerminal?: () => void
  onAddAgent?: (presetId: string) => void
  onAddWorker?: (procfilePath?: string) => void
  detectedProcfiles?: string[]
  agentPresets?: AgentPreset[]
  onReorder?: (orderedIds: string[]) => void
  onCloseTerminal?: (id: string) => void
  showAddButton: boolean
  height?: number
  collapsed?: boolean
  onCollapse?: () => void
  // Quick Actions
  quickActions?: QuickAction[]
  onExecuteAction?: (action: QuickAction) => void
  onReorderActions?: (orderedIds: string[]) => void
  onCreateAction?: () => void
  onEditAction?: (action: QuickAction) => void
  onDeleteAction?: (actionId: string) => void
}

export function ThumbnailBar({
  terminals,
  focusedTerminalId,
  onFocus,
  onAddTerminal,
  onAddWorktreeTerminal,
  onAddAgent,
  onAddWorker,
  detectedProcfiles = [],
  agentPresets = [],
  onReorder,
  onCloseTerminal,
  showAddButton,
  height,
  collapsed = false,
  onCollapse,
  quickActions,
  onExecuteAction,
  onReorderActions,
  onCreateAction,
  onEditAction,
  onDeleteAction
}: ThumbnailBarProps) {
  const { t } = useTranslation()
  const label = t('terminal.workspaceSessions')

  // All hooks must be declared before any conditional return (React rules of hooks)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<'before' | 'after'>('before')
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const [thumbMenu, setThumbMenu] = useState<{ x: number; y: number; terminalId: string } | null>(null)
  const [thumbMenuPos, setThumbMenuPos] = useState<{ x: number; y: number } | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const addMenuPopupRef = useRef<HTMLDivElement>(null)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const thumbnailListRef = useRef<HTMLDivElement>(null)
  const middlePanRef = useRef<{ startX: number; startScrollLeft: number } | null>(null)
  const thumbMenuRef = useRef<HTMLDivElement>(null)

  // Quick Action state
  const [draggedActionId, setDraggedActionId] = useState<string | null>(null)
  const [dropTargetActionId, setDropTargetActionId] = useState<string | null>(null)
  const [dropActionPosition, setDropActionPosition] = useState<'before' | 'after'>('before')
  const [contextMenu, setContextMenu] = useState<{ action: QuickAction; x: number; y: number } | null>(null)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {
      setContextMenuPos(null)
      return
    }
    const rect = contextMenuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = contextMenu
    if (x + rect.width > vw) x = Math.max(4, vw - rect.width - 4)
    if (y + rect.height > vh) y = Math.max(4, vh - rect.height - 4)
    setContextMenuPos({ x, y })
  }, [contextMenu])

  useEffect(() => {
    const clearMiddlePan = () => {
      middlePanRef.current = null
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!middlePanRef.current) return
      if ((e.buttons & 4) === 0) {
        clearMiddlePan()
        return
      }
      const el = thumbnailListRef.current
      if (!el) return
      e.preventDefault()
      el.scrollLeft = middlePanRef.current.startScrollLeft - (e.clientX - middlePanRef.current.startX)
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 1 || (e.buttons & 4) === 0) clearMiddlePan()
    }

    const handleVisibilityChange = () => {
      if (document.hidden) clearMiddlePan()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('blur', clearMiddlePan)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('blur', clearMiddlePan)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

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

  const handleThumbnailContextMenu = useCallback((e: React.MouseEvent, terminalId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setThumbMenu({ x: e.clientX, y: e.clientY, terminalId })
  }, [])

  // Quick Action horizontal drag handlers
  const handleActionDragStart = useCallback((e: React.DragEvent, actionId: string) => {
    setDraggedActionId(actionId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', actionId)
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.4'
    }
  }, [])

  const handleActionDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1'
    }
    setDraggedActionId(null)
    setDropTargetActionId(null)
  }, [])

  const handleActionDragOver = useCallback((e: React.DragEvent, actionId: string) => {
    if (!draggedActionId || actionId === draggedActionId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    const pos = e.clientX < midX ? 'before' : 'after'

    setDropTargetActionId(actionId)
    setDropActionPosition(pos)
  }, [draggedActionId])

  const handleActionDragLeave = useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      setDropTargetActionId(null)
    }
  }, [])

  const handleActionDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!draggedActionId || draggedActionId === targetId || !onReorderActions || !quickActions) return

    const currentOrder = quickActions.map(a => a.id)
    const draggedIndex = currentOrder.indexOf(draggedActionId)
    if (draggedIndex === -1) return

    currentOrder.splice(draggedIndex, 1)

    let newIndex = currentOrder.indexOf(targetId)
    if (dropActionPosition === 'after') {
      newIndex += 1
    }

    currentOrder.splice(newIndex, 0, draggedActionId)
    onReorderActions(currentOrder)

    setDraggedActionId(null)
    setDropTargetActionId(null)
  }, [draggedActionId, dropActionPosition, quickActions, onReorderActions])

  const handleActionContextMenu = useCallback((e: React.MouseEvent, action: QuickAction) => {
    e.preventDefault()

    const menuWidth = 150
    const menuHeight = 80

    let x = e.clientX
    let y = e.clientY + 2

    if (x + menuWidth > window.innerWidth) {
      x = e.clientX - menuWidth
    }
    if (x < 0) {
      x = 8
    }
    if (y + menuHeight > window.innerHeight) {
      y = e.clientY - menuHeight
    }

    setContextMenu({ action, x, y })
  }, [])

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
          {/* Quick Action Buttons */}
          {quickActions && quickActions.map(action => (
            <div
              key={action.id}
              draggable={!!onReorderActions}
              onDragStart={(e) => handleActionDragStart(e, action.id)}
              onDragEnd={handleActionDragEnd}
              onDragOver={(e) => handleActionDragOver(e, action.id)}
              onDragLeave={handleActionDragLeave}
              onDrop={(e) => handleActionDrop(e, action.id)}
              className={`quick-action-drag-wrapper${
                dropTargetActionId === action.id && draggedActionId !== action.id
                  ? ` drop-${dropActionPosition}`
                  : ''
              }${draggedActionId === action.id ? ' dragging' : ''}`}
            >
              <button
                className="quick-action-btn"
                onClick={() => onExecuteAction?.(action)}
                onContextMenu={(e) => handleActionContextMenu(e, action)}
                title={`${action.label}${action.hotkey ? ` (${action.hotkey})` : ''}`}
                style={{ '--action-color': action.color } as React.CSSProperties}
              >
                <span className="quick-action-icon">{action.icon}</span>
                <span className="quick-action-label">{action.label}</span>
              </button>
              {showAddMenu && createPortal(
                <div className="thumbnail-add-menu" ref={addMenuPopupRef} style={menuStyle}>
                  <div
                    className="thumbnail-add-menu-item"
                    onClick={() => { onAddTerminal(); setShowAddMenu(false) }}
                  >
                    <span className="thumbnail-add-menu-icon">⌘</span>
                    {t('terminal.terminalLabel')}
                  </div>
                  {onAddWorktreeTerminal && (
                    <div
                      className="thumbnail-add-menu-item"
                      onClick={() => { onAddWorktreeTerminal(); setShowAddMenu(false) }}
                    >
                      <span className="thumbnail-add-menu-icon" style={{ color: '#22c55e' }}>🌳</span>
                      {t('terminal.worktreeTerminalLabel')}
                    </div>
                  )}
                  {agentPresets.map(preset => (
                    <div
                      key={preset.id}
                      className="thumbnail-add-menu-item"
                      onClick={() => { onAddAgent?.(preset.id); setShowAddMenu(false) }}
                    >
                      <span className="thumbnail-add-menu-icon" style={{ color: preset.color }}>{preset.icon}</span>
                      {preset.name}
                      {preset.suggested && <span className="thumbnail-add-menu-suggested">suggested</span>}
                    </div>
                  ))}
                  {onAddWorker && (
                    <>
                      <div className="thumbnail-add-menu-separator" />
                      {detectedProcfiles.map(fp => (
                        <div
                          key={fp}
                          className="thumbnail-add-menu-item"
                          onClick={() => { onAddWorker(fp); setShowAddMenu(false) }}
                        >
                          <span className="thumbnail-add-menu-icon" style={{ color: '#56b6c2' }}>⚙</span>
                          Worker: {fp.split('/').pop()}
                        </div>
                      ))}
                      <div
                        className="thumbnail-add-menu-item"
                        onClick={() => { onAddWorker(); setShowAddMenu(false) }}
                      >
                        <span className="thumbnail-add-menu-icon" style={{ color: '#888' }}>📂</span>
                        Worker: Open File...
                      </div>
                      <div
                        className="thumbnail-add-menu-hint"
                        onClick={() => window.electronAPI.shell.openExternal('https://github.com/DarthSim/overmind')}
                      >
                        What is a Procfile?
                      </div>
                    </>
                  )}
                </div>,
                document.body
              )}
            </div>
          ))}

          {/* Add Quick Action button */}
          {onCreateAction && (
            <button
              className="quick-action-add-btn"
              onClick={onCreateAction}
              title="Add Quick Action"
            >
              +
            </button>
          )}

          {/* Collapse button */}
          {onCollapse && (
            <button className="thumbnail-collapse-btn" onClick={onCollapse} title={t('terminal.collapsePanel')}>
              ▼
            </button>
          )}
        </div>
      </div>
      <div
        className="thumbnail-list"
        ref={thumbnailListRef}
        onWheel={(e) => {
          const el = thumbnailListRef.current
          if (!el || el.scrollWidth <= el.clientWidth) return
          const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
          if (delta === 0) return
          e.preventDefault()
          el.scrollLeft += delta
        }}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault()
            const el = thumbnailListRef.current
            if (el) middlePanRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft }
          }
        }}
        onMouseMove={(e) => {
          if (!middlePanRef.current) return
          e.preventDefault()
        }}
        onMouseUp={(e) => { if (e.button === 1) middlePanRef.current = null }}
        onAuxClick={(e) => { if (e.button === 1) e.preventDefault() }}
      >
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
            onContextMenu={(e) => handleThumbnailContextMenu(e, terminal.id)}
          >
            <TerminalThumbnail
              terminal={terminal}
              isActive={terminal.id === focusedTerminalId}
              onClick={() => onFocus(terminal.id)}
            />
          </div>
        ))}
      </div>
      {thumbMenu && onCloseTerminal && createPortal(
        <div
          ref={thumbMenuRef}
          className="workspace-context-menu"
          style={thumbMenuPos
            ? { left: thumbMenuPos.x, top: thumbMenuPos.y }
            : { left: thumbMenu.x, top: thumbMenu.y, visibility: 'hidden' as const }
          }
        >
          <div
            className="context-menu-item danger"
            onClick={() => {
              onCloseTerminal(thumbMenu.terminalId)
              setThumbMenu(null)
            }}
          >
            {t('terminal.closeTerminal')}
          </div>
        </div>,
        document.body
      )}

      {/* Quick Action Context Menu */}
      {contextMenu && (
        <QuickActionContextMenu
          action={contextMenu.action}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onEdit={() => {
            onEditAction?.(contextMenu.action)
            setContextMenu(null)
          }}
          onDelete={() => {
            onDeleteAction?.(contextMenu.action.id)
            setContextMenu(null)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
