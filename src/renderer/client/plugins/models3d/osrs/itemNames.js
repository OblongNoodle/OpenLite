// The game's item names translated into OSRS's, so its items can use OSRS's
// models and icons. Candidates are tried in order (the first OSRS item that
// exists wins): explicit aliases, then names rewritten rule by rule.
//
// The game has its own metal and wood tiers; they stand in for OSRS's tiers
// in the same order (palladium is mithril, coronium adamant, celadon rune;
// palm logs are maple, cherry yew, wizard magic, deadwood redwood; pine logs
// are OSRS's Arctic pine logs, and pine bows willow).

// Whole-name aliases, for items OSRS calls something else altogether (or
// whose name means something else in OSRS).
const ALIASES = {
  "basic rod": "fishing rod",
  "great rod": "fishing rod",
  "ultra rod": "fly fishing rod",
  "master rod": "fly fishing rod",
  "black leather gloves": "leather gloves",
  "black leather boots": "leather boots",
  "leather body armour": "leather body",
  "leather bracers": "leather vambraces",
  steak: "cooked meat",
  "raw rodent meat": "raw rat meat",
  "rodent meat": "cooked meat",
  "raw game meat": "raw bear meat",
  "game meat": "cooked meat",
  "burnt food": "burnt meat",
  "raw crab": "raw crab meat",
  crab: "crab meat",
  "raw turtle": "raw sea turtle",
  turtle: "sea turtle",
  "raw stingray": "raw manta ray",
  stingray: "manta ray",
  "raw whaleshark": "raw shark",
  whaleshark: "shark",
  "raw walleye": "raw pike",
  walleye: "pike",
  "raw carp": "raw cave eel",
  carp: "cave eel",
  "raw frog": "raw karambwan",
  frog: "cooked karambwan",
  "raw octopus": "raw monkfish",
  octopus: "monkfish",
  "raw piranha": "raw anglerfish",
  piranha: "anglerfish",
  "raw clownfish": "raw trout",
  clownfish: "trout",
  "raw koi": "raw rainbow fish",
  koi: "rainbow fish",
  "golden koi": "golden tench",
  "raw bluegill": "raw herring",
  wheat: "grain",
  corn: "sweetcorn",
  "grilled corn": "cooked sweetcorn",
  string: "bow string",
  shovel: "spade",
  "bone meal": "bonemeal",
  "charred bones": "burnt bones",
  "empty glass": "beer glass",
  "empty bottle": "empty jug",
  "bottle of rum": "karamjan rum",
  "money bag": "coins",
  "wooden bow": "shortbow",
  "unstrung bow": "shortbow (u)",
  "robe top": "monk's robe top",
  "robe bottoms": "monk's robe",
  "wizard's hat": "wizard hat",
  "blue wizard's hat": "wizard hat",
  "wizard's top": "black robe",
  "blue wizard's top": "blue wizard robe",
  "wizard's bottoms": "black skirt",
  "blue wizard's bottoms": "blue skirt",
  "wizard's boots": "wizard boots",
  "blue wizard's boots": "wizard boots",
  "bandit mask": "highwayman mask",
  "red santa hat": "santa hat",
  "christmas present": "present",
  "pine scroll": "scroll",
  "oak scroll": "scroll",
  "palm scroll": "scroll",
  "sakura scroll": "scroll",
  "wizard scroll": "scroll",
  "deadwood scroll": "scroll",
  "lucky scroll": "scroll",
  "lucky logs": "logs",
  "pig iron bar": "iron bar",
  "silver nugget": "silver ore",
  "gold nugget": "gold ore",
  "uranium ore": "runite ore",
  "celadium ore": "runite ore",
  "celadium bar": "runite bar",
  "palladium ore": "mithril ore",
  "palladium bar": "mithril bar",
  "coronium ore": "adamantite ore",
  "coronium bar": "adamantite bar",
  "pine logs": "arctic pine logs",
  "palm logs": "maple logs",
  "cherry logs": "yew logs",
  "wizard logs": "magic logs",
  "deadwood logs": "redwood logs",
  "plains dragonleather": "green dragon leather",
  "water dragonleather": "blue dragon leather",
  "fire dragonleather": "red dragon leather",
  "shadow dragonleather": "black dragon leather",
  "sky dragonleather": "black dragon leather"
};

// Word-level rewrites, applied in order to whatever no alias covers.
const RULES = [
  // Metal and wood tiers.
  [/^palladium\b/, "mithril"],
  [/^coronium\b/, "adamant"],
  [/^celadon\b/, "rune"],
  [/^plains dragonleather\b/, "green d'hide"],
  [/^water dragonleather\b/, "blue d'hide"],
  [/^fire dragonleather\b/, "red d'hide"],
  [/^(shadow|sky) dragonleather\b/, "black d'hide"],
  [/^(unstrung )?pine\b/, "$1willow"],
  [/^(unstrung )?palm\b/, "$1maple"],
  [/^(unstrung )?cherry\b/, "$1yew"],
  [/^(unstrung )?wizard's bow$/, "$1magic shortbow"],
  [/^(unstrung )?deadwood bow$/, "$1magic longbow"],
  // Pieces of armour and weapons.
  [/\bchestplate\b/, "platebody"],
  [/\bchainmail body\b/, "chainbody"],
  [/\bgreat sword\b/, "2h sword"],
  [/\bshield\b/, "kiteshield"],
  [/\bhatchet\b/, "axe"],
  [/\barrowheads\b/, "arrowtips"],
  [/\bbracers\b/, "vambraces"],
  [/^(.*) bow$/, "$1 shortbow"],
  [/^unstrung (.*)$/, "$1 (u)"],
  // Gems.
  [/^rough (.*)$/, "uncut $1"],
  [/^(.*) gem$/, "$1"],
  [/\bcitrine\b/, "opal"],
  [/\bcarbonado\b/, "dragonstone"],
  [/\btopaz\b/, "red topaz"],
  // Potions: "potion of strength (2)" is "strength potion(2)".
  [/^potion of accuracy \((\d)\)$/, "attack potion($1)"],
  [/^potion of defense \((\d)\)$/, "defence potion($1)"],
  [/^potion of restoration \((\d)\)$/, "restore potion($1)"],
  [/^potion of (\w+) \((\d)\)$/, "$1 potion($2)"]
];

// Trim and plating suffixes: OSRS's gold-trimmed (g) and trimmed (t).
const SUFFIXES = [
  [/ \(gold trim\)$/, " (g)"],
  [/ \(silver trim\)$/, " (t)"],
  [/ \([^)]*\)$/, ""]
];

// OSRS names to try for a game item name (lower case), best first.
// `hasRaw(name)` tells whether the game also has "raw <name>" (then the item
// is the cooked one, which OSRS calls "cooked ...").
export function osrsNameCandidates(name, hasRaw = () => false) {
  const key = name.toLowerCase();
  const candidates = [];
  const add = (value) => value && !candidates.includes(value) && candidates.push(value);
  add(ALIASES[key]);
  if (hasRaw(key)) add(`cooked ${key}`);
  let rewritten = key;
  for (const [pattern, replacement] of RULES) rewritten = rewritten.replace(pattern, replacement);
  // The game's open helms are OSRS med helms, its full helms OSRS's full
  // helms (OSRS's plain "helm" items are unused).
  const medHelm = (value) => value.replace(/\b(\w+) helm\b/, (match, word) => (word === "full" || word === "med" ? match : `${word} med helm`));
  for (const value of [rewritten, key]) {
    add(medHelm(value));
    add(value);
    for (const [pattern, replacement] of SUFFIXES) {
      if (!pattern.test(value)) continue;
      const trimmed = value.replace(pattern, replacement);
      add(medHelm(trimmed));
      add(trimmed);
    }
    add(value.replace(/s$/, ""));
  }
  return candidates;
}
