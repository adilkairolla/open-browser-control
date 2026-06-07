/**
 * Full-panel Providers view — used both as the initial onboarding screen (when
 * no providers are connected) and as the add/manage surface reached from the
 * provider dropdown's "Manage providers…" footer.
 *
 * Pure view over props: a list of providers (with brand icons + connected
 * status) that drills into a per-provider connect step (API key, plus
 * "Sign in with Claude" for Anthropic). The OAuth mechanics live in the caller.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "./icons";
import { IconButton } from "./primitives";
import { ProviderIcon } from "./ProviderIcon";

export interface ProviderEntry {
  slug: string;
  name: string;
  connected: boolean;
  authMethods: ("api_key" | "oauth")[];
  apiKeyUrl?: string;
}

export interface ProvidersViewProps {
  providers: ProviderEntry[];
  mode: "onboarding" | "manage";
  busy?: boolean;
  error?: string | null;
  /** Back to chat (manage mode only; omitted for onboarding). */
  onBack?: () => void;
  onConnectApiKey: (slug: string, key: string) => void;
  onStartOAuth?: (slug: string) => void;
  onCompleteOAuth?: (slug: string, pasted: string) => void;
  onDisconnect: (slug: string) => void;
}

export function ProvidersView({
  providers,
  mode,
  busy = false,
  error,
  onBack,
  onConnectApiKey,
  onStartOAuth,
  onCompleteOAuth,
  onDisconnect,
}: ProvidersViewProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const selected = providers.find((p) => p.slug === selectedSlug) ?? null;

  if (selected) {
    return (
      <ProviderDetail
        provider={selected}
        busy={busy}
        error={error}
        onBack={() => setSelectedSlug(null)}
        onConnectApiKey={onConnectApiKey}
        onStartOAuth={onStartOAuth}
        onCompleteOAuth={onCompleteOAuth}
        onDisconnect={onDisconnect}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 px-2 py-2">
        {mode === "manage" && onBack && (
          <IconButton icon="back" label="Back" className="rounded-full" onClick={onBack} />
        )}
        <h1 className="px-1 text-sm font-semibold">
          {mode === "onboarding" ? "Connect a provider" : "Providers"}
        </h1>
      </header>

      <div className="min-h-0 flex-1">
        <ScrollArea>
          <div className="flex flex-col gap-3 px-3 pb-4">
            {mode === "onboarding" && (
              <div className="flex flex-col items-center gap-3 px-2 py-5 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                  <Icon name="brand" size={26} />
                </div>
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Open Browser Control</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Connect a provider to start chatting. Your key stays in this browser.
                  </p>
                </div>
              </div>
            )}

            <ul className="flex flex-col gap-1.5">
              {providers.map((p) => (
                <li key={p.slug}>
                  <button
                    type="button"
                    onClick={() => setSelectedSlug(p.slug)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-2xl border bg-card px-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ProviderIcon slug={p.slug} className="size-5" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    {p.connected ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        Connected
                        <Icon name="check" size={15} className="text-success" />
                      </span>
                    ) : (
                      <Icon name="chevronRight" size={16} className="text-muted-foreground" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function ProviderDetail({
  provider,
  busy,
  error,
  onBack,
  onConnectApiKey,
  onStartOAuth,
  onCompleteOAuth,
  onDisconnect,
}: {
  provider: ProviderEntry;
  busy: boolean;
  error?: string | null;
  onBack: () => void;
  onConnectApiKey: (slug: string, key: string) => void;
  onStartOAuth?: (slug: string) => void;
  onCompleteOAuth?: (slug: string, pasted: string) => void;
  onDisconnect: (slug: string) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [pasted, setPasted] = useState("");
  const [oauthStarted, setOauthStarted] = useState(false);
  const supportsApiKey = provider.authMethods.includes("api_key");
  const supportsOAuth = provider.authMethods.includes("oauth") && !!onStartOAuth;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 px-2 py-2">
        <IconButton icon="back" label="Back" className="rounded-full" onClick={onBack} />
        <h1 className="px-1 text-sm font-semibold">{provider.name}</h1>
      </header>

      <div className="min-h-0 flex-1">
        <ScrollArea>
          <div className="flex flex-col gap-4 px-4 pb-6">
            <div className="flex items-center gap-3 pt-1">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-secondary">
                <ProviderIcon slug={provider.slug} className="size-6" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">{provider.name}</h2>
                {provider.connected && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Icon name="check" size={13} className="text-success" /> Connected
                  </p>
                )}
              </div>
            </div>

            {provider.connected ? (
              <Button variant="destructive-outline" onClick={() => onDisconnect(provider.slug)}>
                <Icon name="disconnect" size={16} /> Disconnect
              </Button>
            ) : (
              <div className="flex flex-col gap-4">
                {supportsApiKey && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground">API key</label>
                    <Textarea
                      placeholder="Paste your API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      rows={2}
                    />
                    {provider.apiKeyUrl && (
                      <a
                        className="inline-flex w-fit items-center gap-1 text-xs font-medium text-brand underline-offset-2 hover:underline"
                        href={provider.apiKeyUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Get an API key ↗
                      </a>
                    )}
                    <Button
                      onClick={() => onConnectApiKey(provider.slug, apiKey.trim())}
                      loading={busy}
                      disabled={!apiKey.trim()}
                    >
                      Connect
                    </Button>
                  </div>
                )}

                {supportsOAuth && (
                  <div className="flex flex-col gap-2">
                    {supportsApiKey && (
                      <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
                        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
                      </div>
                    )}
                    <p className="text-sm">
                      Sign in with your <strong>Claude Pro/Max</strong> subscription.
                    </p>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        onStartOAuth?.(provider.slug);
                        setOauthStarted(true);
                      }}
                    >
                      Sign in with Claude
                    </Button>
                    {oauthStarted && (
                      <>
                        <p className="text-xs text-muted-foreground">
                          A tab opened. After approving, copy the redirect URL (or the code shown) and paste it
                          here.
                        </p>
                        <Textarea
                          placeholder="Paste the redirect URL or code"
                          value={pasted}
                          onChange={(e) => setPasted(e.target.value)}
                          rows={2}
                        />
                        <Button
                          onClick={() => onCompleteOAuth?.(provider.slug, pasted)}
                          loading={busy}
                          disabled={!pasted.trim()}
                        >
                          Finish sign-in
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
