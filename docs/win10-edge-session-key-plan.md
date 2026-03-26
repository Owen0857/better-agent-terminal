# Plan: Windows 10 Edge Session Key for Usage Polling

## Problem

On Windows, `getSessionKeyFromChrome()` in `electron/main.ts` hard-returns `null`:

```ts
if (process.platform !== 'darwin') return null
```

This means **all Windows users fall through to OAuth**, which has strict rate limits.
OAuth constantly returns 429 → stale `--% usage` indicator appears within minutes.

The comment in `workspace-store.ts` already documents the symptom:
> "OAuth always rate-limits on Windows and exponential backoff causes 1.5h+ staleness"

## Solution

Extract session key from **Microsoft Edge** cookies (built-in on Win10/11).

### Key differences from macOS Chrome path

| | macOS Chrome | Windows Edge |
|---|---|---|
| Cookie DB path | `~/Library/Application Support/Google/Chrome/Default/Cookies` | `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Network\Cookies` |
| Cookie encryption | AES-128-CBC, key from Keychain (`Chrome Safe Storage`) | DPAPI (`CryptUnprotectData`) via `dpapi-bindings` or PowerShell |
| SQLite query | Same schema | Same schema |

### Implementation Steps

#### 1. Add Windows Edge session key extraction in `electron/main.ts`

Add a new function `getSessionKeyFromEdge()` alongside the existing `getSessionKeyFromChrome()`:

```ts
async function getSessionKeyFromEdge(): Promise<{ sessionKey: string; cfClearance: string | null } | null> {
  if (process.platform !== 'win32') return null

  const now = Date.now()
  if (_cachedSessionKey && now - _sessionKeyCacheTime < SESSION_KEY_CACHE_TTL) {
    return { sessionKey: _cachedSessionKey, cfClearance: _cachedCfClearance }
  }

  try {
    const os = await import('os')
    const edgeCookiePath = path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'Microsoft', 'Edge', 'User Data', 'Default', 'Network', 'Cookies'
    )
    try { await fs.access(edgeCookiePath) } catch { return null }

    // Copy to temp to avoid WAL lock
    const tmpDb = path.join(os.tmpdir(), 'bat-edge-cookies.db')
    await fs.copyFile(edgeCookiePath, tmpDb)
    try { await fs.copyFile(edgeCookiePath + '-wal', tmpDb + '-wal') } catch { /* ok */ }
    try { await fs.copyFile(edgeCookiePath + '-shm', tmpDb + '-shm') } catch { /* ok */ }

    // Query raw encrypted values
    const { execSync } = await import('child_process')
    const rawOutput = execSync(
      `sqlite3 "${tmpDb}" "SELECT name, hex(encrypted_value) FROM cookies WHERE host_key LIKE '%claude.ai%' AND name IN ('sessionKey','cf_clearance');"`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()

    try { await fs.unlink(tmpDb) } catch { /* ok */ }
    try { await fs.unlink(tmpDb + '-wal') } catch { /* ok */ }
    try { await fs.unlink(tmpDb + '-shm') } catch { /* ok */ }

    if (!rawOutput) return null

    let sessionKey: string | null = null
    let cfClearance: string | null = null

    for (const line of rawOutput.split('\n')) {
      const [name, hex] = line.split('|')
      if (!hex) continue

      // Edge on Windows uses DPAPI for encryption
      // Encrypted value format: 3-byte version prefix + ciphertext
      // v10 prefix → AES-256-GCM with local state key (newer Edge)
      // No prefix or DPAPI prefix → CryptUnprotectData
      const decrypted = await decryptEdgeCookieWindows(hex)
      if (!decrypted) continue

      if (name === 'sessionKey') {
        const idx = decrypted.indexOf('sk-ant-sid')
        sessionKey = idx >= 0 ? decrypted.substring(idx) : decrypted
      } else if (name === 'cf_clearance') {
        cfClearance = decrypted
      }
    }

    if (!sessionKey || sessionKey.length < 10) return null

    _cachedSessionKey = sessionKey
    _cachedCfClearance = cfClearance
    _sessionKeyCacheTime = now
    logger.log('[usage] Extracted session key from Edge (length:', sessionKey.length, ')')
    return { sessionKey, cfClearance }
  } catch (e) {
    logger.error('[usage] Failed to extract Edge session key:', e)
    return null
  }
}
```

#### 2. Implement `decryptEdgeCookieWindows()`

Edge on Windows has two encryption schemes:

**Scheme A — DPAPI (older / profile-level)**
The encrypted_value blob starts with no version prefix or a DPAPI header.
Use PowerShell to call `CryptUnprotectData`:

```ts
async function decryptEdgeCookieWindows(encHex: string): Promise<string | null> {
  try {
    const { execSync } = await import('child_process')
    // PowerShell: decode hex → call DPAPI → output UTF-8 string
    const ps = `
      $bytes = [byte[]] -split ('${encHex}' -replace '..', '0x$& ')
      Add-Type -AssemblyName System.Security
      $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
      [System.Text.Encoding]::UTF8.GetString($plain)
    `
    const result = execSync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/\n\s*/g, ' ')}"`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    return result || null
  } catch { return null }
}
```

**Scheme B — AES-256-GCM with Local State key (newer Edge / Chromium 80+)**
If `encrypted_value` starts with `v10` (hex `763130`), the cookie is encrypted with a key stored in `%LOCALAPPDATA%\Microsoft\Edge\User Data\Local State` (JSON field `os_crypt.encrypted_key`).
That key itself is DPAPI-encrypted and base64-encoded.

For Scheme B, the decryption sequence is:
1. Read `Local State` JSON → `os_crypt.encrypted_key` (base64)
2. Strip the `DPAPI` prefix (first 5 bytes)
3. DPAPI-decrypt the remainder → 32-byte AES key
4. Use that key to AES-256-GCM decrypt the cookie value (nonce = bytes 3–15, ciphertext = bytes 15+)

See Chromium source: `components/os_crypt/sync/os_crypt_win.cc`

#### 3. Update `fetchUsageViaSessionKey()` to try Edge on Windows

```ts
async function getSessionKeyFromChrome(): Promise<{ sessionKey: string; cfClearance: string | null } | null> {
  if (process.platform === 'darwin') {
    return getSessionKeyFromChromeMac()
  }
  if (process.platform === 'win32') {
    return getSessionKeyFromEdge()
  }
  return null
}
```

Rename the existing macOS implementation to `getSessionKeyFromChromeMac()`.

#### 4. Update `claude:get-usage` handler

No changes needed — the existing `fetchUsageViaSessionKey()` call already handles the fallback chain correctly.

---

## Edge Cases & Risks

| Risk | Mitigation |
|------|-----------|
| Edge not installed | `fs.access()` check returns null → OAuth fallback |
| Edge profile DB locked by Edge process | Copy to temp before opening (already in plan) |
| Scheme B (AES-GCM) cookie format | Detect `v10` hex prefix, branch decryption logic |
| PowerShell execution policy | Use `-ExecutionPolicy Bypass` (already done for PTY) |
| User not logged into claude.ai via Edge | `sessionKey` not found → OAuth fallback |
| sqlite3 not in PATH on Windows | Could use `better-sqlite3` (already a dep) instead of execSync |

**Recommendation**: Use `better-sqlite3` instead of `execSync sqlite3` — it's already a dependency (`snippet-db.ts`), avoids PATH dependency, and is safer cross-platform.

---

## Secondary Issue: appendScrollback O(n) Array Spread

`workspace-store.ts:417`:
```ts
scrollbackBuffer: [...t.scrollbackBuffer, data]
```

Every PTY data event (potentially hundreds/sec) spreads the entire array.
Since `notify()` is NOT called here, there's no React re-render — but GC pressure accumulates.

**Fix**: Since immutability isn't required (no notify), mutate directly:
```ts
appendScrollback(id: string, data: string): void {
  const terminal = this.state.terminals.find(t => t.id === id)
  if (terminal) {
    terminal.scrollbackBuffer.push(data)  // direct mutation, no GC pressure
  }
}
```
Or cap the buffer size (e.g., last 1000 entries) to bound memory usage.

---

## Testing Checklist

- [ ] Edge installed, logged into claude.ai → usage shows correctly
- [ ] Edge installed, NOT logged in → falls back to OAuth gracefully
- [ ] Edge not installed → falls back to OAuth gracefully
- [ ] Edge DB locked (Edge running) → temp copy succeeds, no crash
- [ ] Rate-limit from OAuth still handled correctly as secondary fallback
- [ ] Stale indicator behavior unchanged
