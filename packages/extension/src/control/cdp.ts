/**
 * chrome.debugger (CDP) wrapper. Attaches lazily per tab and auto-detaches after
 * an idle window so the "is being debugged" banner does not linger. Mirrors the
 * reference extension's ~20s idle detach.
 */
const PROTOCOL_VERSION = "1.3";
const IDLE_DETACH_MS = 20_000;

const attached = new Set<number>();
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>();

async function ensureAttached(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  attached.add(tabId);
}

function scheduleDetach(tabId: number): void {
  const existing = idleTimers.get(tabId);
  if (existing) clearTimeout(existing);
  idleTimers.set(
    tabId,
    setTimeout(() => void detach(tabId), IDLE_DETACH_MS),
  );
}

export async function detach(tabId: number): Promise<void> {
  const timer = idleTimers.get(tabId);
  if (timer) clearTimeout(timer);
  idleTimers.delete(tabId);
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // tab may have closed; ignore.
  }
}

/** Send a CDP command, attaching first and resetting the idle-detach timer. */
export async function cdpSend<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  await ensureAttached(tabId);
  try {
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  } finally {
    scheduleDetach(tabId);
  }
}

// Clean up if the user (or DevTools) detaches out from under us.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) {
    attached.delete(source.tabId);
    const timer = idleTimers.get(source.tabId);
    if (timer) clearTimeout(timer);
    idleTimers.delete(source.tabId);
  }
});
