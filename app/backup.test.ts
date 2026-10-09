import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { folderProblem, writeBackup } from './backup.ts'
import { today } from './db.ts'

function tempFolder(t: { after(cleanup: () => void): void }): string {
  let folder = mkdtempSync(join(tmpdir(), 'trako-backups-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  return folder
}

describe('backups', () => {
  it('writes today’s backup and keeps only the newest ones', async (t) => {
    let folder = tempFolder(t)
    let older = ['2020-01-01', '2020-02-01', '2020-03-01', '2020-04-01'].map((day) => `trako-${day}.json`)
    for (let name of [...older, 'trako-export-2020-01-01.json', 'notes.txt']) {
      writeFileSync(join(folder, name), 'old')
    }

    let file = await writeBackup(folder, 3)
    assert.equal(file, join(folder, `trako-${today()}.json`))
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).app, 'trako')
    // Today's and the two newest before it stay; files not named like backups are left alone.
    let kept = ['notes.txt', 'trako-2020-03-01.json', 'trako-2020-04-01.json', 'trako-export-2020-01-01.json']
    assert.deepEqual(readdirSync(folder).sort(), [...kept, `trako-${today()}.json`].sort())

    // Backing up again the same day replaces the file.
    writeFileSync(file, 'stale')
    await writeBackup(folder, 3)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).app, 'trako')
    assert.equal(readdirSync(folder).length, 5)
  })

  it('takes only existing folders given by their full path', async (t) => {
    let folder = tempFolder(t)
    writeFileSync(join(folder, 'file.txt'), '')
    assert.equal(await folderProblem(folder), null)
    // The write test leaves nothing behind.
    assert.deepEqual(readdirSync(folder), ['file.txt'])
    assert.match(String(await folderProblem('backups')), /must be a full path/)
    assert.match(String(await folderProblem(join(folder, 'missing'))), /does not exist/)
    assert.match(String(await folderProblem(join(folder, 'file.txt'))), /does not exist/)
    await assert.rejects(writeBackup(join(folder, 'missing'), 3))
  })
})
