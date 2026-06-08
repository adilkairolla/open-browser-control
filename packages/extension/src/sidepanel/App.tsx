import { useEffect, useRef, useState } from "react";
import { ChatView } from "@/components/chat/ChatView";
import { ConversationsDrawer } from "@/components/chat/ConversationsDrawer";
import { ProvidersView, type ProviderEntry } from "@/components/chat/ProvidersView";
import { useSessions } from "@/components/chat/useSessions";
import { usePermissions } from "@/components/chat/usePermissions";
import { ToolApprovalCard } from "@/components/chat/ToolApprovalCard";
import { PermissionModeToggle } from "@/components/chat/PermissionModeToggle";
import { authStore } from "@/lib/authStore";
import { settingsStore } from "@/lib/settingsStore";
import { CURATED_PROVIDERS, getProviderMeta, listModels } from "@/lib/providers";
import {
  buildAuthorizeUrl,
  exchangeCode,
  generatePkce,
  parseRedirect,
  refreshToken,
  type Pkce,
} from "@/lib/oauthAnthropic";
import type { KnownProvider } from "@earendil-works/pi-ai";

// Wire OAuth refresh into the shared auth store once.
authStore.setRefresher(refreshToken);

export function App() {
  const [connected, setConnected] = useState<string[] | undefined>();
  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [providersOpen, setProvidersOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Connect flow state (shared by the Providers view).
  const [pkce, setPkce] = useState<Pkce | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessions = useSessions();
  const perms = usePermissions();
  const started = useRef(false);

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
    } else {
      setProvider("");
      setModel("");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  // Once a provider/model is available, start the first (draft) conversation.
  useEffect(() => {
    if (!started.current && provider && model) {
      started.current = true;
      sessions.newChat(provider, model);
    }
  }, [provider, model, sessions]);

  const providerEntries: ProviderEntry[] = CURATED_PROVIDERS.map((p) => ({
    slug: p.slug,
    name: p.name,
    connected: (connected ?? []).includes(p.slug),
    authMethods: p.authMethods,
    apiKeyUrl: p.apiKeyUrl,
  }));

  async function afterConnect(slug: string) {
    const m = listModels(slug as KnownProvider)[0]?.id ?? "";
    await settingsStore.setSelection(slug, m);
    setBusy(false);
    setError(null);
    setPkce(undefined);
    setProvidersOpen(false);
    await reload();
  }

  async function onConnectApiKey(slug: string, key: string) {
    if (!key) {
      setError("Enter an API key.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authStore.setApiKey(slug, key);
      await afterConnect(slug);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onStartOAuth(_slug: string) {
    setError(null);
    const generated = await generatePkce();
    setPkce(generated);
    await chrome.tabs.create({ url: buildAuthorizeUrl(generated) });
  }

  async function onCompleteOAuth(slug: string, pastedText: string) {
    if (!pkce) {
      setError("Start the sign-in first.");
      return;
    }
    const { code, state } = parseRedirect(pastedText);
    if (!code) {
      setError("Could not find an authorization code in what you pasted.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cred = await exchangeCode({ code, state: state ?? pkce.verifier, verifier: pkce.verifier });
      await authStore.setOAuth(slug, cred);
      await afterConnect(slug);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDisconnect(slug: string) {
    await authStore.remove(slug);
    await reload();
  }

  if (connected === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
    );
  }

  // No providers → onboarding; "Manage providers…" → manage. Same component.
  if (connected.length === 0 || providersOpen) {
    return (
      <ProvidersView
        providers={providerEntries}
        mode={connected.length === 0 ? "onboarding" : "manage"}
        busy={busy}
        error={error}
        onBack={
          connected.length === 0
            ? undefined
            : () => {
                setProvidersOpen(false);
                setError(null);
              }
        }
        onConnectApiKey={onConnectApiKey}
        onStartOAuth={onStartOAuth}
        onCompleteOAuth={onCompleteOAuth}
        onDisconnect={onDisconnect}
      />
    );
  }

  return (
    <div className="relative h-full">
      <ChatView
        providers={connected.map((slug) => ({ slug, name: getProviderMeta(slug)?.name ?? slug }))}
        models={listModels(provider as KnownProvider).map((m) => ({ id: m.id, name: m.name }))}
        provider={provider}
        model={model}
        messages={sessions.messages}
        streaming={sessions.streaming}
        error={sessions.error ?? undefined}
        headerActions={<PermissionModeToggle mode={perms.mode} onChange={perms.setMode} />}
        composerTop={
          <>
            {perms.pending && <ToolApprovalCard pending={perms.pending} onDecide={perms.resolve} />}
          </>
        }
        onSelectProvider={async (p) => {
          const first = listModels(p as KnownProvider)[0]?.id ?? "";
          setProvider(p);
          setModel(first);
          await settingsStore.setSelection(p, first);
          sessions.setModel(p, first);
        }}
        onSelectModel={async (m) => {
          setModel(m);
          await settingsStore.setSelection(provider, m);
          sessions.setModel(provider, m);
        }}
        onSend={(text) => sessions.send(text)}
        onStop={() => sessions.stop()}
        onNewChat={() => sessions.newChat(provider, model)}
        onOpenConversations={() => setDrawerOpen(true)}
        onManageProviders={() => {
          setError(null);
          setProvidersOpen(true);
        }}
      />
      <ConversationsDrawer
        open={drawerOpen}
        conversations={sessions.conversations}
        activeId={sessions.activeId}
        onSelect={(id) => {
          void sessions.open(id).then((conv) => {
            if (conv) {
              setProvider(conv.provider);
              setModel(conv.model);
            }
            setDrawerOpen(false);
          });
        }}
        onDelete={(id) => sessions.remove(id)}
        onNewChat={() => {
          sessions.newChat(provider, model);
          setDrawerOpen(false);
        }}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
