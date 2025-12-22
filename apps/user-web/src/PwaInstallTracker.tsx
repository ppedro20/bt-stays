import { useEffect } from "react";
import { trackPwaEvent } from "./pwa/analytics";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaInstallTracker() {
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      trackPwaEvent({ event_type: "pwa_install_prompt_available" });
      const promptEvent = event as BeforeInstallPromptEvent;
      if (promptEvent.userChoice) {
        promptEvent.userChoice.then((choice) => {
          trackPwaEvent({
            event_type: "pwa_install_prompt_result",
            payload: { outcome: choice.outcome, platform: choice.platform },
          });
        });
      }
    };

    const onInstalled = () => {
      trackPwaEvent({ event_type: "pwa_installed" });
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return null;
}
