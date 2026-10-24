// RuneLite-style Menu Entry Swapper: choose which action a left-click does on
// a given NPC, object or inventory item. Shift + right-click something (on
// OpenLite Mobile: long-press it with the Tag button on) and
// pick "Swap <action>" to make that its left-click ("Reset swap" undoes it);
// the swapped action also goes to the top of its right-click menu. With
// "Shift-click drop" on, Shift + left-click drops an inventory item.
//
// In the bank, a left-click withdraws (bank items) or deposits (inventory
// items) the amount set in the settings, or the item's own amount set with
// Shift + right-click ("Swap withdraw-10"...).
//
// Swaps only change which of the game's own actions a click picks: the game
// still performs the action exactly as if it had been chosen from the menu.
import { Plugin, SettingsTypes, ContextMenuManager } from "@highlite/core";

// Hooks are installed once per page and call whichever plugin instance is
// current, so a hot-swapped plugin doesn't stack a second set.
const hooks = window.__menuSwapperHooks ??= { plugin: null, worldMenu: false, itemMenu: false, mousePointer: null, itemClick: null };

const SWAP_PREFIX = "swap_";
const RESET_ACTION = "reset_swap";
// World actions that never become a target's left-click.
const NOT_SWAPPABLE = new Set(["walk_here", "cancel", "inspect", "add_entity", "edit_entity", "moderate", "follow", "trade_with"]);
const PLAYER_TYPE = 3;
// Withdraw and deposit amounts: the setting's choices and the game's menu
// amount for each. "X" asks for an amount; "Last X" is the amount last typed
// (the game's own "Withdraw <n>" entry, which follows it).
const LAST_X = "Last X";
const AMOUNTS = { "1": "1", "5": "5", "10": "10", "100": "100", [LAST_X]: "XMemory", "X": "X", "All": "All", "All but one": "All But One" };
const WITHDRAW_CHOICES = ["1", "5", "10", "100", LAST_X, "X", "All", "All but one"];
const DEPOSIT_CHOICES = ["1", "5", "10", "100", "X", "All"];
const BANKING_STATE = "BankingState";
// How often the last Withdraw-X amount is saved or given back.
const LAST_X_SYNC_MS = 1000;

// An action number in one of the game's action enums, adding the name the
// way the core adds its own actions (menu labels come from these names).
function actionNumber(actions, name) {
  if (actions[name] === undefined) {
    const number = Object.keys(actions).length / 2;
    actions[actions[name] = number] = name;
  }
  return actions[name];
}

const lookups = () => document.highlite.gameLookups;
const entityName = (entity) => String(entity?._name ?? entity?.Name ?? "").toLowerCase();
const itemName = (item) => String(item?.Def?._name ?? item?.Def?.Name ?? "").toLowerCase();
const isPlayer = (entity) => (entity?._entityType ?? entity?.EntityType) === PLAYER_TYPE;

// The game class that handles left-clicks on inventory items, found in the
// game client's source by its method (minified names change between game
// versions) and looked up in the module scopes the hooks expose.
function inventoryClickClass() {
  const source = document.getElementById("highspellClientScript")?.textContent ?? "";
  const at = source.indexOf("static handleInventoryItemLeftClicked(");
  if (at < 0) return null;
  const name = /class (\w+)/.exec(source.slice(source.lastIndexOf("class ", at), at))?.[1];
  for (const scope of window.highliteScopes ?? []) {
    try {
      const found = scope(name);
      if (typeof found?.handleInventoryItemLeftClicked === "function") return found;
    } catch {}
  }
  return null;
}

export class MenuEntrySwapper extends Plugin {
  constructor() {
    super();
    this.pluginName = "Menu Entry Swapper";
    this.author = "OpenLite";
    this.settings.enable.value = true;
    this.defineSettings();
  }

  defineSettings() {
    this.settings.shiftClickDrop ??= {
      text: "Shift-click drop (inventory)",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => {}
    };
    this.settings.withdrawAmount ??= {
      text: "Bank: left-click withdraws",
      type: SettingsTypes.combobox,
      value: "1",
      options: WITHDRAW_CHOICES,
      callback: () => {}
    };
    this.settings.depositAmount ??= {
      text: "Bank: left-click deposits",
      type: SettingsTypes.combobox,
      value: "1",
      options: DEPOSIT_CHOICES,
      callback: () => {}
    };
  }

  init() {
    this.log("Initializing");
  }

  start() {
    this.log("Started");
    this.defineSettings();
    this.shiftHeld = false;
    this.onKey = (event) => (this.shiftHeld = event.shiftKey);
    this.onBlur = () => (this.shiftHeld = false);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKey, true);
    window.addEventListener("pointerdown", this.onKey, true);
    window.addEventListener("blur", this.onBlur);
    hooks.plugin = this;
    this.installHooks();
    this.keepLastX = setInterval(() => this.syncLastX(), LAST_X_SYNC_MS);
    this.syncLastX();
  }

  // The game forgets the last amount typed for Withdraw-X at logout (OSRS
  // keeps it); it is saved with the swaps and given back after login.
  syncLastX() {
    const menu = this.gameHooks.UIManager?.Manager?.getController?.()?.ContextMenuController;
    if (!menu || !this.data) return;
    const current = menu._bankWithdrawXMemory;
    if (current > 0) {
      if (this.data.lastX !== current) this.data.lastX = current;
    } else if (this.data.lastX > 0) {
      menu._bankWithdrawXMemory = this.data.lastX;
    }
  }

  stop() {
    this.log("Stopped");
    if (hooks.plugin === this) hooks.plugin = null;
    clearInterval(this.keepLastX);
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKey, true);
    window.removeEventListener("pointerdown", this.onKey, true);
    window.removeEventListener("blur", this.onBlur);
  }

  // Swaps by target name: { "banker": "bank_at" } and { "logs": "drop" }.
  get worldSwaps() {
    return (this.data.worldSwaps ??= {});
  }

  get itemSwaps() {
    return (this.data.itemSwaps ??= {});
  }

  // Withdraw and deposit amounts by item: { "logs": "All" }.
  get withdrawSwaps() {
    return (this.data.withdrawSwaps ??= {});
  }

  get depositSwaps() {
    return (this.data.depositSwaps ??= {});
  }

  setSwap(table, key, action) {
    const swaps = { ...this[table] };
    if (action) swaps[key] = action;
    else delete swaps[key];
    this.data[table] = swaps;
    this.log(action ? `Left-click on ${key}: ${action.replace(/_/g, " ")}` : `Swap on ${key} reset`);
  }

  installHooks() {
    const manager = new ContextMenuManager();
    // Right-click menus get the Swap entries.
    if (!hooks.worldMenu) {
      hooks.worldMenu = manager.registerContextHook("ContextMenuItemManager", "_createGameWorldContextMenuItems", (args, items, menuItems) => {
        try {
          hooks.plugin?.addWorldMenuItems(args, items, menuItems);
        } catch (error) {
          console.error("[Menu Entry Swapper] Adding menu items failed", error);
        }
        return items;
      });
    }
    if (!hooks.itemMenu) {
      hooks.itemMenu = manager.registerContextHook("ContextMenuItemManager", "_createInventoryItemContextMenuItems", (args, items, menuItems) => {
        try {
          hooks.plugin?.addItemMenuItems(args, items, menuItems);
        } catch (error) {
          console.error("[Menu Entry Swapper] Adding menu items failed", error);
        }
        return items;
      });
    }
    // The wrappers below are put in over the game's original methods (kept in
    // `hooks`) every start, and call the current plugin's code, so edits
    // apply without a page reload.
    // The world target's action list (the first entry is the left-click) is
    // built for every pointer position; the swapped action is moved first.
    const targets = this.gameHooks.TargetActionManager;
    if (typeof targets?.getActionsAndEntitiesAtMousePointer === "function") {
      const original = (hooks.mousePointer ??= targets.getActionsAndEntitiesAtMousePointer);
      targets.getActionsAndEntitiesAtMousePointer = function (...args) {
        const result = original.apply(this, args);
        try {
          hooks.plugin?.reorderWorldActions(targets._mousePointActionsAndEntitiesResult);
        } catch (error) {
          console.error("[Menu Entry Swapper] Reordering failed", error);
        }
        return result;
      };
    }
    // Left-clicks on inventory and bank items.
    const clicks = inventoryClickClass();
    if (clicks) {
      const inventory = (hooks.itemClick ??= clicks.handleInventoryItemLeftClicked);
      clicks.handleInventoryItemLeftClicked = function (control, click) {
        const plugin = hooks.plugin;
        return plugin ? plugin.inventoryLeftClick(inventory.bind(this), control, click) : inventory.call(this, control, click);
      };
      const bank = (hooks.bankClick ??= clicks.handleBankItemLeftClicked);
      clicks.handleBankItemLeftClicked = function (control, click) {
        const plugin = hooks.plugin;
        if (!plugin?.bankLeftClick(click, "withdraw")) return bank.call(this, control, click);
      };
    } else {
      this.warn("Inventory click handler not found; item swaps are off");
    }
  }

  // Swaps are chosen while Shift is held, or (on OpenLite Mobile, with no
  // Shift key) while its Tag button is on, as Object Markers' tags are.
  choosingSwaps() {
    return this.shiftHeld || !!window.openliteTagMode;
  }

  // --- World targets --------------------------------------------------------

  reorderWorldActions(result) {
    const entries = result?._actionsAndEntities;
    if (!entries?.length) return;
    const names = lookups().GameWorldActions;
    const index = entries.findIndex((entry) => {
      const entity = entry?._entity;
      if (!entity || isPlayer(entity)) return false;
      const wanted = this.worldSwaps[entityName(entity)];
      return wanted !== undefined && names[entry._action] === wanted;
    });
    if (index <= 0) return;
    entries.unshift(entries.splice(index, 1)[0]);
    result._mainActionAndEntity = entries[0];
  }

  // While choosing swaps, each NPC or object in the menu gets "Swap <action>"
  // entries for its other actions, and "Reset swap" if it has one.
  addWorldMenuItems(args, items, menuItems) {
    if (!this.choosingSwaps() || !Array.isArray(items)) return;
    const entries = args[0]?._actionsAndEntities ?? [];
    const names = lookups().GameWorldActions;
    const seen = new Set();
    for (const entry of entries) {
      const entity = entry?._entity;
      const action = names[entry?._action];
      if (!entity || isPlayer(entity) || !action || NOT_SWAPPABLE.has(action) || action.startsWith(SWAP_PREFIX)) continue;
      const key = entityName(entity);
      if (!key) continue;
      if (this.worldSwaps[key] !== action && !seen.has(`${key}|${action}`)) {
        seen.add(`${key}|${action}`);
        items.push(menuItems._contextMenuItemFactory.createGameWorldContextMenuItem(
          actionNumber(names, SWAP_PREFIX + action), () => this.setSwap("worldSwaps", key, action), entity, null, null, null));
      }
      if (this.worldSwaps[key] && !seen.has(key)) {
        seen.add(key);
        items.push(menuItems._contextMenuItemFactory.createGameWorldContextMenuItem(
          actionNumber(names, RESET_ACTION), () => this.setSwap("worldSwaps", key, null), entity, null, null, null));
      }
    }
  }

  // --- Inventory items ------------------------------------------------------

  // An inventory item's left-click is its first listed action (or, at the
  // bank, deposit one): the swapped action is listed first for the click.
  inventoryLeftClick(original, control, click) {
    if (this.isBanking() && this.bankLeftClick(click, "deposit")) return;
    const actions = this.itemClickActions(click);
    if (!actions) return original(control, click);
    const [list, index] = actions;
    const [action] = list.splice(index, 1);
    list.unshift(action);
    try {
      return original(control, click);
    } finally {
      list.splice(list.indexOf(action), 1);
      list.splice(index, 0, action);
    }
  }

  isBanking() {
    const state = this.gameHooks.EntityManager?.Instance?.MainPlayer?.CurrentState?.getCurrentState?.();
    return lookups().PlayerActions[state] === BANKING_STATE;
  }

  // The amount a left-click withdraws or deposits for an item: its own, or
  // the setting's.
  bankAmount(item, kind) {
    const own = this[`${kind}Swaps`][itemName(item)];
    return own ?? this.settings[`${kind}Amount`]?.value ?? "1";
  }

  // A withdraw/deposit left-click for an amount other than 1 is done as the
  // game does that amount's menu entry (the same checks, "X" prompt and
  // remembered X). Returns false to leave the click to the game.
  bankLeftClick(click, kind) {
    const items = kind === "withdraw" ? this.gameHooks.EntityManager?.Instance?.MainPlayer?.BankStorageItems?.Items : null;
    const item = items ? items[click?.Slot] : click?.Item;
    if (!item || (kind === "deposit" && click?.Menu !== lookups().GameInterfaces.Inventory)) return false;
    const choice = this.bankAmount(item, kind);
    if (choice === "1" || !AMOUNTS[choice]) return false;
    const menu = this.gameHooks.UIManager?.Manager?.getController?.()?.ContextMenuController;
    const handler = menu?._handleInventoryItemContextMenuItemPointerDown;
    if (!menu?._contextMenuItemFactory || typeof handler !== "function") return false;
    // Withdrawing all but one of a single item leaves it be.
    if (choice === "All but one" && item.Amount <= 1) return true;
    // With no amount typed yet, "Last X" asks for one.
    const remembered = menu._bankWithdrawXMemory > 0 ? menu._bankWithdrawXMemory : 0;
    const amount = AMOUNTS[choice] === "XMemory" && !remembered ? "X" : AMOUNTS[choice];
    const actions = lookups().InventoryActions;
    const action = kind === "deposit" ? actions.deposit : this.gameHooks.ItemManager?.Instance?.ShouldWithdrawBankItemsAsIOU ? actions.withdrawiou : actions.withdraw;
    const entry = menu._contextMenuItemFactory.createInventoryItemContextMenuItem(handler, click.Menu, action, item, click.Slot, amount, remembered);
    handler.call(menu, entry, { Button: 0 });
    return true;
  }

  // For a left-click on an inventory item: the item's action list and the
  // index of the action to make first, or null to leave the click alone.
  itemClickActions(click) {
    if (click?.Menu !== lookups().GameInterfaces.Inventory) return null;
    const item = click.Item;
    const list = item?.Def?._inventoryActions;
    if (!Array.isArray(list) || item.IsIOU) return null;
    const names = lookups().InventoryActions;
    const wanted = this.shiftHeld && this.settings.shiftClickDrop.value ? "drop" : this.itemSwaps[itemName(item)];
    const index = wanted ? list.findIndex((action) => names[action] === wanted) : -1;
    return index > 0 ? [list, index] : null;
  }

  // While choosing swaps, an inventory item's menu gets "Swap <action>"
  // entries for its other actions, and "Reset swap" if it has one.
  addItemMenuItems(args, items, menuItems) {
    if (!this.choosingSwaps() || !Array.isArray(items)) return;
    const [, , item, slot, menu] = args;
    if (!item?.Def) return;
    const names = lookups().InventoryActions;
    const key = itemName(item);
    const add = (action, onChoose) => items.push(menuItems._contextMenuItemFactory.createInventoryItemContextMenuItem(onChoose, menu, actionNumber(names, action), item, slot, null, 0));
    // In the bank: the amount this item's left-click withdraws or deposits.
    const kind = menu === lookups().GameInterfaces.Bank ? "withdraw" : menu === lookups().GameInterfaces.Inventory && this.isBanking() ? "deposit" : null;
    if (kind) {
      const table = `${kind}Swaps`;
      const own = this[table][key];
      const remembered = this.gameHooks.UIManager?.Manager?.getController?.()?.ContextMenuController?._bankWithdrawXMemory;
      for (const choice of kind === "withdraw" ? WITHDRAW_CHOICES : DEPOSIT_CHOICES) {
        if (choice === own) continue;
        // "Last X" is shown as the amount, as the game's own entry is.
        if (choice === LAST_X && !(remembered > 0)) continue;
        const label = choice === LAST_X ? String(remembered) : choice.toLowerCase().replace(/ /g, "_");
        add(`${SWAP_PREFIX}${kind}-${label}`, () => this.setSwap(table, key, choice));
      }
      if (own) add(RESET_ACTION, () => this.setSwap(table, key, null));
      return;
    }
    if (menu !== lookups().GameInterfaces.Inventory) return;
    const current = this.itemSwaps[key];
    for (const number of item.Def._inventoryActions ?? []) {
      const action = names[number];
      if (!action || action === current || action === "inspect") continue;
      add(SWAP_PREFIX + action, () => this.setSwap("itemSwaps", key, action));
    }
    if (current) add(RESET_ACTION, () => this.setSwap("itemSwaps", key, null));
  }
}
