// The little markdown descriptions and notes understand: paragraphs (split on
// blank lines), line breaks, **bold**, *italic*, `code`, [links](https://…)
// and "- " lists. The text is escaped before anything else, so it can never
// bring HTML of its own; only the tags made here are left.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char])

// Code spans and links are cut out first, so nothing inside them is formatted
// again (an address keeps its asterisks). An address may hold one level of
// parentheses, as Wikipedia's do.
const TOKEN = /(`[^`]+`|\[[^\]]+\]\(https?:\/\/(?:[^\s()]|\([^\s()]*\))+\))/
const ITEM = /^\s*- /

const emphasis = (text: string) =>
  text
    .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(\S(?:.*?\S)?)\*/g, '<em>$1</em>')

function inline(line: string): string {
  return escape(line)
    .split(TOKEN)
    .map((part, index) => {
      if (index % 2 === 0) return emphasis(part)
      if (part.startsWith('`')) return `<code>${part.slice(1, -1)}</code>`
      let middle = part.indexOf('](')
      let [label, url] = [part.slice(1, middle), part.slice(middle + 2, -1)]
      return `<a href="${url}" target="_blank" rel="noopener">${emphasis(label)}</a>`
    })
    .join('')
}

export function markdown(text: string): string {
  let html = ''
  for (let block of text.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/)) {
    // Within a block, a run of "- " lines is a list and any other run a paragraph.
    let runs: string[][] = []
    for (let line of block.split('\n')) {
      let run = runs.at(-1)
      if (run && ITEM.test(run[0]) === ITEM.test(line)) run.push(line)
      else runs.push([line])
    }
    for (let run of runs) {
      html += ITEM.test(run[0])
        ? `<ul>${run.map((line) => `<li>${inline(line.replace(ITEM, ''))}</li>`).join('')}</ul>`
        : `<p>${run.map(inline).join('<br>')}</p>`
    }
  }
  return html
}
