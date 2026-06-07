import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "@/components/ui/select";
import { getProviderMeta, listModels } from "@/lib/providers";
import type { KnownProvider } from "@earendil-works/pi-ai";

export function ProviderModelSelector({
  connectedProviders,
  provider,
  model,
  onChange,
}: {
  connectedProviders: string[];
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
}) {
  const models = listModels(provider as KnownProvider);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={provider}
        onValueChange={(v) => {
          const p = v as string;
          const first = listModels(p as KnownProvider)[0]?.id ?? "";
          onChange(p, first);
        }}
      >
        <SelectTrigger size="sm" className="w-[116px]">
          <SelectValue>{(v: unknown) => getProviderMeta(v as string)?.name ?? String(v)}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {connectedProviders.map((slug) => (
            <SelectItem key={slug} value={slug}>
              {getProviderMeta(slug)?.name ?? slug}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>

      <Select value={model} onValueChange={(v) => onChange(provider, v as string)}>
        <SelectTrigger size="sm" className="w-[176px]">
          <SelectValue>
            {(v: unknown) => models.find((m) => m.id === (v as string))?.name ?? String(v)}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
