/*
 * Right-click menu: one-click saves to the Inbox without opening the popup.
 * Chrome runs this as a service worker (lib.js via importScripts); Firefox
 * loads lib.js first as a background script (see manifest "scripts").
 */
if (typeof importScripts === 'function' && typeof extractForClip === 'undefined') {
  importScripts('lib.js')
}

const MENU = {
  page: 'bn-save-page',
  selection: 'bn-save-selection',
  link: 'bn-save-link',
}

ext.runtime.onInstalled.addListener(() => {
  ext.contextMenus.removeAll(() => {
    ext.contextMenus.create({
      id: MENU.page,
      title: 'Save page to Beyond Notes Inbox',
      contexts: ['page'],
    })
    ext.contextMenus.create({
      id: MENU.selection,
      title: 'Save selection to Beyond Notes Inbox',
      contexts: ['selection'],
    })
    ext.contextMenus.create({
      id: MENU.link,
      title: 'Save link to Beyond Notes Inbox',
      contexts: ['link'],
    })
  })
})

async function flash(tabId, text, color) {
  try {
    await ext.action.setBadgeBackgroundColor({ color, tabId })
    await ext.action.setBadgeText({ text, tabId })
    setTimeout(() => ext.action.setBadgeText({ text: '', tabId }), 2500)
  } catch {
    // the tab may be gone
  }
}

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id
  const settings = await loadSettings()
  if (!settings) {
    // not connected yet: the popup is where that happens
    if (tabId !== undefined) await flash(tabId, '?', '#b8392f')
    return
  }
  try {
    let clip
    if (info.menuItemId === MENU.link && info.linkUrl) {
      clip = {
        title: (info.selectionText || info.linkUrl).trim(),
        url: info.linkUrl,
        markdown: '',
        fromSelection: false,
      }
    } else if (tabId !== undefined) {
      clip = (await extractFromTab(tabId)) || {
        title: tab.title || info.pageUrl,
        url: info.pageUrl,
        markdown: info.selectionText || '',
        fromSelection: Boolean(info.selectionText),
      }
      if (info.menuItemId === MENU.page) clip = { ...clip, fromSelection: false }
    }
    if (!clip) return
    await clipToInbox(settings, clip)
    if (tabId !== undefined) await flash(tabId, '✓', '#1d7f53')
  } catch {
    if (tabId !== undefined) await flash(tabId, '!', '#b8392f')
  }
})
