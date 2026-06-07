/**
 * Iframe content for the playground. Reads ?screen, ?state and ?theme from the
 * URL and renders one screen full-bleed. Running inside an iframe means the
 * iframe's width IS the viewport width, so Tailwind's responsive breakpoints
 * behave exactly like the real Chrome side panel.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "@/components/chat/ChatView";
import { ConversationsDrawer } from "@/components/chat/ConversationsDrawer";
import { ProvidersView } from "@/components/chat/ProvidersView";
import { TooltipProvider } from "@/components/ui/tooltip";
import { mockConversations, providerEntries, sampleConversation } from "./mock";
import { useDemoChat } from "./useDemoChat";
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const screen = params.get("screen") ?? "chat";
const state = params.get("state") ?? "empty";
const theme = params.get("theme") ?? "light";

document.documentElement.classList.toggle("dark", theme === "dark");

/** Navigate the iframe to another screen, preserving theme/state. */
function navTo(next: string) {
  const p = new URLSearchParams(window.location.search);
  p.set("screen", next);
  window.location.search = p.toString();
}

function ChatScreen() {
  const chat = useDemoChat(state === "chat" ? sampleConversation : []);
  return <ChatView {...chat} onManageProviders={() => navTo("manage")} />;
}

function Root() {
  if (screen === "onboarding") {
    return (
      <ProvidersView
        mode="onboarding"
        providers={providerEntries([])}
        onConnectApiKey={() => navTo("chat")}
        onStartOAuth={() => {}}
        onCompleteOAuth={() => navTo("chat")}
        onDisconnect={() => {}}
      />
    );
  }
  if (screen === "manage") {
    return (
      <ProvidersView
        mode="manage"
        providers={providerEntries(["openrouter", "anthropic"])}
        onBack={() => navTo("chat")}
        onConnectApiKey={() => navTo("chat")}
        onStartOAuth={() => {}}
        onCompleteOAuth={() => navTo("chat")}
        onDisconnect={() => {}}
      />
    );
  }
  if (screen === "conversations") {
    return (
      <div className="relative h-full">
        <ChatScreen />
        <ConversationsDrawer
          open
          conversations={mockConversations}
          activeId="c1"
          onSelect={() => navTo("chat")}
          onDelete={() => {}}
          onNewChat={() => navTo("chat")}
          onClose={() => navTo("chat")}
        />
      </div>
    );
  }
  return <ChatScreen />;
}

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <TooltipProvider>
        <Root />
      </TooltipProvider>
    </StrictMode>,
  );
}
