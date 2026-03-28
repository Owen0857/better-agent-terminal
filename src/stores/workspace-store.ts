import { v4 as uuidv4 } from 'uuid'
import type { Workspace, TerminalInstance, AppState } from '../types'
import { AgentPresetId, getAgentPreset } from '../types/agent-presets'
import { clearPreviewCache } from '../components/TerminalThumbnail'
import { settingsStore } from './settings-store'

type Listener = () => void

class WorkspaceStore {
  private state: AppState = {
    workspaces: [],
    activeWorkspaceId: null,
    terminals: [],
    activeTerminalId: null,
    focusedTerminalId: null
  }

  private activeGroup: string | null = null
  private listeners: Set<Listener> = new Set()

  // Global Claude usage (shared across all panels)
  // Primary source: SDK rate_limit_event (fires on every query, persisted to localStorage)
  // Fallback: adaptive polling (cold-start / no session history), backs off on rate limits
  private _claudeUsage: { fiveHour: number | null; sevenDay: number | null; fiveHourReset: string | null; sevenDayReset: string | null; fiveHourStale?: boolean; sevenDayStale?: boolean /* unused — 7d changes slowly, always show last known value */ } | null = null
  private _usageTimer: ReturnType<typeof setTimeout> | null = null
  private _usagePollingStarted = false
  private _usageInflight = false
  private _usageRateLimited = false                  // true while in rate-limit backoff — blocks refreshUsageNow
  private _usageRateLimitStreak = 0                 // consecutive 429s — drives cumulative backoff
  private _usageBaseInterval = 10 * 60 * 1000       // 10 min idle (SDK events are primary source)
  private _usageCurrentInterval = 10 * 60 * 1000
  private _usageMaxInterval = 10 * 60 * 1000        // 10 min max backoff
  private _usageMinInterval = 60 * 1000              // 1 min min (after activity)
  private _visibilityHandler: (() => void) | null = null
  // One-shot timer: starts on first failure, cancelled on success, fires once to mark stale
  private _fiveHourStaleTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly _FIVE_HOUR_STALE_MS = 10 * 60 * 1000  // 10 min without data → show --%
  private static readonly _USAGE_CACHE_KEY = 'bat_claude_usage_cache'

  get claudeUsage() { return this._claudeUsage }

  /** Pacing analysis for 5h window: compare utilization vs time elapsed percentage.
   *  Returns null if data is insufficient. */
  getUsagePacing(): { onPace: boolean; timeElapsedPct: number; estimatedMinutesToLimit: number | null } | null {
    const u = this._claudeUsage
    if (!u || u.fiveHour == null || !u.fiveHourReset) return null

    const now = Date.now()
    const resetMs = new Date(u.fiveHourReset).getTime()
    const periodMs = 5 * 3600_000
    const remainingMs = Math.max(0, resetMs - now)
    const elapsedMs = periodMs - remainingMs
    if (elapsedMs <= 0) return null

    const timeElapsedPct = (elapsedMs / periodMs) * 100
    const onPace = u.fiveHour <= timeElapsedPct

    // Predict time to 100% based on current burn rate, capped to remaining window
    let estimatedMinutesToLimit: number | null = null
    if (u.fiveHour > 0) {
      const ratePerMs = u.fiveHour / elapsedMs
      const remaining = 100 - u.fiveHour
      if (ratePerMs > 0) {
        const remainingMin = Math.round(remainingMs / 60_000)
        estimatedMinutesToLimit = Math.min(Math.round(remaining / ratePerMs / 60_000), remainingMin)
      }
    }

    return { onPace, timeElapsedPct, estimatedMinutesToLimit }
  }

  /** Persist current usage to localStorage so it survives app restarts */
  private _persistUsage() {
    if (!this._claudeUsage) return
    try {
      const { fiveHourStale: _, ...data } = this._claudeUsage
      localStorage.setItem(WorkspaceStore._USAGE_CACHE_KEY, JSON.stringify({
        ...data,
        savedAt: new Date().toISOString(),
      }))
    } catch { /* quota exceeded or unavailable — non-fatal */ }
  }

  /** Restore persisted usage on startup; clears components whose resetsAt has already passed */
  private _loadPersistedUsage() {
    try {
      const raw = localStorage.getItem(WorkspaceStore._USAGE_CACHE_KEY)
      if (!raw) return
      const cached = JSON.parse(raw) as {
        fiveHour: number | null; sevenDay: number | null
        fiveHourReset: string | null; sevenDayReset: string | null
        savedAt?: string
      }
      const now = Date.now()
      const fiveResetMs = cached.fiveHourReset ? new Date(cached.fiveHourReset).getTime() : null
      const sevenResetMs = cached.sevenDayReset ? new Date(cached.sevenDayReset).getTime() : null
      // If the reset time has already passed, the limit has rolled over — clear that slot
      const fiveExpired = fiveResetMs !== null && now > fiveResetMs
      const sevenExpired = sevenResetMs !== null && now > sevenResetMs
      // Load as not-stale — SDK event or successful poll will confirm freshness.
      // The stale timer started by the first failed poll will mark stale if no data arrives.
      this._claudeUsage = {
        fiveHour:      fiveExpired  ? null : cached.fiveHour,
        fiveHourReset: fiveExpired  ? null : cached.fiveHourReset,
        sevenDay:      sevenExpired ? null : cached.sevenDay,
        sevenDayReset: sevenExpired ? null : cached.sevenDayReset,
        fiveHourStale: false,
      }
      this.notify()
    } catch { /* corrupt cache — ignore, polling will populate fresh data */ }
  }

  private _clearFiveHourStaleTimer() {
    if (this._fiveHourStaleTimer) {
      clearTimeout(this._fiveHourStaleTimer)
      this._fiveHourStaleTimer = null
    }
  }

  /** Start the stale timer only if not already running and not already stale.
   *  If the current poll interval already exceeds the stale threshold (e.g. 30min backoff or
   *  server-directed rate limit), mark stale immediately — waiting 10min would show stale data
   *  as fresh during a window where we know no poll is coming. */
  private _startFiveHourStaleTimerIfNeeded() {
    if (this._fiveHourStaleTimer !== null) return   // timer already running — don't reset
    if (this._claudeUsage?.fiveHourStale) return    // already stale — nothing to do
    if (this._usageCurrentInterval > WorkspaceStore._FIVE_HOUR_STALE_MS) {
      // Next poll is further away than the stale window — no point waiting for the timer
      const prev = this._claudeUsage ?? { fiveHour: null, sevenDay: null, fiveHourReset: null, sevenDayReset: null }
      this._claudeUsage = { ...prev, fiveHourStale: true }
      window.electronAPI.debug.log(`[usage:poll] stale immediately — next poll in ${this._usageCurrentInterval / 60000}min`)
      this.notify()
      return
    }
    this._fiveHourStaleTimer = setTimeout(() => {
      this._fiveHourStaleTimer = null
      const prev = this._claudeUsage ?? { fiveHour: null, sevenDay: null, fiveHourReset: null, sevenDayReset: null }
      this._claudeUsage = { ...prev, fiveHourStale: true }
      window.electronAPI.debug.log(`[usage:poll] stale — no data for ${WorkspaceStore._FIVE_HOUR_STALE_MS / 60000} min`)
      this.notify()
    }, WorkspaceStore._FIVE_HOUR_STALE_MS)
  }

  private async _fetchUsage() {
    if (this._usageInflight) return
    this._usageInflight = true
    try {
      const u = await window.electronAPI.claude.getUsage()
      if (!u) {
        // null = both auth methods returned non-OK (e.g. 401/403/5xx) — counts as a failure
        this._startFiveHourStaleTimerIfNeeded()
        return
      }

      // Handle rate-limit response from main process
      // Use server's retryAfterSec directly — do not double existing interval,
      // since OAuth always rate-limits on Windows and exponential backoff causes 1.5h+ staleness
      if ('rateLimited' in u && (u as any).rateLimited) {
        this._usageRateLimitStreak++
        // cumulative backoff: 120s → 240s → 480s → 600s (10 min cap), ignores server retry-after
        const backoffMs = Math.min(120_000 * Math.pow(2, this._usageRateLimitStreak - 1), this._usageMaxInterval)
        this._usageCurrentInterval = backoffMs
        this._usageRateLimited = true
        window.electronAPI.debug.log(`[usage:poll] rate-limited (streak=${this._usageRateLimitStreak}), retry in ${Math.round(backoffMs / 1000)}s`)
        this._startFiveHourStaleTimerIfNeeded()
        return
      }

      // Success — cancel stale timer, clear stale flag, reset poll interval
      // Merge with existing state: prefer poll values, fall back to prior SDK event values for null fields
      this._clearFiveHourStaleTimer()
      this._usageRateLimited = false
      this._usageRateLimitStreak = 0
      this._usageCurrentInterval = this._usageBaseInterval
      const prev = this._claudeUsage ?? { fiveHour: null, sevenDay: null, fiveHourReset: null, sevenDayReset: null }
      const polled = u as any
      window.electronAPI.debug.log(`[usage:poll] OK 5h=${polled.fiveHour} 7d=${polled.sevenDay} 5hReset=${polled.fiveHourReset} 7dReset=${polled.sevenDayReset}`)
      this._claudeUsage = {
        fiveHour:      polled.fiveHour      ?? prev.fiveHour,
        sevenDay:      polled.sevenDay      ?? prev.sevenDay,
        fiveHourReset: polled.fiveHourReset ?? prev.fiveHourReset,
        sevenDayReset: polled.sevenDayReset ?? prev.sevenDayReset,
        fiveHourStale: false,
      }
      this._persistUsage()
      this.notify()
    } catch {
      // Network error — clear rate-limit flag (different failure type), double interval
      this._usageRateLimited = false
      this._usageCurrentInterval = Math.min(this._usageCurrentInterval * 2, this._usageMaxInterval)
      this._startFiveHourStaleTimerIfNeeded()
    } finally {
      this._usageInflight = false
    }
  }

  private _scheduleNextPoll() {
    if (!this._usagePollingStarted) return
    if (this._usageTimer) clearTimeout(this._usageTimer)
    this._usageTimer = setTimeout(async () => {
      await this._fetchUsage()
      this._scheduleNextPoll()
    }, this._usageCurrentInterval)
  }

  startUsagePolling() {
    if (this._usagePollingStarted) return
    this._usagePollingStarted = true

    // Restore last known values immediately so UI isn't blank on startup
    this._loadPersistedUsage()

    // Initial fetch
    this._fetchUsage().then(() => this._scheduleNextPoll())

    // Visibility-aware: pause when hidden, immediate refresh on focus
    this._visibilityHandler = () => {
      if (document.hidden) {
        // Pause polling when tab/window is hidden
        if (this._usageTimer) {
          clearTimeout(this._usageTimer)
          this._usageTimer = null
        }
      } else {
        // Window regained focus — fetch immediately then resume schedule
        this._fetchUsage().then(() => this._scheduleNextPoll())
      }
    }
    document.addEventListener('visibilitychange', this._visibilityHandler)
  }

  /** Update usage from SDK rate_limit_event — no API call needed.
   *  utilization may be undefined (SDK often omits it); resetsAt is usually present. */
  applyRateLimitEvent(info: { rateLimitType: string; utilization?: number; resetsAt?: number }) {
    const prev = this._claudeUsage ?? { fiveHour: null, sevenDay: null, fiveHourReset: null, sevenDayReset: null }
    const resetIso = info.resetsAt ? new Date(info.resetsAt).toISOString() : null
    if (info.rateLimitType === 'five_hour') {
      this._clearFiveHourStaleTimer()
      this._claudeUsage = {
        ...prev,
        fiveHour: info.utilization ?? prev.fiveHour,     // keep existing if SDK omits
        fiveHourReset: resetIso ?? prev.fiveHourReset,
        fiveHourStale: false,
      }
    } else if (info.rateLimitType === 'seven_day' || info.rateLimitType === 'seven_day_opus' || info.rateLimitType === 'seven_day_sonnet') {
      this._claudeUsage = {
        ...prev,
        sevenDay: info.utilization ?? prev.sevenDay,
        sevenDayReset: resetIso ?? prev.sevenDayReset,
      }
    }
    this._persistUsage()
    this.notify()
  }

  /** Call after agent activity (turn completed, session ended) for a timely refresh */
  refreshUsageNow() {
    if (!this._usagePollingStarted) return
    // Skip if in rate-limit backoff — hammering a rate-limited endpoint only extends the ban
    if (this._usageRateLimited) return
    if (this._usageTimer) { clearTimeout(this._usageTimer); this._usageTimer = null }
    this._usageCurrentInterval = this._usageMinInterval
    this._fetchUsage().then(() => this._scheduleNextPoll())
  }

  /** Release all polling resources (timers + event listeners) */
  stopUsagePolling() {
    if (this._usageTimer) { clearTimeout(this._usageTimer); this._usageTimer = null }
    this._clearFiveHourStaleTimer()
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler)
      this._visibilityHandler = null
    }
    this._usagePollingStarted = false
  }

  getState(): AppState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.listeners.forEach(listener => listener())
  }

  // Workspace actions
  addWorkspace(name: string, folderPath: string): Workspace {
    const workspace: Workspace = {
      id: uuidv4(),
      name,
      folderPath,
      createdAt: Date.now()
    }

    this.state = {
      ...this.state,
      workspaces: [...this.state.workspaces, workspace],
      activeWorkspaceId: workspace.id
    }

    this.notify()
    return workspace
  }

  removeWorkspace(id: string): void {
    const terminals = this.state.terminals.filter(t => t.workspaceId !== id)
    const workspaces = this.state.workspaces.filter(w => w.id !== id)

    this.state = {
      ...this.state,
      workspaces,
      terminals,
      activeWorkspaceId: this.state.activeWorkspaceId === id
        ? (workspaces[0]?.id ?? null)
        : this.state.activeWorkspaceId
    }

    this.notify()
  }

  setActiveWorkspace(id: string): void {
    if (this.state.activeWorkspaceId === id) return

    this.state = {
      ...this.state,
      activeWorkspaceId: id,
      focusedTerminalId: null
    }

    this.notify()
  }

  renameWorkspace(id: string, alias: string): void {
    this.state = {
      ...this.state,
      workspaces: this.state.workspaces.map(w =>
        w.id === id ? { ...w, alias: alias.trim() || undefined } : w
      )
    }

    this.notify()
  }

  reorderWorkspaces(workspaceIds: string[]): void {
    const workspaceMap = new Map(this.state.workspaces.map(w => [w.id, w]))
    const reordered = workspaceIds
      .map(id => workspaceMap.get(id))
      .filter((w): w is Workspace => w !== undefined)

    this.state = {
      ...this.state,
      workspaces: reordered
    }

    this.notify()
    this.save()
  }

  // Workspace environment variables
  setWorkspaceEnvVars(id: string, envVars: import('../types').EnvVariable[]): void {
    this.state = {
      ...this.state,
      workspaces: this.state.workspaces.map(w =>
        w.id === id ? { ...w, envVars } : w
      )
    }
    this.notify()
    this.save()
  }

  addWorkspaceEnvVar(id: string, envVar: import('../types').EnvVariable): void {
    const workspace = this.state.workspaces.find(w => w.id === id)
    if (!workspace) return
    const envVars = [...(workspace.envVars || []), envVar]
    this.setWorkspaceEnvVars(id, envVars)
  }

  removeWorkspaceEnvVar(id: string, key: string): void {
    const workspace = this.state.workspaces.find(w => w.id === id)
    if (!workspace) return
    const envVars = (workspace.envVars || []).filter(e => e.key !== key)
    this.setWorkspaceEnvVars(id, envVars)
  }

  updateWorkspaceEnvVar(id: string, key: string, updates: Partial<import('../types').EnvVariable>): void {
    const workspace = this.state.workspaces.find(w => w.id === id)
    if (!workspace) return
    const envVars = (workspace.envVars || []).map(e =>
      e.key === key ? { ...e, ...updates } : e
    )
    this.setWorkspaceEnvVars(id, envVars)
  }

  // SDK session persistence — per terminal
  setTerminalSdkSessionId(terminalId: string, sdkSessionId: string | undefined): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === terminalId ? { ...t, sdkSessionId } : t
      )
    }
    this.notify()
    this.save()
  }

  setTerminalSessionMeta(terminalId: string, meta: { totalCost: number; inputTokens: number; outputTokens: number; durationMs: number; numTurns: number; contextWindow: number }): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === terminalId ? { ...t, sessionMeta: meta } : t
      )
    }
    // Don't notify — this is a background persistence update, no UI re-render needed
    this.save()
  }

  setTerminalPendingPrompt(terminalId: string, prompt: string, images?: string[]): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === terminalId ? { ...t, pendingPrompt: prompt, pendingImages: images } : t
      )
    }
    this.notify()
  }

  // Legacy: also store on workspace for backwards compatibility
  setLastSdkSessionId(workspaceId: string, sdkSessionId: string): void {
    this.state = {
      ...this.state,
      workspaces: this.state.workspaces.map(w =>
        w.id === workspaceId ? { ...w, lastSdkSessionId: sdkSessionId } : w
      )
    }
    this.notify()
    this.save()
  }

  // Terminal actions
  addTerminal(workspaceId: string, agentPreset?: AgentPresetId, options?: { model?: string }): TerminalInstance {
    const workspace = this.state.workspaces.find(w => w.id === workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const existingTerminals = this.state.terminals.filter(
      t => t.workspaceId === workspaceId && !t.agentPreset
    )

    // Get agent preset info for title
    const preset = agentPreset ? getAgentPreset(agentPreset) : null
    const title = preset && preset.id !== 'none'
      ? preset.name
      : 'New Terminal'

    const terminal: TerminalInstance = {
      id: uuidv4(),
      workspaceId,
      type: 'terminal',
      agentPreset,
      title,
      cwd: workspace.folderPath,
      scrollbackBuffer: [],
      lastActivityTime: Date.now(),
      ...(options?.model ? { model: options.model } : {}),
    }

    // Auto-focus if it's an agent terminal or no current focus
    const shouldFocus = (agentPreset && agentPreset !== 'none') || !this.state.focusedTerminalId

    this.state = {
      ...this.state,
      terminals: [...this.state.terminals, terminal],
      focusedTerminalId: shouldFocus ? terminal.id : this.state.focusedTerminalId
    }

    this.notify()
    return terminal
  }

  removeTerminal(id: string): void {
    clearPreviewCache(id)
    const terminals = this.state.terminals.filter(t => t.id !== id)

    this.state = {
      ...this.state,
      terminals,
      focusedTerminalId: this.state.focusedTerminalId === id
        ? (terminals[0]?.id ?? null)
        : this.state.focusedTerminalId
    }

    this.notify()
  }

  renameTerminal(id: string, title: string): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, title } : t
      )
    }

    this.notify()
  }

  setFocusedTerminal(id: string | null): void {
    if (this.state.focusedTerminalId === id) return

    this.state = {
      ...this.state,
      focusedTerminalId: id
    }

    this.notify()
  }

  updateTerminalCwd(id: string, cwd: string): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, cwd } : t
      )
    }

    this.notify()
  }

  updateTerminalModel(id: string, model: string): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, model } : t
      )
    }

    this.notify()
    this.save()
  }

  appendScrollback(id: string, data: string): void {
    // Direct mutation — no notify() means React never reads this via subscription,
    // so immutability provides no benefit; avoids O(n) spread on every PTY data event
    const terminal = this.state.terminals.find(t => t.id === id)
    if (terminal) terminal.scrollbackBuffer.push(data)
  }

  clearScrollback(id: string): void {
    // Immutable update + notify: clears the buffer AND triggers re-render so UI reflects empty state.
    // Must replace the array reference so any component reading scrollbackBuffer sees the change.
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, scrollbackBuffer: [] } : t
      )
    }
    this.notify()
  }

  reorderTerminals(terminalIds: string[]): void {
    const terminalMap = new Map(this.state.terminals.map(t => [t.id, t]))
    const reordered = terminalIds
      .map(id => terminalMap.get(id))
      .filter((t): t is TerminalInstance => t !== undefined)

    // Append any terminals not in the provided list (e.g. from other workspaces)
    for (const t of this.state.terminals) {
      if (!terminalIds.includes(t.id)) {
        reordered.push(t)
      }
    }

    this.state = {
      ...this.state,
      terminals: reordered
    }

    this.notify()
    this.save()
  }

  // Get terminals for current workspace
  getWorkspaceTerminals(workspaceId: string): TerminalInstance[] {
    return this.state.terminals.filter(t => t.workspaceId === workspaceId)
  }

  // Get agent terminal for workspace (first agent terminal, regardless of type)
  getAgentTerminal(workspaceId: string): TerminalInstance | undefined {
    return this.state.terminals.find(
      t => t.workspaceId === workspaceId && t.agentPreset && t.agentPreset !== 'none'
    )
  }

  // Legacy compatibility - alias for getAgentTerminal
  getClaudeCodeTerminal(workspaceId: string): TerminalInstance | undefined {
    return this.getAgentTerminal(workspaceId)
  }

  getRegularTerminals(workspaceId: string): TerminalInstance[] {
    return this.state.terminals.filter(
      t => t.workspaceId === workspaceId && (!t.agentPreset || t.agentPreset === 'none')
    )
  }

  // Group management
  getActiveGroup(): string | null {
    return this.activeGroup
  }

  setActiveGroup(group: string | null): void {
    this.activeGroup = group

    // Auto-select first workspace in the group if current is not visible
    if (group) {
      const visibleWorkspaces = this.state.workspaces.filter(w => w.group === group)
      const currentVisible = visibleWorkspaces.some(w => w.id === this.state.activeWorkspaceId)
      if (!currentVisible && visibleWorkspaces.length > 0) {
        this.state = {
          ...this.state,
          activeWorkspaceId: visibleWorkspaces[0].id,
          focusedTerminalId: null
        }
      } else {
        // Force new reference so React re-renders the sidebar filter
        this.state = { ...this.state }
      }
    } else {
      this.state = { ...this.state }
    }

    this.notify()
    this.save()
  }

  setWorkspaceGroup(id: string, group: string | undefined): void {
    this.state = {
      ...this.state,
      workspaces: this.state.workspaces.map(w =>
        w.id === id ? { ...w, group } : w
      )
    }
    this.notify()
    this.save()
  }

  setWorkspaceColor(id: string, color: string | undefined): void {
    this.state = {
      ...this.state,
      workspaces: this.state.workspaces.map(w =>
        w.id === id ? { ...w, color } : w
      )
    }
    this.notify()
    this.save()
  }

  getGroups(): string[] {
    const groups = new Set<string>()
    for (const w of this.state.workspaces) {
      if (w.group) groups.add(w.group)
    }
    return Array.from(groups).sort()
  }

  // Activity tracking
  private lastActivityNotify: number = 0
  private _savePromise: Promise<void> = Promise.resolve()
  private _savePending = false

  updateTerminalActivity(id: string): void {
    const now = Date.now()
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, lastActivityTime: now } : t
      )
    }
    // Throttle notifications to avoid excessive re-renders (max once per 500ms)
    if (now - this.lastActivityNotify > 500) {
      this.lastActivityNotify = now
      this.notify()
    }
  }

  setTerminalPendingAction(id: string, pending: boolean): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, hasPendingAction: pending } : t
      )
    }
    this.notify()
    this.updateDockBadge()
  }

  private updateDockBadge(): void {
    const settings = settingsStore.getSettings()
    if (settings.showDockBadge === false) return
    const count = this.state.terminals.filter(t => t.hasPendingAction).length
    window.electronAPI?.app?.setDockBadge?.(count)
  }

  getWorkspaceLastActivity(workspaceId: string): number | null {
    const terminals = this.getWorkspaceTerminals(workspaceId)
    const lastActivities = terminals
      .map(t => t.lastActivityTime)
      .filter((time): time is number => time !== undefined)

    return lastActivities.length > 0 ? Math.max(...lastActivities) : null
  }

  // Persistence — serialized to prevent concurrent writes from corrupting the file
  async save(): Promise<void> {
    // If a save is already queued, skip — the queued save will capture the latest state
    if (this._savePending) return
    this._savePending = true

    // Wait for any in-flight save to finish, then perform ours
    this._savePromise = this._savePromise.then(async () => {
      this._savePending = false
      const savedTerminals = this.state.terminals.map(t => ({
        id: t.id,
        workspaceId: t.workspaceId,
        type: t.type,
        agentPreset: t.agentPreset,
        title: t.title,
        alias: t.alias,
        cwd: t.cwd,
        sdkSessionId: t.sdkSessionId,
        model: t.model,
        sessionMeta: t.sessionMeta,
      }))
      const data = JSON.stringify({
        workspaces: this.state.workspaces,
        activeWorkspaceId: this.state.activeWorkspaceId,
        activeGroup: this.activeGroup,
        terminals: savedTerminals,
        activeTerminalId: this.state.activeTerminalId,
      })
      await window.electronAPI.workspace.save(data)
    }).catch(e => {
      console.error('Failed to save workspace data:', e)
    })

    return this._savePromise
  }

  async load(): Promise<void> {
    const data = await window.electronAPI.workspace.load()
    if (data) {
      try {
        const parsed = JSON.parse(data)
        // Restore terminals with empty runtime fields
        const terminals: TerminalInstance[] = (parsed.terminals || []).map((t: Partial<TerminalInstance>) => ({
          id: t.id || '',
          workspaceId: t.workspaceId || '',
          type: 'terminal' as const,
          agentPreset: t.agentPreset,
          title: t.title || 'Terminal',
          alias: t.alias,
          cwd: t.cwd || '',
          sdkSessionId: t.sdkSessionId,
          model: t.model,
          sessionMeta: t.sessionMeta,
          scrollbackBuffer: [],
          pid: undefined,
        }))
        this.state = {
          ...this.state,
          workspaces: parsed.workspaces || [],
          activeWorkspaceId: parsed.activeWorkspaceId || null,
          terminals,
          activeTerminalId: parsed.activeTerminalId || null,
        }
        this.activeGroup = parsed.activeGroup || null
        this.notify()
      } catch (e) {
        window.electronAPI?.debug?.log?.(`Failed to parse workspace data: ${e}`)
        console.error('Failed to parse workspace data:', e)
      }
    }
  }
}

export const workspaceStore = new WorkspaceStore()
