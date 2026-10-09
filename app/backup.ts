import { existsSync } from 'node:fs'
import { readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { db, today } from './db.ts'
import { exportData } from './transfer.ts'

// Daily backups: the Export file, written as trako-YYYY-MM-DD.json into the
// folder picked in Settings, keeping the newest few. Only files named exactly
// that way are counted or deleted, so other files in the folder are safe.
const BACKUP = /^trako-\d{4}-\d{2}-\d{2}\.json$/

// The folder ('' while backups are off) and how many backups to keep.
export function backupSettings(): { folder: string; keep: number } {
  let value = (key: string) =>
    (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)
      ?.value
  return { folder: value('backup_dir') ?? '', keep: Number(value('backup_keep') ?? 14) }
}

export function saveBackupSettings(folder: string, keep: number): void {
  let save = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
  save.run('backup_dir', folder)
  save.run('backup_keep', String(keep))
}

// Why a folder cannot take backups, or null when it can.
export async function folderProblem(folder: string): Promise<string | null> {
  if (!isAbsolute(folder)) return 'The backup folder must be a full path, like D:\\Backups\\Trako.'
  if (!(await stat(folder).catch(() => null))?.isDirectory()) {
    return 'That backup folder does not exist.'
  }
  let probe = join(folder, '.trako-write-test')
  try {
    await writeFile(probe, '')
    await rm(probe)
  } catch {
    return 'Trako cannot write to that backup folder.'
  }
  return null
}

// The backups in a folder, oldest first.
export async function listBackups(folder: string): Promise<string[]> {
  return (await readdir(folder)).filter((name) => BACKUP.test(name)).sort()
}

// Writes today's backup, replacing one from earlier today, then deletes all
// but the newest `keep`. Returns the file's path.
export async function writeBackup(folder: string, keep: number): Promise<string> {
  let file = join(folder, `trako-${today()}.json`)
  // Written aside first, so a failed write never leaves a broken backup.
  await writeFile(`${file}.tmp`, await exportData())
  await rename(`${file}.tmp`, file)
  for (let name of (await listBackups(folder)).slice(0, -keep)) await rm(join(folder, name))
  return file
}

// server.ts runs this at start-up and every hour: today's backup, once a
// folder is set, unless it is already there. Failures are logged, never thrown.
export async function backupIfDue(): Promise<void> {
  try {
    let { folder, keep } = backupSettings()
    if (folder && !existsSync(join(folder, `trako-${today()}.json`))) {
      console.log(`Backed up to ${await writeBackup(folder, keep)}`)
    }
  } catch (error) {
    console.error('Automatic backup failed:', error)
  }
}
