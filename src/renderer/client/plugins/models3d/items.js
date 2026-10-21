// Ground items: each item's inventory icon extruded into a thin 3D shape lying
// flat on the ground, the way OSRS draws dropped items.
import { colorDistance, readSpritesheetCell } from "./sampling.js";
import { GeometryBuilder } from "./geometry.js";

// Icons are reduced to this many blocks across before extruding.
const GRID = 24;
// Thickness of the extruded icon, in blocks.
const THICKNESS_BLOCKS = 1.6;
// Neighbouring blocks closer than this in colour merge into one box.
const MERGE_DISTANCE = 0.06;
// Size of the item on the ground, in tiles.
export const ITEM_SIZE = 0.6;

// Builds the extruded icon in a unit footprint: x and z in [-0.5, 0.5], lying
// on y = 0. The icon's top edge points north (+Z) so it reads upright from
// the default camera.
export async function loadItemGeometry(spritesheetInfo, cellIndex) {
  const { pixels, width, height } = await readSpritesheetCell(spritesheetInfo, cellIndex);
  const blockW = width / GRID, blockH = height / GRID;
  // Reduce to GRID x GRID blocks: a block is solid when most of its pixels are,
  // and takes the average colour of its solid pixels.
  const blocks = [];
  for (let row = 0; row < GRID; row++) {
    blocks.push([]);
    for (let col = 0; col < GRID; col++) {
      let r = 0, g = 0, b = 0, solid = 0, total = 0;
      for (let y = Math.floor(row * blockH); y < Math.floor((row + 1) * blockH); y++) {
        for (let x = Math.floor(col * blockW); x < Math.floor((col + 1) * blockW); x++) {
          total++;
          const i = (y * width + x) * 4;
          if (pixels[i + 3] < 128) continue;
          solid++;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
        }
      }
      blocks[row].push(solid * 2 >= total && solid > 0 ? [r / solid / 255, g / solid / 255, b / solid / 255] : null);
    }
  }

  const g = new GeometryBuilder();
  const unit = 1 / GRID;
  const thickness = unit * THICKNESS_BLOCKS;
  for (let row = 0; row < GRID; row++) {
    let col = 0;
    while (col < GRID) {
      const start = blocks[row][col];
      if (!start) {
        col++;
        continue;
      }
      // Extend the run while the colour stays close, averaging as we go.
      let end = col + 1;
      const sum = [...start];
      while (end < GRID && blocks[row][end] && colorDistance(blocks[row][end], start) < MERGE_DISTANCE) {
        for (let k = 0; k < 3; k++) sum[k] += blocks[row][end][k];
        end++;
      }
      const run = end - col;
      const color = sum.map((value) => value / run);
      const centerX = (col + run / 2) * unit - 0.5;
      const centerZ = 0.5 - (row + 0.5) * unit;
      g.box(run * unit, thickness, unit, centerX, thickness / 2, centerZ, color);
      col = end;
    }
  }
  return g;
}

// A stable pseudo-random yaw per item, so drops lie at varied angles that do
// not change from frame to frame.
export function itemYaw(entityId) {
  const hash = Math.sin((Number(entityId) || 0) * 12.9898) * 43758.5453;
  return (hash - Math.floor(hash) - 0.5) * 1.2;
}
