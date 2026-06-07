import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { ConnectProviderDialog } from "@/components/ConnectProviderDialog";
import { ProviderModelSelector } from "@/components/ProviderModelSelector";
import { Chat } from "@/components/Chat";
import { Button } from "@/components/ui/button";
import { authStore } from "@/lib/authStore";
import { settingsStore } from "@/lib/settingsStore";
import { listModels } from "@/lib/providers";
import { refreshToken } from "@/lib/oauthAnthropic";
import { ChatSession } from "@/lib/chat";
import type { KnownProvider } from "@earendil-works/pi-ai";

// Wire OAuth refresh into the shared auth store once.
authStore.setRefresher(refreshToken);

export function App() {
  const [connected, setConnected] = useState<string[] | undefined>();
  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);

  async function reload() {
    const providers = await authStore.listProviders();
    setConnected(providers);
    const sel = await settingsStore.getSelection();
    if (sel.provider && providers.includes(sel.provider)) {
      setProvider(sel.provider);
      setModel(sel.model ?? listModels(sel.provider as KnownProvider)[0]?.id ?? "");
    } else if (providers[0]) {
      setProvider(providers[0]);
      setModel(listModels(providers[0] as KnownProvider)[0]?.id ?? "");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  // Re-create the chat session whenever provider/model changes.
  const session = useMemo(() => {
    if (!provider || !model) return undefined;
    const m = listModels(provider as KnownProvider).find((x) => x.id === model);
    if (!m) return undefined;
    return new ChatSession({ model: m, getToken: (p) => authStore.getToken(p) });
  }, [provider, model]);

  if (connected === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
    );
  }

  if (connected.length === 0) {
    return (
      <>
        <EmptyState onConnect={() => setDialogOpen(true)} />
        <ConnectProviderDialog open={dialogOpen} onOpenChange={setDialogOpen} onConnected={reload} />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b p-2">
        <ProviderModelSelector
          connectedProviders={connected}
          provider={provider}
          model={model}
          onChange={async (p, m) => {
            setProvider(p);
            setModel(m);
            await settingsStore.setSelection(p, m);
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
          + Provider
        </Button>
      </header>

      {session ? (
        <div className="min-h-0 flex-1">
          <Chat key={`${provider}:${model}`} session={session} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a provider and model.
        </div>
      )}

      <ConnectProviderDialog open={dialogOpen} onOpenChange={setDialogOpen} onConnected={reload} />
    </div>
  );
}
