import { isToolExecRequest, type ToolExecResult } from "./control/protocol.ts";
import { dispatch } from "./control/executors.ts";
import { resolveActiveTab } from "./control/tabs.ts";

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

// Tool execution requests from the sidepanel agent. Resolve the active tab,
// dispatch to the executor, and reply with a ToolExecResult.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isToolExecRequest(message)) return false;
  void (async () => {
    const reply = (result: ToolExecResult) => sendResponse(result);
    try {
      const tab = await resolveActiveTab();
      if (!tab?.id) {
        reply({ ok: false, error: "No active tab to act on." });
        return;
      }
      if (tab.url && /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
        reply({ ok: false, error: "Cannot control browser-internal pages." });
        return;
      }
      reply(await dispatch(message.tool, message.args, tab.id));
    } catch (e) {
      reply({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
