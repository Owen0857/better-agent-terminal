import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { QuickAction } from '../types'

interface QuickActionContextMenuProps {
  action: QuickAction
  position: { x: number; y: number }
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}

export function QuickActionContextMenu({
  action,
  position,
  onEdit,
  onDelete,
  onClose
}: QuickActionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid immediate close from the same click that opened the menu
    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 0)
    return () => {
      clearTimeout(timerId)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="quick-action-context-menu"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`
      }}
    >
      <div className="context-menu-item" onClick={onEdit}>
        <span className="context-menu-icon">✏️</span>
        Edit
      </div>
      <div
        className={`context-menu-item ${action.builtin ? 'disabled' : ''}`}
        onClick={() => {
          if (!action.builtin) {
            onDelete()
          }
        }}
        title={action.builtin ? 'Builtin actions cannot be deleted' : 'Delete this action'}
      >
        <span className="context-menu-icon">🗑️</span>
        Delete
      </div>
    </div>,
    document.body
  )
}
