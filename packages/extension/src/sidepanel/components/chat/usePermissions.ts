import { useEffect, useState } from "react";
import { permissionController } from "@/lib/permissions";
import type { ApprovalDecision, PendingApproval, PermissionMode } from "@/lib/permissions";

export interface UsePermissions {
  mode: PermissionMode;
  pending?: PendingApproval;
  setMode: (mode: PermissionMode) => void;
  resolve: (id: string, decision: ApprovalDecision) => void;
}

/** React adapter over the permission controller singleton. */
export function usePermissions(): UsePermissions {
  const [, force] = useState(0);
  const [mode, setModeState] = useState<PermissionMode>("ask");

  useEffect(() => {
    const unsub = permissionController.subscribe(() => force((n) => n + 1));
    void permissionController.getMode().then(setModeState);
    return unsub;
  }, []);

  return {
    mode,
    pending: permissionController.pending(),
    setMode: (m) => {
      setModeState(m);
      void permissionController.setMode(m);
    },
    resolve: (id, decision) => permissionController.resolve(id, decision),
  };
}
