// OSRS's Make-X for the game's crafting-type windows (crafting, smelting,
// smithing, potion making, the kiln): a quantity bar (1, 5, 10, X, All)
// across the top, and a click on an item makes that many. Space makes the
// item made last (or the first one), and the number keys 1-9 make the item
// in that place, as in OSRS. The choice of quantity is kept between windows.
//
// The game's own left-click makes one; other amounts go through the game's
// handling of its right-click "Create" amounts (the same checks, its X
// prompt, "All" as the server counts it), so nothing is sent that choosing
// that amount from the menu wouldn't send.

const QUANTITIES = ["1", "5", "10", "X", "All"];
const QUANTITY_KEY = "openlite-make-quantity";
const BAR_CLASS = "osrs-make-x";
const STYLE_ID = "osrs-make-x-style";
const ORANGE = "#ff981f";

// Kept on the page, so updated code can take over from (and remove) what
// earlier code installed.
const state = window.__osrsMakeX ??= { installed: false, lastMade: null, onKey: null, observer: null };

function readQuantity() {
  try {
    const value = localStorage.getItem(QUANTITY_KEY);
    return QUANTITIES.includes(value) ? value : "1";
  } catch {
    return "1";
  }
}

function writeQuantity(value) {
  try {
    localStorage.setItem(QUANTITY_KEY, value);
  } catch {}
}

const uiController = () => document.highlite?.gameHooks?.UIManager?.Manager?.getController?.();

// The game's crafting-type window controllers (they share one base class).
function makeControllers() {
  const ui = uiController();
  if (!ui) return [];
  return Object.values(ui).filter((value) => value && typeof value._handleCreatableItemPanelPointerDown === "function");
}

// Makes `quantity` of item `itemId` in the window of `controller`.
function make(controller, itemId, quantity) {
  const menu = uiController()?.ContextMenuController;
  const handler = menu?._handleInventoryItemContextMenuItemPointerDown;
  // The game's item class, from any item the player holds.
  const player = document.highlite?.gameHooks?.EntityManager?.Instance?.MainPlayer;
  const ItemClass = player?.Inventory?.Items?.find(Boolean)?.constructor;
  if (!menu?._contextMenuItemFactory || typeof handler !== "function" || !ItemClass) return false;
  const create = document.highlite.gameLookups.InventoryActions.create;
  const entry = menu._contextMenuItemFactory.createInventoryItemContextMenuItem(handler, controller._menuType, create, new ItemClass(itemId, 0, false), 0, quantity, 0);
  handler.call(menu, entry, { Button: 0 });
  state.lastMade = itemId;
  return true;
}

// Left-clicks on an item panel make the chosen quantity.
function wrapClick(controller) {
  if (controller.osrsMakeXOriginal) return;
  const original = controller._handleCreatableItemPanelPointerDown;
  const wrapped = (panel, event) => {
    const quantity = readQuantity();
    if (event?.Button === 0 && event?.Data?.ID !== undefined) {
      if (quantity === "1") state.lastMade = event.Data.ID;
      else if (make(controller, event.Data.ID, quantity)) return;
    }
    return original(panel, event);
  };
  controller.osrsMakeXOriginal = original;
  controller._handleCreatableItemPanelPointerDown = wrapped;
  // A window already open keeps the listener it was given; swap it there too.
  const listeners = controller._createItemsMenu?.getOnCreateableItemPanelPointerDownEventListener?.();
  if (listeners) {
    listeners.remove(original);
    listeners.add(wrapped);
  }
}

function unwrapClick(controller) {
  const original = controller.osrsMakeXOriginal;
  if (!original) return;
  const listeners = controller._createItemsMenu?.getOnCreateableItemPanelPointerDownEventListener?.();
  if (listeners) {
    listeners.remove(controller._handleCreatableItemPanelPointerDown);
    listeners.add(original);
  }
  controller._handleCreatableItemPanelPointerDown = original;
  delete controller.osrsMakeXOriginal;
}

// The open window: its controller and the items on its current tab (with
// whether each can be made now).
function openWindow() {
  for (const controller of makeControllers()) {
    const menu = controller._createItemsMenu;
    if (!menu) continue;
    const tab = Math.max(0, menu._currentTablIndex ?? 0);
    const items = (menu._createableItemsPages?.[tab]?.CreatableItems ?? []).map((creatable, i) => ({
      id: creatable.Item?.ID,
      enabled: !menu._itemPanels?.[tab]?.[i]?.getElement?.().classList.contains("hs-opacity-25")
    }));
    return { controller, items };
  }
  return null;
}

// Keys only count while the crafting window is open and nothing is being
// typed (an empty chat box doesn't count as typing).
function isTyping() {
  const field = document.activeElement;
  if (!field || !/^(INPUT|TEXTAREA)$/.test(field.tagName)) return false;
  return !(field.closest(".hs-chat-menu") && !field.value);
}

function handleKey(event) {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || isTyping()) return;
  const isSpace = event.code === "Space";
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
  if (!isSpace && !digit) return;
  const open = openWindow();
  if (!open?.items.length) return;
  const item = isSpace
    ? open.items.find((candidate) => candidate.id === state.lastMade && candidate.enabled) ?? open.items.find((candidate) => candidate.enabled)
    : open.items[Number(digit) - 1];
  if (!item?.enabled || item.id === undefined) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  make(open.controller, item.id, readQuantity());
}

// The quantity bar, put into each crafting window as it opens.
function addBars() {
  for (const container of document.querySelectorAll(".hs-create-items-menu__content-container")) {
    if (container.querySelector(`.${BAR_CLASS}`)) continue;
    const bar = document.createElement("div");
    bar.className = BAR_CLASS;
    const label = document.createElement("span");
    label.textContent = "Make:";
    bar.appendChild(label);
    for (const quantity of QUANTITIES) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = quantity;
      button.dataset.quantity = quantity;
      button.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        writeQuantity(quantity);
        for (const other of document.querySelectorAll(`.${BAR_CLASS} button`)) other.classList.toggle("selected", other.dataset.quantity === quantity);
      });
      bar.appendChild(button);
    }
    for (const button of bar.querySelectorAll("button")) button.classList.toggle("selected", button.dataset.quantity === readQuantity());
    container.prepend(bar);
  }
}

const STYLE = `
/* OSRS Make-X (OSRS World plugin). */
.${BAR_CLASS} {
  align-items: center;
  display: flex;
  gap: 0.375rem;
  justify-content: center;
  margin: 0.375rem 0 0.25rem;
}
.${BAR_CLASS} span {
  color: ${ORANGE};
  font-weight: 700;
  margin-right: 0.25rem;
  text-shadow: 1px 1px 0 #000;
}
.${BAR_CLASS} button {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid #0e0c09;
  box-shadow: inset 0 0 0 1px #5d5446;
  color: ${ORANGE};
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  min-width: 2.75rem;
  padding: 0.25rem 0.5rem;
  text-shadow: 1px 1px 0 #000;
}
.${BAR_CLASS} button:hover {
  color: #ffffff;
}
.${BAR_CLASS} button.selected {
  background: rgba(120, 28, 16, 0.55);
  box-shadow: inset 0 0 0 1px #7a2a18, inset 0 0 6px rgba(255, 80, 40, 0.35);
  color: #ffffff;
}
.hs-createable-item-panel {
  background: rgba(0, 0, 0, 0.2) !important;
  border-radius: 0 !important;
  box-shadow: inset 0 0 0 1px #3e3529;
}
.hs-createable-item-panel:hover {
  box-shadow: inset 0 0 0 1px ${ORANGE};
}
.hs-create-items-menu__tabs-container__tab {
  border-radius: 0 !important;
}
.hs-create-items-menu__tabs-container__tab--selected {
  background: rgba(120, 28, 16, 0.55) !important;
}`;

// This copy of the code: an updated copy (a hot swap) takes over from what
// an earlier one installed.
const VERSION = {};

export function installMakeX() {
  const controllers = makeControllers();
  if (!controllers.length) return;
  if (state.installed && state.version !== VERSION) uninstallMakeX();
  for (const controller of controllers) wrapClick(controller);
  if (state.installed) return;
  state.installed = true;
  state.version = VERSION;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  state.observer = new MutationObserver(addBars);
  state.observer.observe(document.body, { childList: true, subtree: true });
  addBars();
  state.onKey = handleKey;
  window.addEventListener("keydown", state.onKey, true);
}

export function uninstallMakeX() {
  for (const controller of makeControllers()) unwrapClick(controller);
  state.observer?.disconnect();
  state.observer = null;
  if (state.onKey) window.removeEventListener("keydown", state.onKey, true);
  state.onKey = null;
  state.installed = false;
  document.getElementById(STYLE_ID)?.remove();
  for (const bar of document.querySelectorAll(`.${BAR_CLASS}`)) bar.remove();
}
