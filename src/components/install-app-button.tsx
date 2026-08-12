import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Download } from "lucide-react";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Capture the event as early as possible (it can fire before React mounts).
declare global {
  interface Window {
    __deferredInstallPrompt?: BIPEvent | null;
  }
}

if (typeof window !== "undefined" && !("__installPromptHooked" in window)) {
  (window as unknown as Record<string, unknown>)["__installPromptHooked"] = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.__deferredInstallPrompt = e as BIPEvent;
    window.dispatchEvent(new Event("installpromptready"));
  });
  window.addEventListener("appinstalled", () => {
    window.__deferredInstallPrompt = null;
    window.dispatchEvent(new Event("installpromptready"));
  });
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function InstallAppButton({ className }: { className?: string }) {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const sync = () => setReady(Boolean(window.__deferredInstallPrompt));
    sync();
    window.addEventListener("installpromptready", sync);
    return () => window.removeEventListener("installpromptready", sync);
  }, []);

  if (installed) return null;

  const onClick = async () => {
    const evt = window.__deferredInstallPrompt;
    if (!evt) {
      setHelpOpen(true);
      return;
    }
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    window.__deferredInstallPrompt = null;
    setReady(false);
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={onClick} className={className}>
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Instalar app</span>
      </Button>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Instalar Casa Compartida</DialogTitle>
            <DialogDescription>
              Tu navegador no mostró el instalador automático. Puedes instalarla manualmente:
            </DialogDescription>
          </DialogHeader>
          {isIOS ? (
            <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
              <li>Abre esta página en Safari.</li>
              <li>Toca el botón Compartir (cuadro con flecha).</li>
              <li>Elige “Añadir a pantalla de inicio”.</li>
            </ol>
          ) : (
            <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
              <li>Abre la app en Chrome (no dentro de otra app ni en vista previa).</li>
              <li>Toca el menú ⋮ arriba a la derecha.</li>
              <li>Elige “Instalar app” o “Añadir a pantalla de inicio”.</li>
            </ol>
          )}
          <p className="text-xs text-muted-foreground">
            Nota: {ready ? "" : "el instalador automático solo aparece en el sitio publicado, no en la vista previa dentro del editor."}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
