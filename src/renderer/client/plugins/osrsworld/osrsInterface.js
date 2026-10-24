// OSRS-style interface: the game's own windows and buttons restyled in
// place with OSRS's interface sprites from the player's local OSRS cache
// (side-panel stone, tab icons, equipment slot tiles and silhouettes, close
// buttons), OSRS text colours and shadowed text. One stylesheet, injected
// and removed as a whole, so nothing about the game's interface changes but
// its look.

import { installMakeX, uninstallMakeX } from "./makeX.js";
import { installAmountPrompt, uninstallAmountPrompt } from "./amountPrompt.js";
import { loadSprites } from "./osrsSprites.js";

const STYLE_ID = "osrs-interface-style";

// OSRS sprite ids (RuneLite's gameval SpriteID names).
const SPRITE = {
  panel: 1031, // SIDE_BACKGROUND: the side panel's stone
  slotTile: 170, // EQUIPMENT_SLOT_TILE
  slotSelected: 179, // EQUIPMENT_SLOT_SELECTED
  statTile: 176, // STATS_TILE_HALF_RIGHT
  close: 535, // close button
  closeHover: 536,
  tabs: { combat: 168, stats: 898, quests: 899, inventory: 900, loadout: 901, prayer: 902, magic: 903, friendlist: 904, logout: 907, settings: 908, emotes: 909, music: 910 },
  worn: { head: 156, cape: 157, neck: 158, weapon: 159, torso: 161, shield: 162, legs: 163, hands: 164, feet: 165, ammo: 166 }
};
// The equipment window's columns of cells, top to bottom (see Models3D's
// LOADOUT_CELL_SLOTS), as worn-slot silhouettes.
const LOADOUT_COLUMNS = [["neck", "weapon", "hands"], ["head", "torso", "legs", "feet"], ["cape", "shield", "ammo"]];
// The side-panel stone has a seam along its edges; this much is trimmed so it
// tiles cleanly.
const PANEL_INSET = 12;
// OSRS interface colours.
const ORANGE = "#ff981f";
const YELLOW = "#ffff00";
const PANEL_EDGE_DARK = "#0e0c09";
const PANEL_EDGE_LIGHT = "#5d5446";

function stylesheet(url) {
  const sprite = (id) => (url[id] ? `url(${url[id]})` : "none");
  const tabRules = Object.entries(SPRITE.tabs).map(([tab, id]) => `
.hs-game-menu-bar__button__container__image--${tab} {
  background: ${sprite(id)} center / contain no-repeat !important;
  image-rendering: pixelated;
}`).join("");
  const slotRules = LOADOUT_COLUMNS.flatMap((column, c) => column.map((slot, r) => `
.hs-loadout-menu__column:nth-child(${c + 1}) .hs-loadout-menu__item-cell:nth-child(${r + 1}):empty {
  background: ${sprite(SPRITE.worn[slot])} center / 60% no-repeat, ${sprite(SPRITE.slotTile)} center / 100% 100% no-repeat !important;
}`)).join("");
  const panel = `
  background: ${sprite(SPRITE.panel)} repeat !important;
  border-radius: 0 !important;
  box-shadow: inset 0 0 0 1px ${PANEL_EDGE_LIGHT}, 0 0 0 2px ${PANEL_EDGE_DARK}, 0 2px 8px rgba(0, 0, 0, 0.6) !important;`;
  return `
/* OSRS interface style (OSRS World plugin). */
.hs-menu, .hs-game-menu-bar, .hs-closeable-menu {${panel}
}
.hs-menu, .hs-menu *, .hs-game-menu-bar, .hs-chat-menu, .hs-chat-menu * {
  text-shadow: 1px 1px 0 #000;
}
.hs-menu-header {
  background: transparent !important;
  border-bottom: 1px solid ${PANEL_EDGE_DARK} !important;
  box-shadow: 0 1px 0 ${PANEL_EDGE_LIGHT};
}
.hs-menu-header__title {
  color: ${ORANGE} !important;
  font-weight: 700;
}
.hs-close-button, .hs-menu-header__close-button {
  background: ${sprite(SPRITE.close)} center / contain no-repeat !important;
  border-radius: 0 !important;
  image-rendering: pixelated;
}
.hs-close-button:hover, .hs-menu-header__close-button:hover {
  background-image: ${sprite(SPRITE.closeHover)} !important;
}
.hs-close-button > *, .hs-menu-header__close-button > * {
  visibility: hidden;
}
.hs-game-menu-bar__button {
  background: transparent !important;
  border-radius: 0 !important;
}
.hs-game-menu-bar__button--selected {
  background: rgba(120, 28, 16, 0.55) !important;
  box-shadow: inset 0 0 0 1px #7a2a18, inset 0 0 6px rgba(255, 80, 40, 0.35) !important;
}
${tabRules}
.hs-loadout-menu__item-cell {
  background: ${sprite(SPRITE.slotTile)} center / 100% 100% no-repeat !important;
  border-radius: 0 !important;
  image-rendering: pixelated;
}
${slotRules}
.hs-stat-menu-item, .hs-stats-menu__information-panel, .hs-settings-menu__section {
  background: ${sprite(SPRITE.statTile)} center / 100% 100% no-repeat !important;
  border-radius: 0 !important;
}
.hs-stat-menu-item__level, .hs-stat-menu-item__level * {
  color: ${YELLOW} !important;
}
.hs-item-table__cell, .hs-inventory-item {
  background: transparent !important;
}
.hs-minimap-container {
  border-radius: 0 !important;
  box-shadow: 0 0 0 3px ${PANEL_EDGE_LIGHT}, 0 0 0 5px ${PANEL_EDGE_DARK} !important;
}
`;
}

let pending = null;

// Puts the OSRS style on the page (once the sprites are loaded), with OSRS's
// Make-X in crafting windows and the "Enter amount:" prompt.
export function applyOsrsInterface() {
  installMakeX();
  installAmountPrompt();
  if (document.getElementById(STYLE_ID) || pending || !window.osrsCache) return;
  const ids = [SPRITE.panel, SPRITE.slotTile, SPRITE.slotSelected, SPRITE.statTile, SPRITE.close, SPRITE.closeHover, ...Object.values(SPRITE.tabs), ...Object.values(SPRITE.worn)];
  pending = loadSprites(ids, { [SPRITE.panel]: PANEL_INSET }).then((urls) => {
    pending = null;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = stylesheet(urls);
    document.head.appendChild(style);
  }).catch(() => (pending = null));
}

export function removeOsrsInterface() {
  document.getElementById(STYLE_ID)?.remove();
  uninstallMakeX();
  uninstallAmountPrompt();
}
