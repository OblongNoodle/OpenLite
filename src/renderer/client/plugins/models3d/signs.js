// Names painted on OSRS signs. The game's signs say what they mark only when
// inspected ("Orlando's Archery Shop"); their OSRS replacements carry that
// text on their boards, lettered on both faces, so a shop can be told from
// the street.

// Where each OSRS sign's board is, in the model's own space (tiles, before
// it is placed): its centre, size, and how far its faces stand off the
// middle (the lettering sits just in front of each).
export const SIGN_BOARDS = {
  2286: { x: 0.031, y: 0.246, width: 0.6, height: 0.19, depth: 0.06 }, // hanging shop sign
  2366: { x: 0.05, y: 1.29, width: 0.6, height: 0.24, depth: 0.1 } // sign on a post
};

// Lettering: dark paint on the wood, sized to fill the board, on up to two
// lines.
const TEXTURE_WIDTH = 512;
const PAINT = "#24160a";
const PAINT_HIGHLIGHT = "rgba(255, 236, 190, 0.35)";
const FONT = "Georgia, 'Times New Roman', serif";
const MAX_LINES = 2;

// The board's lettering as a canvas (transparent around the letters).
export function signTextCanvas(text, board) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = Math.round((TEXTURE_WIDTH * board.height) / board.width);
  const context = canvas.getContext("2d");
  const pad = canvas.height * 0.08;
  const fit = (lines) => {
    // The biggest font the lines fit the board at.
    let size = (canvas.height - pad * 2) / lines.length / 1.15;
    context.font = `700 ${size}px ${FONT}`;
    const widest = Math.max(...lines.map((line) => context.measureText(line).width));
    if (widest > canvas.width - pad * 2) size *= (canvas.width - pad * 2) / widest;
    return size;
  };
  // One line, or split at the space nearest the middle if two read bigger.
  const words = String(text).trim().split(/\s+/);
  let lines = [words.join(" ")];
  let size = fit(lines);
  if (words.length > 1 && MAX_LINES > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const split = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
      const splitSize = fit(split);
      if (!best || splitSize > best.size) best = { lines: split, size: splitSize };
    }
    if (best.size > size * 1.15) ({ lines, size } = best);
  }
  context.font = `700 ${size}px ${FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lineHeight = size * 1.1;
  lines.forEach((line, i) => {
    const y = canvas.height / 2 + (i - (lines.length - 1) / 2) * lineHeight;
    context.fillStyle = PAINT_HIGHLIGHT;
    context.fillText(line, canvas.width / 2 + 1, y + 1);
    context.fillStyle = PAINT;
    context.fillText(line, canvas.width / 2, y);
  });
  return canvas;
}

// Two lettered panels on a placed sign, in front of and behind its board
// (each readable from its own side), parented to the sign so they follow it.
export function addSignText(Mesh, sign, board, material) {
  const { x, y, width, height, depth } = board;
  const left = x - width / 2, right = x + width / 2, bottom = y - height / 2, top = y + height / 2;
  const panels = [];
  for (const side of [1, -1]) {
    const z = depth * side;
    const panel = new Mesh(`${sign.name}-lettering`, sign.getScene());
    panel.setVerticesData("position", [left, bottom, z, right, bottom, z, right, top, z, left, top, z], false);
    // Seen from behind, the lettering is mirrored back so it reads.
    panel.setVerticesData("uv", side > 0 ? [1, 0, 0, 0, 0, 1, 1, 1] : [0, 0, 1, 0, 1, 1, 0, 1], false);
    panel.setIndices(side > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    panel.material = material;
    panel.isPickable = false;
    panel.parent = sign;
    panels.push(panel);
  }
  return panels;
}
