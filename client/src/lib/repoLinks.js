// Links into the GitHub repo. VITE_REPO_URL must end at the ref, e.g. ".../blob/main/".
export const REPO_URL = (
  import.meta.env.VITE_REPO_URL || 'https://github.com/prakhar-parashar-au5/orange_invest_assignment/blob/main/'
).replace(/\/*$/, '/')

// The artifact markdown files live here, and their relative links are relative to it.
export const ARTIFACTS_DIR = 'docs/artifacts/'

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i // http:, https:, mailto:, //host …

/** True for links the client should leave alone: absolute URLs and in-page anchors. */
export function isExternalOrAnchor(href) {
  return !href || href.startsWith('#') || ABSOLUTE.test(href)
}

/**
 * Resolves a repo-relative path against `baseDir` and returns the GitHub URL, or null if the
 * path climbs above the repo root. "../../server/src/app.js" from docs/artifacts/ →
 * ".../blob/main/server/src/app.js". A "#fragment" is kept; a leading "/" means repo root.
 */
export function repoUrl(href, baseDir = '') {
  const [pathPart, hash] = href.split('#')
  const start = pathPart.startsWith('/') ? [] : baseDir.split('/').filter(Boolean)
  const parts = [...start]
  for (const seg of pathPart.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(seg)
  }
  const encoded = parts.map(encodeURIComponent).join('/')
  return `${REPO_URL}${encoded}${hash ? `#${hash}` : ''}`
}
