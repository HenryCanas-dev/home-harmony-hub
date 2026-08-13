import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Download, ExternalLink } from "lucide-react";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __deferredInstallPrompt?: BIPEvent | null;
    __installPromptHooked?: boolean;
  }
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function InstallAppButton({ className }: { className?: string }) {
  const [installed, setInstalled] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isChrome, setIsChrome] = useState(false);
  const [checking, setChecking] = useState(false);
  const [isSecure, setIsSecure] = useState(true);
  const [chromeUrl, setChromeUrl] = useState("/");

  useEffect(() => {
    setInstalled(isStandalone());
    const ua = navigator.userAgent;
    setIsIOS(/iphone|ipad|ipod/i.test(ua));
    setIsAndroid(/android/i.test(ua));
    setIsChrome(/chrome|crios/i.test(ua) && !/edg|opr|samsungbrowser/i.test(ua));
    setIsSecure(window.isSecureContext);
    const current = new URL(window.location.href);
    setChromeUrl(`intent://${current.host}${current.pathname}${current.search}#Intent;scheme=${current.protocol.replace(":", "")};package=com.android.chrome;end`);
  }, []);

  if (installed) return null;

  const onClick = async () => {
    let evt = window.__deferredInstallPrompt;
    if (!evt) {
      setChecking(true);
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 2500);
        const onReady = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        window.addEventListener("installpromptready", onReady, { once: true });
      });
      setChecking(false);
      evt = window.__deferredInstallPrompt;
    }
    if (!evt) {
      setHelpOpen(true);
      return;
    }
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    window.__deferredInstallPrompt = null;
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={onClick} className={className} disabled={checking}>
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">{checking ? "Comprobando…" : "Instalar app"}</span>
      </Button>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Instalar Casa Compartida</DialogTitle>
            <DialogDescription>Chrome no habilitó todavía el instalador para esta visita.</DialogDescription>
          </DialogHeader>
          {isIOS ? (
            <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
              <li>Abre esta página en Safari.</li>
              <li>Toca el botón Compartir (cuadro con flecha).</li>
              <li>Elige “Añadir a pantalla de inicio”.</li>
            </ol>
          ) : isAndroid && isChrome ? (
            <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
              <li>Confirma que estás en el sitio publicado <strong>roommate-rewards.lovable.app</strong>.</li>
              <li>Recarga la página y úsala unos segundos; Chrome habilita la instalación después de verificarla.</li>
              <li>Vuelve a tocar “Instalar app”. Si ya la agregaste antes, búscala como “Casa” en tus aplicaciones.</li>
            </ol>
          ) : isAndroid ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Para instalarla en Android, abre este sitio directamente en Google Chrome.</p>
              <Button variant="outline" size="sm" asChild>
                <a href={chromeUrl}>
                  <ExternalLink className="w-4 h-4" /> Abrir en Chrome
                </a>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Abre el sitio publicado en Chrome o Safari para añadirlo a tu pantalla de inicio.</p>
          )}
          {!isSecure && <p className="text-xs text-destructive">La instalación requiere una conexión HTTPS segura.</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
