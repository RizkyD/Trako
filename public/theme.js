// Loaded as a blocking script in <head> so a saved light/dark choice is applied
// before the first paint (no flash of the other theme).
;(function () {
  var root = document.documentElement

  function apply() {
    var theme = null
    try {
      theme = localStorage.getItem('theme')
    } catch (error) {
      // Storage unavailable: keep following the system setting.
    }
    if (theme === 'light' || theme === 'dark') {
      if (root.dataset.theme !== theme) root.dataset.theme = theme
    } else if (root.dataset.theme) {
      delete root.dataset.theme
    }
  }

  apply()
  // In-app navigation re-renders <html> from the server's markup, which carries
  // no theme. Put the saved choice back as soon as that happens, before paint.
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme'] })
})()
