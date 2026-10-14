import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { routes } from '../routes.ts'
import { get, post, reset, signIn } from '../test-helpers.ts'

describe('franchises', () => {
  let cookie = ''
  beforeEach(async () => {
    reset()
    cookie = await signIn()
    await post(routes.franchiseCreate.href(), { name: 'Persona' }, cookie)
  })
  let page = async (query = '') => (await get(routes.home.href() + query, cookie)).text()
  let add = (fields: Record<string, string>) =>
    post(routes.itemCreate.href(), { type: 'game', status: 'ongoing', ...fields }, cookie)

  it('refuses a name already taken, in any case, and confirms deleting', async () => {
    await post(routes.franchiseCreate.href(), { name: 'persona' }, cookie)
    let franchisePage = await (await get(routes.franchises.href(), cookie)).text()
    assert.equal(franchisePage.match(/name="name" value="/g)?.length, 1)
    // Deleting a franchise is confirmed in a dialog holding the only delete form.
    assert.match(franchisePage, /popovertarget="confirm-franchise-1"/)
    assert.match(franchisePage, /id="confirm-franchise-1"[^>]*popover[^]*action="\/franchises\/1\/delete"/)
    assert.equal(franchisePage.split('/franchises/1/delete').length, 2)
    assert.match(franchisePage, /<h2>Delete this franchise\?<\/h2><p><strong>Persona<\/strong> will be removed\. No titles belong to it\./)
    assert.match(franchisePage, /popovertarget="confirm-franchise-1" popovertargetaction="hide"[^>]*>Cancel</)
  })

  it('takes titles into an existing franchise, named in any case', async () => {
    // A franchise must exist before a title can pick it.
    assert.equal((await add({ title: 'x', franchise: 'Tidak Ada' })).status, 400)
    await add({ title: 'Persona 5', franchise: 'persona' })
    await add({ title: 'Celeste' })
    let listed = await page('?franchise=1')
    assert.match(listed, /Persona 5/)
    assert.doesNotMatch(listed, /Celeste/)
    // The form's field only takes those names, also without JavaScript.
    await post(routes.franchiseCreate.href(), { name: 'Fate/stay night (2006)' }, cookie)
    assert.ok((await page()).includes('pattern="Fate\\/stay night \\(2006\\)|Persona"'))
  })

  it('keeps the titles of a deleted franchise, without one', async () => {
    await add({ title: 'Persona 5', franchise: 'Persona' })
    await add({ title: 'Celeste', status: 'finished' })
    // The dialog says so first.
    let franchisePage = await (await get(routes.franchises.href(), cookie)).text()
    assert.match(franchisePage, /Its 1 title stays in your list, without a franchise\./)
    await post(routes.franchiseDelete.href({ id: 1 }), {}, cookie)
    let after = await page()
    assert.match(after, /Persona 5/)
    assert.match(after, /1 of 2 titles finished/)
    assert.doesNotMatch(after, /data-franchise=/)
  })
})
