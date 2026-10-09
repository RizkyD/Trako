import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { markdown } from './markdown.ts'

describe('markdown', () => {
  it('formats paragraphs, line breaks, emphasis, code, links and lists', () => {
    assert.equal(markdown('one\ntwo\n\n\nthree'), '<p>one<br>two</p><p>three</p>')
    assert.equal(
      markdown('**bold**, *italic*, 2 * 3 * 4 and `a *b* c`'),
      '<p><strong>bold</strong>, <em>italic</em>, 2 * 3 * 4 and <code>a *b* c</code></p>',
    )
    assert.equal(
      markdown('[**Wiki**](https://en.wikipedia.org/wiki/Persona_(series)).'),
      '<p><a href="https://en.wikipedia.org/wiki/Persona_(series)" target="_blank" rel="noopener"><strong>Wiki</strong></a>.</p>',
    )
    // Form fields send CRLF; a list can follow a line of its paragraph directly.
    assert.equal(
      markdown('To do:\r\n- beat *it*\r\n  - again\r\nlater'),
      '<p>To do:</p><ul><li>beat <em>it</em></li><li>again</li></ul><p>later</p>',
    )
  })

  it('escapes everything else, so the text cannot add HTML', () => {
    assert.equal(
      markdown(`<script>alert("x")</script> & 'q'`),
      '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>',
    )
    assert.equal(markdown('`<b>`'), '<p><code>&lt;b&gt;</code></p>')
    // Only http and https addresses become links.
    assert.equal(markdown('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>')
    assert.equal(markdown('[x](data:text/html,hi)'), '<p>[x](data:text/html,hi)</p>')
    // A quote cannot end the href early: it stays escaped inside it.
    assert.equal(
      markdown('[x](https://a.b/"onmouseover="alert(1))'),
      '<p><a href="https://a.b/&quot;onmouseover=&quot;alert(1)" target="_blank" rel="noopener">x</a></p>',
    )
    assert.equal(
      markdown('[<img src=x onerror=alert(1)>](https://a.b/?c=1&d=2)'),
      '<p><a href="https://a.b/?c=1&amp;d=2" target="_blank" rel="noopener">&lt;img src=x onerror=alert(1)&gt;</a></p>',
    )
  })
})
