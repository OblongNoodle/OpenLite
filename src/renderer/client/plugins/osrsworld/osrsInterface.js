// OSRS-style interface: the game's own windows and buttons restyled in
// place with OSRS's interface sprites from the player's local OSRS cache
// (side-panel stone, tab icons, equipment slot tiles and silhouettes, close
// buttons), OSRS text colours and shadowed text. One stylesheet, injected
// and removed as a whole, so nothing about the game's interface changes but
// its look.

const SPRITE_INDEX = 8;
const FLAG_VERTICAL = 1, FLAG_ALPHA = 2;
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

// First frame of a sprite group as a data URL; `inset` trims that many
// pixels off every edge (for tiling a sprite without its border).
function spriteUrl(bytes, inset = 0) {
  const n = bytes.length;
  const count = (bytes[n - 2] << 8) | bytes[n - 1];
  let o = n - 7 - count * 8;
  const u16 = () => {
    const value = (bytes[o] << 8) | bytes[o + 1];
    o += 2;
    return value;
  };
  u16();
  u16();
  const paletteLength = bytes[o++] + 1;
  o += count * 4;
  const width = u16();
  o += (count - 1) * 2;
  const height = u16();
  o = n - 7 - count * 8 - (paletteLength - 1) * 3;
  const palette = [0];
  for (let i = 1; i < paletteLength; i++, o += 3) palette.push((bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2]);
  o = 0;
  const flags = bytes[o++];
  const size = width * height;
  const read = (target) => {
    if (flags & FLAG_VERTICAL) {
      for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) target[y * width + x] = bytes[o++];
    } else {
      for (let i = 0; i < size; i++) target[i] = bytes[o++];
    }
  };
  const indices = new Uint8Array(size);
  read(indices);
  const alpha = new Uint8Array(size).fill(255);
  if (flags & FLAG_ALPHA) read(alpha);
  const rgba = new Uint8ClampedArray(size * 4);
  for (let p = 0; p < size; p++) {
    const color = palette[indices[p]];
    rgba.set([(color >> 16) & 255, (color >> 8) & 255, color & 255, indices[p] ? alpha[p] : 0], p * 4);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width - 2 * inset;
  canvas.height = height - 2 * inset;
  canvas.getContext("2d").putImageData(new ImageData(rgba, width, height), -inset, -inset);
  return canvas.toDataURL();
}

async function loadSprites(ids) {
  const urls = {};
  await Promise.all(ids.map(async (id) => {
    const files = await window.osrsCache.files(SPRITE_INDEX, id);
    if (files?.length) urls[id] = spriteUrl(files[0].data, id === SPRITE.panel ? PANEL_INSET : 0);
  }));
  return urls;
}

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

// Puts the OSRS style on the page (once the sprites are loaded).
export function applyOsrsInterface() {
  if (document.getElementById(STYLE_ID) || pending || !window.osrsCache) return;
  const ids = [SPRITE.panel, SPRITE.slotTile, SPRITE.slotSelected, SPRITE.statTile, SPRITE.close, SPRITE.closeHover, ...Object.values(SPRITE.tabs), ...Object.values(SPRITE.worn)];
  pending = loadSprites(ids).then((urls) => {
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
}
