/* The popup: connect once, then save the current tab to the Inbox or as a page. */

const $ = (id) => document.getElementById(id)
const show = (el, on) => {
  el.hidden = !on
}
const say = (el, message) => {
  el.textContent = message || ''
  show(el, Boolean(message))
}

let settings = null
let clip = null

async function currentTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true })
  return tab
}

// ---- setup ----

async function connect() {
  const url = normalizeUrl($('url').value)
  const token = $('token').value.trim()
  say($('setup-error'), '')
  if (!url) return say($('setup-error'), 'Enter the address of your Beyond Notes.')
  if (!token.startsWith('bn_')) {
    return say($('setup-error'), 'Paste an API token (it starts with bn_).')
  }
  // ask for access to this one address only, not to every site
  const granted = await ext.permissions.request({ origins: [`${url}/*`] })
  if (!granted) return say($('setup-error'), 'The clipper needs permission to reach that address.')
  $('connect').disabled = true
  try {
    const me = await api({ url, token }, 'GET', '/api/v1/me')
    settings = { url, token, name: me.name || me.email }
    await saveSettings(settings)
    await startClip()
  } catch (err) {
    say($('setup-error'), err.message)
  } finally {
    $('connect').disabled = false
  }
}

// ---- clipping ----

function mode() {
  return document.querySelector('input[name=mode]:checked').value
}

function describe() {
  const toPage = mode() === 'page'
  show($('page-options'), toPage)
  let what
  if (!clip) what = 'Nothing to read on this page; the link will be saved.'
  else if (clip.fromSelection)
    what = toPage
      ? 'Saves your selection as the page.'
      : 'Saves the link with your selection quoted.'
  else
    what = toPage ? 'Saves the article text and images as a page.' : 'Saves the link to your Inbox.'
  say($('what'), what)
}

async function loadSpaces() {
  const select = $('space')
  select.innerHTML = ''
  const spaces = await api(settings, 'GET', '/api/v1/spaces')
  const { lastSpace } = await ext.storage.local.get('lastSpace')
  for (const s of spaces) {
    if (s.locked) continue
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = `${s.name}${s.personal ? ' (personal)' : ''}`
    if (s.id === lastSpace) opt.selected = true
    select.appendChild(opt)
  }
  if (select.options.length === 0) {
    const opt = document.createElement('option')
    opt.textContent = 'No notebooks or wikis yet'
    opt.disabled = true
    select.appendChild(opt)
  }
}

async function startClip() {
  show($('setup'), false)
  show($('clip'), true)
  $('who').textContent = `${settings.name} · ${new URL(settings.url).host}`
  const tab = await currentTab()
  clip = tab?.id !== undefined ? await extractFromTab(tab.id) : null
  const fallback = {
    title: tab?.title || '',
    url: tab?.url || '',
    markdown: '',
    fromSelection: false,
  }
  $('title').value = (clip || fallback).title
  $('source').textContent = (clip || fallback).url
  if (!clip) clip = null
  describe()
  const { lastMode } = await ext.storage.local.get('lastMode')
  if (lastMode === 'page') {
    document.querySelector('input[value=page]').checked = true
    describe()
  }
  loadSpaces().catch((err) => say($('clip-error'), err.message))
}

async function save() {
  say($('clip-error'), '')
  say($('result'), '')
  const tab = await currentTab()
  const data = clip || {
    title: tab?.title || '',
    url: tab?.url || '',
    markdown: '',
    fromSelection: false,
  }
  const title = $('title').value.trim() || data.title
  $('save').disabled = true
  try {
    let href
    if (mode() === 'page') {
      const spaceId = $('space').value
      if (!spaceId) throw new Error('Choose a space for the page.')
      href = await clipToPage(settings, data, spaceId, title)
      await ext.storage.local.set({ lastSpace: spaceId, lastMode: 'page' })
    } else {
      href = await clipToInbox(settings, { ...data, title })
      await ext.storage.local.set({ lastMode: 'inbox' })
    }
    $('result').textContent = 'Saved. '
    const a = document.createElement('a')
    a.href = href
    a.target = '_blank'
    a.rel = 'noreferrer'
    a.textContent = mode() === 'page' ? 'Open the page' : 'Open the Inbox'
    $('result').appendChild(a)
    show($('result'), true)
  } catch (err) {
    say($('clip-error'), err.message)
  } finally {
    $('save').disabled = false
  }
}

async function disconnect() {
  await clearSettings()
  settings = null
  show($('clip'), false)
  show($('setup'), true)
}

// ---- boot ----

document.addEventListener('DOMContentLoaded', async () => {
  $('connect').addEventListener('click', connect)
  $('save').addEventListener('click', save)
  $('disconnect').addEventListener('click', disconnect)
  for (const r of document.querySelectorAll('input[name=mode]'))
    r.addEventListener('change', describe)
  settings = await loadSettings()
  if (settings) await startClip()
  else show($('setup'), true)
})
