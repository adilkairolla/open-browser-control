// The toolbar icon opens the chat side panel using Chrome's native action-click
// behavior. Once the panel opens, group the active tab like the Claude extension.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.warn("[OBC] setPanelBehavior failed", err));

async function groupTab(tabId: number | undefined, windowId: number) {
  let targetTabId = tabId;

  if (targetTabId === undefined) {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    targetTabId = activeTab?.id;
  }

  if (targetTabId === undefined) return;

  // Some tabs (chrome://, the New Tab page) can't be grouped — ignore failures
  // because opening the panel is the primary action.
  try {
    const groupId = await chrome.tabs.group({ tabIds: [targetTabId] });
    await chrome.tabGroups.update(groupId, {
      title: "Open Browser Control",
      color: "blue",
    });
  } catch (err) {
    console.warn("[OBC] could not group tab", err);
  }
}

chrome.sidePanel.onOpened.addListener((info) => {
  void groupTab(info.tabId, info.windowId);
});
