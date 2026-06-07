// The toolbar icon: group the current tab (like the Claude extension) and open
// the chat side panel. We control opening ourselves (so we can also group), so
// disable the built-in open-on-click behavior.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((err) => console.warn("[OBC] setPanelBehavior failed", err));

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined || tab.windowId === undefined) return;

  // Group the active tab. Some tabs (chrome://, the New Tab page) can't be
  // grouped — ignore failures so the panel still opens.
  try {
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, {
      title: "Open Browser Control",
      color: "blue",
    });
  } catch (err) {
    console.warn("[OBC] could not group tab", err);
  }

  // Must be called from a user-gesture handler (the icon click qualifies).
  await chrome.sidePanel.open({ windowId: tab.windowId });
});
