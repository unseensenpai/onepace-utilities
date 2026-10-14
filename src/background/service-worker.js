function sendToPlayerFrames(tabId, message) {
  chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
    for (const frame of frames ?? []) {
      if (frame.frameId === 0) continue;
      chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId }).catch(() => undefined);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANIMPOW_SYNC_SOCKET_RULES') {
    syncAnimPowSocketRules(message.settings).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (!sender.tab?.id) return;

  if (message.type === 'ONEPACE_APPLY_PLAYER_PREFERENCES') {
    sendToPlayerFrames(sender.tab.id, { type: 'ONEPACE_PLAYER_PREFERENCES', payload: message.payload });
  }

  if (message.type === 'ONEPACE_PLAYER_COMMAND') sendToPlayerFrames(sender.tab.id, message);

  if (message.type === 'ONEPACE_PLAYER_EVENT' || message.type === 'ONEPACE_PLAYER_READY') {
    chrome.tabs.sendMessage(sender.tab.id, message, { frameId: 0 }).catch(() => undefined);
  }

  sendResponse({ ok: true });
});

// AnimPow opens a WebSocket (after fetching /ws/token) on every page and retries when it fails. With
// the "blockSocket" setting on, a page-world guard script stops both before they leave the page, and
// dynamic rules block anything that still reaches the network (e.g. requests from its service worker).
const ANIMPOW_SOCKET_GUARD_ID = 'animpow-socket-guard';
const ANIMPOW_SOCKET_RULE_IDS = [1, 2];
const ANIMPOW_SOCKET_RULES = [
  {
    id: 1,
    priority: 1,
    action: { type: 'block' },
    condition: { initiatorDomains: ['animpow.com'], resourceTypes: ['websocket'] }
  },
  {
    id: 2,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: '||animpow.com/ws/token', resourceTypes: ['xmlhttprequest', 'other'] }
  }
];

async function syncAnimPowSocketGuard(enabled) {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [ANIMPOW_SOCKET_GUARD_ID] });
  if (enabled && registered.length === 0) {
    await chrome.scripting.registerContentScripts([{
      id: ANIMPOW_SOCKET_GUARD_ID,
      matches: ['https://animpow.com/*'],
      js: ['src/content/animpow-socket-guard.js'],
      runAt: 'document_start',
      world: 'MAIN'
    }]);
  } else if (!enabled && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [ANIMPOW_SOCKET_GUARD_ID] });
  }
}

function syncAnimPowSocketRules(settings) {
  const enabled = Boolean(settings?.blockSocket);
  return Promise.all([
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ANIMPOW_SOCKET_RULE_IDS,
      addRules: enabled ? ANIMPOW_SOCKET_RULES : []
    }),
    syncAnimPowSocketGuard(enabled)
  ]);
}

chrome.storage.sync.get('animpowSettings', ({ animpowSettings }) => syncAnimPowSocketRules(animpowSettings));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.animpowSettings) syncAnimPowSocketRules(changes.animpowSettings.newValue);
});
