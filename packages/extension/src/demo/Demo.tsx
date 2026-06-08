/**
 * Playground control panel. Picks a layout / state / theme / width and renders
 * the chat inside a width-constrained iframe so you can eyeball narrow side-panel
 * widths without loading the extension.
 */
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

type Screen = "chat" | "onboarding" | "manage" | "conversations" | "indicator";
type State = "empty" | "chat" | "long" | "tools";
type Theme = "light" | "dark";

const WIDTH_PRESETS = [300, 360, 400, 480, 560];

export function Demo() {
  const [screen, setScreen] = useState<Screen>("chat");
  const [state, setState] = useState<State>("chat");
  const [theme, setTheme] = useState<Theme>("light");
  const [width, setWidth] = useState(360);

  const src = `preview.html?screen=${screen}&state=${state}&theme=${theme}`;

  return (
    <div className="flex h-full min-h-0 bg-neutral-100 font-sans text-neutral-900">
      <aside className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-neutral-200 bg-white p-4">
        <div>
          <h1 className="text-sm font-semibold">Chat UI Playground</h1>
          <p className="mt-0.5 text-xs text-neutral-500">Side-panel layouts · live preview</p>
        </div>

        <Group label="Screen">
          <Segment
            value={screen}
            onChange={setScreen}
            options={[
              ["chat", "Chat"],
              ["onboarding", "Onboarding"],
              ["manage", "Manage"],
              ["conversations", "Conversations"],
              ["indicator", "Indicator"],
            ]}
          />
        </Group>

        {screen === "chat" && (
          <Group label="State">
            <Segment
              value={state}
              onChange={setState}
              options={[
                ["empty", "Empty"],
                ["chat", "Conversation"],
                ["long", "Long (virtualized)"],
                ["tools", "Tool calls"],
              ]}
            />
          </Group>
        )}

        <Group label="Theme">
          <Segment
            value={theme}
            onChange={setTheme}
            options={[
              ["light", "Light"],
              ["dark", "Dark"],
            ]}
          />
        </Group>

        <Group label={`Width · ${width}px`}>
          <div className="flex flex-wrap gap-1.5">
            {WIDTH_PRESETS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWidth(w)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  width === w
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 hover:bg-neutral-100",
                )}
              >
                {w}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={280}
            max={560}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="mt-2 w-full accent-neutral-900"
          />
        </Group>

        <div className="mt-auto rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-500">
          <p className="font-medium text-neutral-700">Source</p>
          <p className="mt-1">
            Chat surface → <span className="font-medium">components/chat/ChatView.tsx</span>
          </p>
          <p className="mt-2">Preview runs in an iframe at the chosen width, so breakpoints match the real panel.</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden p-6">
        <div className="mx-auto flex h-full flex-col items-center gap-2">
          <span className="text-xs text-neutral-400">{width}px × full height</span>
          <div
            className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-300 bg-white shadow-2xl"
            style={{ width, maxWidth: "100%" }}
          >
            <iframe key={src} title="Chat preview" src={src} className="block h-full w-full border-0" />
          </div>
        </div>
      </main>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-neutral-500">{label}</div>
      {children}
    </div>
  );
}

function Segment<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex rounded-lg border border-neutral-200 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
            value === v ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
