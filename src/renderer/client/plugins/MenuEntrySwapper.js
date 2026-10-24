// RuneLite-style Menu Entry Swapper (see menuswapper/swapper.js).
import { MenuEntrySwapper } from "./menuswapper/swapper.js";

// Dev only: swap code edits into the running plugin instead of letting Vite
// reload the page, which would log the player out.
if (import.meta.hot) {
  import.meta.hot.accept((updated) => {
    const entry = document.highlite?.managers?.PluginManager?.plugins?.find((p) => p.instance?.pluginName === "Menu Entry Swapper");
    const instance = entry?.instance;
    if (!updated?.default || !instance) return;
    const wasEnabled = instance.settings.enable.value;
    // A half-finished edit can leave stop() broken; swap in the new code anyway.
    try {
      if (wasEnabled) instance.stop();
    } catch (error) {
      console.error("[MenuEntrySwapper] stop() failed during hot swap", error);
    }
    Object.setPrototypeOf(instance, updated.default.prototype);
    if (wasEnabled) instance.start();
    console.info("[MenuEntrySwapper] Hot-swapped plugin code");
  });
}

export {
  MenuEntrySwapper as default
};
