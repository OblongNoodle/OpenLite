// OSRS's chat-box prompts for the game's amount box, drawn with OSRS's own
// chat-box sprite over the chat area:
// - "Enter amount:" (Withdraw-X, Deposit-X...): the amount typed in blue
//   after an asterisk cursor, Enter to accept.
// - Make-X, for making items from two others (string on a bow...): "How many
//   do you wish to make?", OSRS's quantity buttons (1, 5, 10, X, All) and the
//   item being made, with its OSRS icon. A quantity button picks the
//   quantity; clicking the item or pressing Space makes that many. With X,
//   type an amount and press Enter. The quantity is shared with the crafting
//   window's Make-X bar (makeX.js) and kept between prompts.
// In both, "k" and "m" multiply what's typed by a thousand and a million and
// Escape closes. Other text prompts keep the game's own look.
//
// Only the look and the keys change: the amount still goes through the
// game's own box, its checks and its 11-digit limit.
import { loadSprites } from "./osrsSprites.js";

const PROMPT_CLASS = "osrs-amount-prompt";
const STYLE_ID = "osrs-amount-prompt-style";
// The game's titles for amount prompts ("Enter an amount to withdraw"...),
// and those for making items from two others.
const AMOUNT_TITLE = /^Enter (an amount|the number of sets)/;
const CREATE_TITLE = /^Enter (an amount to create|the number of sets to create)/;
const QUANTITIES = ["1", "5", "10", "X", "All"];
// The quantity chosen in Make-X (shared with makeX.js).
const QUANTITY_KEY = "openlite-make-quantity";
const MULTIPLIERS = { k: "000", m: "000000" };
// OSRS sprites: the chat box, and Make-X's quantity buttons.
const SPRITE = { chatbox: 1017, button: 4925, buttonSelected: 4926 };
// Where the prompt goes when the chat area can't be found.
const FALLBACK = { left: 8, bottom: 32, width: 556, height: 150 };

const state = window.__osrsAmountPrompt ??= { installed: false, observer: null, onKey: null, sprites: null };

const screenMask = () => document.highlite?.gameHooks?.UIManager?.Manager?.getController?.()?.ScreenMaskController;

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

// The open amount prompt's game object, or null.
function openPrompt() {
  const menu = screenMask()?._currentTextInputMenu;
  return menu && document.querySelector(`.${PROMPT_CLASS}`) ? menu : null;
}

// The chat area: the chat box down to the top of its input line.
function chatArea() {
  const chat = document.getElementById("hs-chat-menu")?.getBoundingClientRect();
  const input = document.getElementById("hs-chat-input-menu")?.getBoundingClientRect();
  if (!chat || !input) return null;
  const height = input.top - chat.top;
  if (height < 60 || chat.width < 200) return null;
  return { left: chat.left, top: chat.top, width: chat.width, height };
}

// The game's table of what two items make, found in the client's source by
// how it is used (minified names change between game versions).
function recipeTable() {
  if (state.recipes) return state.recipes;
  const source = document.getElementById("highspellClientScript")?.textContent ?? "";
  const name = /\(\w+ = (\w+)\.get\(i\.Def\.ID, r\.Def\.ID\)\)/.exec(source)?.[1];
  for (const scope of window.highliteScopes ?? []) {
    try {
      const found = scope(name);
      if (typeof found?.get === "function" && typeof found._createKey === "function") return (state.recipes = found);
    } catch {}
  }
  return null;
}

// The recipe a make prompt is for, or null.
function recipeOf(prompt) {
  const caller = prompt?._callerData;
  const recipes = recipeTable()?.get(caller?.SelectedItem?.Def?.ID, caller?.TargetItem?.Def?.ID);
  return recipes?.[caller?.ItemOnItemIndex ?? 0] ?? null;
}

// The item a make prompt is for: { id, name }, or null.
function productOf(prompt) {
  const def = recipeOf(prompt)?.Items?.[0]?.Def;
  const name = def?.Name ?? def?._name;
  return name ? { id: def.ID ?? def._id, name: name[0].toUpperCase() + name.slice(1) } : null;
}

// How many of the result the player's inventory has the makings of: by the
// items the recipe uses up (a knife on logs uses only the logs), or failing
// that the fewer of the two items being combined.
function makeableCount(prompt) {
  const items = document.highlite?.gameHooks?.EntityManager?.Instance?.MainPlayer?.Inventory?.Items ?? [];
  const count = (id) => items.reduce((sum, item) => sum + (item?.Def?.ID === id ? item.Amount || 1 : 0), 0);
  const usedUp = recipeOf(prompt)?.ItemsToRemove ?? [];
  if (usedUp.length) return Math.min(...usedUp.map((item) => Math.floor(count(item.ItemID) / Math.max(1, item.Amount))));
  const caller = prompt?._callerData;
  const ids = [caller?.SelectedItem?.Def?.ID, caller?.TargetItem?.Def?.ID];
  if (ids.some((id) => id === undefined)) return 0;
  return ids[0] === ids[1] ? Math.floor(count(ids[0]) / 2) : Math.min(count(ids[0]), count(ids[1]));
}

// Accepts `amount` in the open prompt, as typing it and pressing Enter would.
function submitAmount(amount) {
  const prompt = screenMask()?._currentTextInputMenu;
  if (!prompt || !(amount > 0)) return;
  prompt.getTextInput?.()?.setInputValue(String(amount));
  prompt._handleEnterKeyPressed(null, String(amount));
}

// Makes the chosen quantity (clicking the item, or Space). With X, the amount
// typed; nothing yet typed waits for one.
function makeChosenQuantity() {
  const prompt = screenMask()?._currentTextInputMenu;
  if (!prompt) return;
  const quantity = readQuantity();
  if (quantity === "X") {
    const typed = Number(prompt.getTextInput?.()?.getInputValue?.());
    if (typed > 0) submitAmount(typed);
    return;
  }
  submitAmount(quantity === "All" ? makeableCount(prompt) : Number(quantity));
}

function selectQuantity(menu, quantity) {
  writeQuantity(quantity);
  for (const button of menu.querySelectorAll(".osrs-makex__buttons button")) button.classList.toggle("selected", button.dataset.quantity === quantity);
  menu.classList.toggle("osrs-makex--x", quantity === "X");
}

// OSRS's Make-X layout, laid over the prompt.
function addMakeX(menu, prompt) {
  const layout = document.createElement("div");
  layout.className = "osrs-makex";
  const top = document.createElement("div");
  top.className = "osrs-makex__top";
  const title = document.createElement("span");
  title.className = "osrs-makex__title";
  title.textContent = "How many do you wish to make?";
  const buttons = document.createElement("div");
  buttons.className = "osrs-makex__buttons";
  for (const quantity of QUANTITIES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = quantity;
    button.dataset.quantity = quantity;
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      selectQuantity(menu, quantity);
    });
    buttons.appendChild(button);
  }
  top.append(title, buttons);
  const items = document.createElement("div");
  items.className = "osrs-makex__items";
  const product = productOf(prompt);
  const item = document.createElement("div");
  item.className = "osrs-makex__item";
  const icon = document.createElement("div");
  icon.className = "osrs-makex__icon";
  const name = document.createElement("span");
  name.textContent = product?.name ?? "";
  item.append(icon, name);
  item.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    makeChosenQuantity();
  });
  items.appendChild(item);
  layout.append(top, items);
  menu.appendChild(layout);
  selectQuantity(menu, readQuantity());
  // The item's OSRS icon (see Models3D's item icons).
  const models = document.highlite?.managers?.PluginManager?.plugins?.find((p) => p.instance?.pluginName === "3D Models")?.instance;
  if (product && models?.osrsIconFor) {
    models.osrsIconFor(product.name.toLowerCase()).then((url) => {
      if (url) icon.style.backgroundImage = `url(${url})`;
    }).catch(() => {});
  }
}

// Marks each amount prompt as it opens and moves it over the chat area.
function restylePrompts() {
  for (const menu of document.querySelectorAll(".hs-text-input-menu")) {
    const title = menu.querySelector(".hs-menu-header__title");
    if (!title) continue;
    if (!menu.classList.contains(PROMPT_CLASS)) {
      if (!AMOUNT_TITLE.test(title.textContent)) continue;
      menu.classList.add(PROMPT_CLASS);
      if (CREATE_TITLE.test(title.textContent)) {
        menu.dataset.osrsCreate = "";
        addMakeX(menu, screenMask()?._currentTextInputMenu);
      }
      title.textContent = "Enter amount:";
    }
    const area = chatArea();
    const style = menu.style;
    style.position = "fixed";
    style.margin = "0";
    style.transform = "none";
    if (area) {
      Object.assign(style, { left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px`, bottom: "" });
    } else {
      Object.assign(style, { left: `${FALLBACK.left}px`, bottom: `${FALLBACK.bottom}px`, width: `${FALLBACK.width}px`, height: `${FALLBACK.height}px`, top: "" });
    }
  }
}

// While an amount prompt is open: Space makes the chosen quantity (Make-X),
// "k"/"m" multiply the amount, Escape closes.
function handleKey(event) {
  const prompt = openPrompt();
  if (!prompt) return;
  const key = event.key?.toLowerCase();
  if (key === "escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    screenMask()?._removeTextInputMenu?.();
    return;
  }
  if (key === " " && document.querySelector(`.${PROMPT_CLASS}[data-osrs-create]`)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    makeChosenQuantity();
    return;
  }
  if (!MULTIPLIERS[key] || event.ctrlKey || event.altKey || event.metaKey) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const input = prompt.getTextInput?.();
  const value = input?.getInputValue?.() ?? "";
  if (!/^[1-9]\d*$/.test(value)) return;
  const multiplied = value + MULTIPLIERS[key];
  if (multiplied.length <= (input.getMaxLength?.() ?? 11)) input.setInputValue(multiplied);
}

function stylesheet(sprites) {
  const sprite = (id) => (sprites[id] ? `url(${sprites[id]})` : "none");
  const menu = `.hs-text-input-menu.${PROMPT_CLASS}`;
  return `
/* OSRS chat-box prompts (OSRS World plugin). Two classes, to win over the
   OSRS interface's panel style. */
${menu} {
  background: ${sprites[SPRITE.chatbox] ? `${sprite(SPRITE.chatbox)} 0 0 / 100% 100% no-repeat` : "#c9b993"} !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  display: flex;
  flex-direction: column;
  image-rendering: pixelated;
  justify-content: center;
  min-height: 0 !important;
  min-width: 0 !important;
}
${menu}, ${menu} * {
  text-shadow: none !important;
}
${menu} .hs-menu-header {
  background: none !important;
  border: none !important;
  box-shadow: none !important;
  justify-content: center;
  position: static;
}
${menu} .hs-menu-header__title {
  color: #000000 !important;
  flex: 1;
  font-weight: 700 !important;
  text-align: center;
}
${menu} .hs-menu-header__close-button {
  height: 1.25rem !important;
  margin: 0 !important;
  position: absolute !important;
  right: 0.5rem !important;
  top: 0.5rem !important;
  width: 1.25rem !important;
}
${menu} .hs-text-input-menu__content-container {
  padding: 0 !important;
}
${menu} .hs-text-input-span {
  background: none !important;
  color: #0000ff !important;
  font-weight: 700;
  margin: 0.25rem auto !important;
  width: auto !important;
}
${menu} .hs-text-input-span::after {
  content: "*";
}
${menu} .hs-prompt-menu__button-container {
  display: none !important;
}
/* Make-X: its own layout; the typed amount shows only with X chosen. */
${menu}[data-osrs-create] .hs-menu-header {
  display: none !important;
}
${menu}[data-osrs-create] .hs-text-input-menu__content-container {
  bottom: 0.75rem;
  left: 0;
  position: absolute;
  right: 0;
}
${menu}[data-osrs-create]:not(.osrs-makex--x) .hs-text-input-menu__content-container {
  display: none;
}
.osrs-makex {
  display: flex;
  flex-direction: column;
  inset: 0;
  padding: 0.75rem 1rem;
  position: absolute;
}
.osrs-makex__top {
  align-items: center;
  display: flex;
  justify-content: space-between;
}
.osrs-makex__title {
  color: #000000;
  font-weight: 700;
}
.osrs-makex__buttons {
  display: flex;
  gap: 0.25rem;
}
.osrs-makex__buttons button {
  background: ${sprite(SPRITE.button)} 0 0 / 100% 100% no-repeat;
  border: none;
  color: #ff981f;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  height: 25px;
  padding: 0;
  text-shadow: 1px 1px 0 #000 !important;
  width: 36px;
}
.osrs-makex__buttons button.selected {
  background-image: ${sprite(SPRITE.buttonSelected)};
  color: #ffffff;
}
.osrs-makex__items {
  align-items: center;
  display: flex;
  flex: 1;
  justify-content: center;
}
.osrs-makex__item {
  align-items: center;
  cursor: pointer;
  display: flex;
  flex-direction: column;
}
.osrs-makex__icon {
  background: center / contain no-repeat;
  height: 48px;
  width: 54px;
}
.osrs-makex__item span {
  color: #000000;
  font-weight: 700;
}
.osrs-makex__item:hover span {
  color: #ffffff;
  text-shadow: 1px 1px 0 #000 !important;
}`;
}

function putStyle(sprites) {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = stylesheet(sprites);
}

// This copy of the code: an updated copy (a hot swap) takes over from what
// an earlier one installed.
const VERSION = {};

export function installAmountPrompt() {
  if (state.installed && state.version === VERSION) return;
  if (state.installed) uninstallAmountPrompt();
  state.installed = true;
  state.version = VERSION;
  // Plain colours until the OSRS sprites have loaded.
  putStyle(state.sprites ?? {});
  if (!state.sprites && window.osrsCache) {
    loadSprites(Object.values(SPRITE)).then((sprites) => {
      state.sprites = sprites;
      if (state.installed) putStyle(sprites);
    }).catch(() => {});
  }
  // Only when a prompt opens (the page changes all the time: chat, overlays).
  const isPrompt = (node) => node.nodeType === Node.ELEMENT_NODE && (node.matches(".hs-text-input-menu") || node.querySelector(".hs-text-input-menu"));
  state.observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => [...mutation.addedNodes].some(isPrompt))) restylePrompts();
  });
  state.observer.observe(document.body, { childList: true, subtree: true });
  restylePrompts();
  state.onKey = handleKey;
  window.addEventListener("keydown", state.onKey, true);
}

export function uninstallAmountPrompt() {
  state.observer?.disconnect();
  state.observer = null;
  if (state.onKey) window.removeEventListener("keydown", state.onKey, true);
  state.onKey = null;
  state.installed = false;
  document.getElementById(STYLE_ID)?.remove();
}
