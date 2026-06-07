import { Button } from "@/components/ui/button";

export function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div>
        <h1 className="text-base font-semibold">Open Browser Control</h1>
        <p className="mt-1 text-sm text-muted-foreground">Connect a provider to start chatting.</p>
      </div>
      <Button onClick={onConnect}>Connect a provider</Button>
    </div>
  );
}
