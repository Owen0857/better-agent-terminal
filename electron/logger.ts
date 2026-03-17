import * as fs from 'fs'
import * as path from 'path'

const DEBUG_ENABLED = process.argv.includes('--debug') || process.env.BAT_DEBUG === '1'

let logFilePath: string | null = null
let initialized = false

function formatArgs(args: unknown[]): string {
  return args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack || ''}`
    if (typeof a === 'string') return a
    try { return JSON.stringify(a) } catch { return String(a) }
  }).join(' ')
}

function writeToFile(level: string, args: unknown[]) {
  if (!logFilePath) return
  const ts = new Date().toISOString()
  const line = `[${ts}] [${level}] ${formatArgs(args)}\n`
  try {
    fs.appendFileSync(logFilePath, line)
  } catch {
    // Silently ignore write failures
  }
}

/** Initialize logger with proper userData path. Call inside app.whenReady(). */
function init(userDataPath: string) {
  if (initialized) return
  initialized = true
  if (!DEBUG_ENABLED) return

  logFilePath = path.join(userDataPath, 'debug.log')
  const prevPath = path.join(userDataPath, 'debug.prev.log')

  // Rotate: current → prev
  try {
    if (fs.existsSync(logFilePath)) {
      try { fs.unlinkSync(prevPath) } catch { /* ok */ }
      fs.renameSync(logFilePath, prevPath)
    }
  } catch { /* ignore rotation errors */ }

  // Write header
  writeToFile('INFO', [`Debug logging started. PID=${process.pid} argv=${process.argv.join(' ')}`])
}

function log(...args: unknown[]) {
  console.log(...args)
  if (DEBUG_ENABLED) writeToFile('LOG', args)
}

function warn(...args: unknown[]) {
  console.warn(...args)
  if (DEBUG_ENABLED) writeToFile('WARN', args)
}

function error(...args: unknown[]) {
  console.error(...args)
  if (DEBUG_ENABLED) writeToFile('ERROR', args)
}

export const logger = { init, log, warn, error, get enabled() { return DEBUG_ENABLED } }
