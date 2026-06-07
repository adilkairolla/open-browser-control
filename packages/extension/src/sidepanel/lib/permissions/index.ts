import { MUTATING_TOOLS } from "@/lib/tools/browserTools";
import { PermissionController } from "./PermissionController";
import { PermissionStore } from "./store";

export { PermissionController } from "./PermissionController";
export { PermissionStore } from "./store";
export type { ApprovalDecision, PendingApproval } from "./PermissionController";
export type { PermissionMode } from "./store";

/** Active tab hostname, used to scope "always allow on this site". */
async function activeOrigin(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) return undefined;
    return new URL(tab.url).hostname;
  } catch {
    return undefined;
  }
}

export const permissionStore = new PermissionStore();
export const permissionController = new PermissionController({
  store: permissionStore,
  mutatingTools: MUTATING_TOOLS,
  getActiveOrigin: activeOrigin,
});
