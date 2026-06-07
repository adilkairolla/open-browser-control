/** The tab the agent should act on: active tab of the last focused normal window. */
export async function resolveActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null) return tab;
  const [fallback] = await chrome.tabs.query({ active: true, currentWindow: true });
  return fallback?.id != null ? fallback : undefined;
}
