import { useState, useEffect, useCallback, useRef } from 'react'
import { HighlightedCode } from './PathLinker'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
}

interface FileTreeProps {
  rootPath: string
}

const TEXT_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'css', 'scss', 'less', 'html', 'htm',
  'md', 'txt', 'yml', 'yaml', 'toml', 'xml', 'svg', 'sh', 'bash', 'zsh',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
  'env', 'gitignore', 'editorconfig', 'prettierrc', 'eslintrc',
  'dockerfile', 'makefile', 'cfg', 'ini', 'conf', 'log',
])

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])

function getFileExt(name: string): string {
  const lower = name.toLowerCase()
  // Handle dotfiles like .gitignore, .env
  if (lower.startsWith('.') && !lower.includes('.', 1)) {
    return lower.substring(1)
  }
  return lower.split('.').pop() || ''
}

function canPreview(name: string): 'text' | 'image' | null {
  const ext = getFileExt(name)
  if (TEXT_EXTS.has(ext)) return 'text'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return null
}

function FileTreeNode({
  entry, depth, selectedPath, onSelect, onContextMenu,
}: {
  entry: FileEntry; depth: number; selectedPath: string | null; onSelect: (entry: FileEntry) => void
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const handleClick = useCallback(async () => {
    if (entry.isDirectory) {
      if (expanded) {
        setExpanded(false)
        return
      }
      if (children === null) {
        setLoading(true)
        try {
          const entries = await window.electronAPI.fs.readdir(entry.path)
          setChildren(entries)
        } catch {
          setChildren([])
        }
        setLoading(false)
      }
      setExpanded(true)
    } else {
      onSelect(entry)
    }
  }, [entry, expanded, children, onSelect])

  const icon = entry.isDirectory
    ? (expanded ? '📂' : '📁')
    : getFileIcon(entry.name)

  const isSelected = !entry.isDirectory && entry.path === selectedPath

  return (
    <>
      <div
        className={`file-tree-item ${entry.isDirectory ? 'file-tree-folder' : 'file-tree-file'} ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, entry)}
      >
        <span className="file-tree-icon">{icon}</span>
        <span className="file-tree-name">{entry.name}</span>
        {loading && <span className="file-tree-loading">...</span>}
      </div>
      {expanded && children && children.map(child => (
        <FileTreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  )
}

function getFileIcon(name: string): string {
  const ext = getFileExt(name)
  switch (ext) {
    case 'ts': case 'tsx': return '🔷'
    case 'js': case 'jsx': return '🟡'
    case 'json': return '📋'
    case 'css': case 'scss': case 'less': return '🎨'
    case 'html': case 'htm': return '🌐'
    case 'md': return '📝'
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': return '🖼️'
    case 'sh': case 'bash': case 'zsh': return '⚙️'
    case 'yml': case 'yaml': case 'toml': return '⚙️'
    case 'lock': return '🔒'
    case 'py': return '🐍'
    case 'go': return '🔵'
    case 'rs': return '🦀'
    default: return '📄'
  }
}

function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre><code>${code.replace(/\n$/, '')}</code></pre>`)

  // Headers
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr/>')

  // Images (before links)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%"/>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Unordered lists
  html = html.replace(/^[\s]*[-*]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

  // Blockquote
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>')

  // Paragraphs: wrap remaining non-tag lines
  html = html.replace(/^(?!<[a-z/])(.*\S.*)$/gm, '<p>$1</p>')

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '')

  return html
}

function FilePreview({ filePath, fileName, refreshKey }: { filePath: string; fileName: string; refreshKey: number }) {
  const [content, setContent] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'source' | 'rendered'>('rendered')
  const isMarkdown = getFileExt(fileName) === 'md'

  useEffect(() => {
    let cancelled = false
    setContent(null)
    setImageUrl(null)
    setError(null)
    setLoading(true)

    const type = canPreview(fileName)
    if (type === 'text') {
      window.electronAPI.fs.readFile(filePath).then(result => {
        if (cancelled) return
        if (result.error) {
          setError(result.error === 'File too large' ? `File too large (${Math.round((result.size || 0) / 1024)}KB)` : result.error)
        } else {
          setContent(result.content || '')
        }
        setLoading(false)
      })
    } else if (type === 'image') {
      window.electronAPI.image.readAsDataUrl(filePath).then(url => {
        if (cancelled) return
        setImageUrl(url)
        setLoading(false)
      }).catch(() => {
        if (cancelled) return
        setError('Failed to load image')
        setLoading(false)
      })
    } else {
      setError('Preview not available for this file type')
      setLoading(false)
    }

    return () => { cancelled = true }
  }, [filePath, fileName, refreshKey])

  if (loading) {
    return <div className="file-preview-status">Loading...</div>
  }

  if (error) {
    return <div className="file-preview-status">{error}</div>
  }

  if (imageUrl) {
    return (
      <div className="file-preview-image">
        <img src={imageUrl} alt={fileName} />
      </div>
    )
  }

  if (content !== null) {
    return (
      <>
        {isMarkdown && (
          <div className="file-preview-mode-bar">
            <button className={`git-diff-mode-btn${viewMode === 'rendered' ? ' active' : ''}`} onClick={() => setViewMode('rendered')}>Preview</button>
            <button className={`git-diff-mode-btn${viewMode === 'source' ? ' active' : ''}`} onClick={() => setViewMode('source')}>Source</button>
          </div>
        )}
        {isMarkdown && viewMode === 'rendered'
          ? <div className="file-preview-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
          : <HighlightedCode code={content} ext={getFileExt(fileName)} className="file-preview-text" />
        }
      </>
    )
  }

  return null
}

export function FileTree({ rootPath }: Readonly<FileTreeProps>) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)
  const restoredRef = useRef(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const loadRoot = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.fs.readdir(rootPath)
      setEntries(result)
    } catch {
      setEntries([])
    }
    setLoading(false)
  }, [rootPath])

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1)
    loadRoot()
  }, [loadRoot])

  useEffect(() => {
    loadRoot()
  }, [loadRoot])

  // Watch for file system changes and auto-refresh
  useEffect(() => {
    window.electronAPI.fs.watch(rootPath)
    const unsubscribe = window.electronAPI.fs.onChanged((changedPath: string) => {
      if (changedPath === rootPath) {
        setRefreshKey(k => k + 1)
        loadRoot()
      }
    })
    return () => {
      unsubscribe()
      window.electronAPI.fs.unwatch(rootPath)
    }
  }, [rootPath, loadRoot])

  // Close context menu on outside click
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

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await window.electronAPI.fs.search(rootPath, q)
        setSearchResults(results)
      } catch {
        setSearchResults([])
      }
      setSearching(false)
    }, 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery, rootPath])

  // Restore last selected file on mount
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const storageKey = `file-tree-selected:${rootPath}`
    const saved = localStorage.getItem(storageKey)
    if (!saved) return
    try {
      const { path, name } = JSON.parse(saved)
      // Check if file still exists
      window.electronAPI.fs.readFile(path).then(result => {
        if (!result.error) {
          setSelectedFile({ path, name, isDirectory: false })
        } else {
          localStorage.removeItem(storageKey)
        }
      })
    } catch {
      localStorage.removeItem(storageKey)
    }
  }, [rootPath])

  const handleSelect = useCallback((entry: FileEntry) => {
    setSelectedFile(entry)
    localStorage.setItem(`file-tree-selected:${rootPath}`, JSON.stringify({ path: entry.path, name: entry.name }))
  }, [rootPath])

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }, [])

  const getRelativePath = useCallback((filePath: string) => {
    // Normalize separators and compute relative path
    const norm = (p: string) => p.replace(/\\/g, '/')
    const rel = norm(filePath).replace(norm(rootPath), '').replace(/^\//, '')
    return rel
  }, [rootPath])

  const handleCopyRelativePath = useCallback(() => {
    if (!contextMenu) return
    navigator.clipboard.writeText(getRelativePath(contextMenu.entry.path))
    setContextMenu(null)
  }, [contextMenu, getRelativePath])

  const handleCopyAbsolutePath = useCallback(() => {
    if (!contextMenu) return
    navigator.clipboard.writeText(contextMenu.entry.path)
    setContextMenu(null)
  }, [contextMenu])

  const handleOpenInExplorer = useCallback(() => {
    if (!contextMenu) return
    const target = contextMenu.entry.isDirectory
      ? contextMenu.entry.path
      : contextMenu.entry.path.replace(/[\\/][^\\/]+$/, '') // parent dir
    window.electronAPI.shell.openPath(target)
    setContextMenu(null)
  }, [contextMenu])

  if (loading && entries.length === 0) {
    return <div className="file-tree-empty">Loading...</div>
  }

  if (entries.length === 0) {
    return <div className="file-tree-empty">No files found</div>
  }

  const displayEntries = searchResults !== null ? searchResults : entries

  return (
    <div className="file-tree-split">
      <div className="file-tree">
        <div className="file-tree-header">
          <input
            className="file-tree-search"
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="file-tree-refresh-btn" onClick={handleRefresh} title="Refresh">↻</button>
        </div>
        <div className="file-tree-list">
          {searching && <div className="file-tree-item file-tree-loading-row">Searching...</div>}
          {searchResults !== null ? (
            // Search results: flat list with relative paths
            displayEntries.map(entry => (
              <div
                key={entry.path}
                className={`file-tree-item file-tree-file ${entry.path === selectedFile?.path ? 'selected' : ''}`}
                style={{ paddingLeft: '12px' }}
                onClick={() => {
                  if (!entry.isDirectory) handleSelect(entry)
                }}
                onContextMenu={(e) => handleContextMenu(e, entry)}
              >
                <span className="file-tree-icon">{entry.isDirectory ? '📁' : getFileIcon(entry.name)}</span>
                <span className="file-tree-name file-tree-search-path">{getRelativePath(entry.path)}</span>
              </div>
            ))
          ) : (
            entries.map(entry => (
              <FileTreeNode
                key={`${entry.path}:${refreshKey}`}
                entry={entry}
                depth={0}
                selectedPath={selectedFile?.path || null}
                onSelect={handleSelect}
                onContextMenu={handleContextMenu}
              />
            ))
          )}
          {searchResults !== null && searchResults.length === 0 && !searching && (
            <div className="file-tree-empty">No matches</div>
          )}
        </div>
      </div>
      <div className="file-preview">
        {selectedFile ? (
          <>
            <div className="file-preview-header">
              <span className="file-preview-filename">{selectedFile.name}</span>
              <button className="file-tree-refresh-btn" onClick={handleRefresh} title="Refresh">↻</button>
            </div>
            <div className="file-preview-body">
              <FilePreview filePath={selectedFile.path} fileName={selectedFile.name} refreshKey={refreshKey} />
            </div>
          </>
        ) : (
          <div className="file-preview-status">Select a file to preview</div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="workspace-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="context-menu-item" onClick={handleCopyRelativePath}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            Copy Relative Path
          </div>
          <div className="context-menu-item" onClick={handleCopyAbsolutePath}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              <line x1="8" y1="10" x2="16" y2="10" />
              <line x1="8" y1="14" x2="12" y2="14" />
            </svg>
            Copy Absolute Path
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-item" onClick={handleOpenInExplorer}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Open in Explorer
          </div>
        </div>
      )}
    </div>
  )
}
