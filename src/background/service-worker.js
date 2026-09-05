chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab?.id) return;

  if (message.type === 'ONEPACE_APPLY_PLAYER_PREFERENCES') {
    chrome.webNavigation.getAllFrames({ tabId: sender.tab.id }, (frames) => {
      for (const frame of frames ?? []) {
        if (frame.frameId === 0) continue;
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'ONEPACE_PLAYER_PREFERENCES',
          payload: message.payload
        }, { frameId: frame.frameId }).catch(() => undefined);
      }
    });
  }

  if (message.type === 'ONEPACE_PLAYER_EVENT') {
    chrome.tabs.sendMessage(sender.tab.id, message, { frameId: 0 }).catch(() => undefined);
  }

  sendResponse({ ok: true });
});
