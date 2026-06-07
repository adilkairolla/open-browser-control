import { useState } from "react";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "@/components/ui/select";
import { CURATED_PROVIDERS, getProviderMeta, listModels } from "@/lib/providers";
import { authStore } from "@/lib/authStore";
import { settingsStore } from "@/lib/settingsStore";
import { buildAuthorizeUrl, exchangeCode, generatePkce, parseRedirect, type Pkce } from "@/lib/oauthAnthropic";
import type { KnownProvider } from "@earendil-works/pi-ai";

type Tab = "api_key" | "oauth";

const API_KEY_PROVIDERS = CURATED_PROVIDERS;
const OAUTH_PROVIDERS = CURATED_PROVIDERS.filter((p) => p.authMethods.includes("oauth"));

function defaultModelFor(provider: KnownProvider): string {
  return listModels(provider)[0]?.id ?? "";
}

export function ConnectProviderDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}) {
  const [tab, setTab] = useState<Tab>("api_key");
  const [provider, setProvider] = useState<string>(API_KEY_PROVIDERS[0]!.slug);
  const [apiKey, setApiKey] = useState("");
  const [oauthProvider] = useState<string>(OAUTH_PROVIDERS[0]?.slug ?? "anthropic");
  const [pkce, setPkce] = useState<Pkce | undefined>();
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function finish(slug: KnownProvider) {
    await settingsStore.setSelection(slug, defaultModelFor(slug));
    setBusy(false);
    setError(undefined);
    setApiKey("");
    setPasted("");
    setPkce(undefined);
    onOpenChange(false);
    onConnected();
  }

  async function connectApiKey() {
    setError(undefined);
    const key = apiKey.trim();
    if (!key) {
      setError("Enter an API key.");
      return;
    }
    setBusy(true);
    try {
      await authStore.setApiKey(provider, key);
      await finish(provider as KnownProvider);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function startOAuth() {
    setError(undefined);
    const generated = await generatePkce();
    setPkce(generated);
    await chrome.tabs.create({ url: buildAuthorizeUrl(generated) });
  }

  async function completeOAuth() {
    setError(undefined);
    if (!pkce) {
      setError("Start the sign-in first.");
      return;
    }
    const { code, state } = parseRedirect(pasted);
    if (!code) {
      setError("Could not find an authorization code in what you pasted.");
      return;
    }
    setBusy(true);
    try {
      const cred = await exchangeCode({ code, state: state ?? pkce.verifier, verifier: pkce.verifier });
      await authStore.setOAuth(oauthProvider, cred);
      await finish(oauthProvider as KnownProvider);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const meta = getProviderMeta(provider);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Connect a provider</DialogTitle>
          <DialogDescription>Use an API key, or sign in with a subscription.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-6 pb-6">
          <div className="flex gap-2">
            <Button variant={tab === "api_key" ? "default" : "secondary"} onClick={() => setTab("api_key")}>
              API key
            </Button>
            <Button variant={tab === "oauth" ? "default" : "secondary"} onClick={() => setTab("oauth")}>
              Subscription
            </Button>
          </div>

          {tab === "api_key" ? (
            <>
              <Select value={provider} onValueChange={(v) => setProvider(v as string)}>
                <SelectTrigger>
                  <SelectValue>{(v: unknown) => getProviderMeta(v as string)?.name ?? String(v)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {API_KEY_PROVIDERS.map((p) => (
                    <SelectItem key={p.slug} value={p.slug}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Textarea
                placeholder="Paste your API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                rows={2}
              />
              {meta?.apiKeyUrl && (
                <a
                  className="text-xs text-muted-foreground underline"
                  href={meta.apiKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Get a {meta.name} API key
                </a>
              )}
              <Button onClick={connectApiKey} loading={busy}>
                Connect
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm">
                Sign in to <strong>Anthropic (Claude Pro/Max)</strong>. A tab opens; after approving you'll be
                redirected to a page that won't load — copy that page's full URL (or the code Claude shows) and
                paste it below.
              </p>
              <Button onClick={startOAuth} disabled={busy}>
                Open Claude sign-in
              </Button>
              <Textarea
                placeholder="Paste the redirect URL or code"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={2}
                disabled={!pkce}
              />
              <Button onClick={completeOAuth} loading={busy} disabled={!pkce}>
                Finish sign-in
              </Button>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
