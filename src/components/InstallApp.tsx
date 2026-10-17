import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallApp() {
  const promptRef = useRef<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(true);
  const [help, setHelp] = useState(false);
  const [ios, setIos] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const sync = () => setInstalled(media.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    sync();
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    setPreview(window.self !== window.top || import.meta.env.DEV || /^(id-preview--|preview--)/.test(window.location.hostname));
    const capture = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as InstallPrompt;
    };
    const complete = () => { promptRef.current = null; setInstalled(true); setHelp(false); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    media.addEventListener("change", sync);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", complete);
      media.removeEventListener("change", sync);
    };
  }, []);

  const install = async () => {
    const event = promptRef.current;
    if (!event || preview) { setHelp(true); return; }
    setBusy(true);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") setHelp(false);
    } catch {
      setHelp(true);
    } finally {
      promptRef.current = null;
      setBusy(false);
    }
  };

  if (installed) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void install()} disabled={busy} className="shrink-0" aria-label="অ্যাপ ইনস্টল">
        <Download aria-hidden="true" /> ইনস্টল
      </Button>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-lg">
          <DialogHeader>
            <DialogTitle>Echo ইনস্টল</DialogTitle>
            <DialogDescription>
              {preview ? "প্রিভিউর ভেতরে ইনস্টল করা যায় না। প্রকাশিত অ্যাপটি Chrome অথবা Safari-তে খুলুন।" : "ইনস্টল পপআপ না এলে ব্রাউজারের মেনু থেকে হোম স্ক্রিনে যোগ করুন।"}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-relaxed">
            {ios ? "Safari-তে Share চাপুন → Add to Home Screen → Add।" : "Android Chrome-এ ⋮ মেনু → Add to Home screen / Install app → Install অথবা Add।"}
          </p>
          <p className="text-sm text-muted-foreground">Facebook বা Messenger-এর ভেতরে খুললে আগে ফোনের Chrome বা Safari-তে খুলুন।</p>
          {preview && (
            <Button asChild>
              <a href={typeof window !== "undefined" ? window.location.origin : "/"} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" /> অ্যাপ খুলুন</a>
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}