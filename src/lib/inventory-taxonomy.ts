export type InventoryCategoryFamily = "Tables" | "Seating" | "Decor" | "Lighting" | "Rugs" | "Bedroom" | "Storage";

type InventoryCategoryOption = {
  label: string;
  value: string;
  aliases?: string[];
};

type InventoryCategoryGroup = {
  label: string;
  options: InventoryCategoryOption[];
};

type InventoryCategorySection = {
  family: InventoryCategoryFamily;
  groups: InventoryCategoryGroup[];
};

export const inventoryCategoryTaxonomy: InventoryCategorySection[] = [
  {
    family: "Tables",
    groups: [
      {
        label: "Table Types",
        options: [
          { label: "Coffee", value: "Tables / Coffee", aliases: ["coffee table", "cocktail table"] },
          { label: "Sofa", value: "Tables / Sofa", aliases: ["sofa table"] },
          { label: "End", value: "Tables / End", aliases: ["end table", "side table", "drink table"] },
          { label: "Dining", value: "Tables / Dining", aliases: ["dining table", "breakfast table"] },
          { label: "Buffet", value: "Tables / Buffet", aliases: ["buffet", "sideboard", "credenza"] },
          { label: "Console", value: "Tables / Console", aliases: ["console table", "entry table"] },
        ],
      },
    ],
  },
  {
    family: "Seating",
    groups: [
      {
        label: "Primary Seating",
        options: [
          { label: "Sofa", value: "Seating / Sofa", aliases: ["sectional", "loveseat", "settee"] },
          { label: "Bench", value: "Seating / Bench", aliases: ["banquette"] },
          { label: "Ottoman", value: "Seating / Ottoman", aliases: ["pouf", "footstool"] },
        ],
      },
      {
        label: "Chairs",
        options: [
          { label: "Sitting", value: "Seating / Chair / Sitting", aliases: ["side chair", "armchair", "arm chair"] },
          { label: "Dining", value: "Seating / Chair / Dining", aliases: ["dining chair", "wishbone chair"] },
          { label: "Desk", value: "Seating / Chair / Desk", aliases: ["desk chair", "office chair", "task chair"] },
          { label: "Lounge", value: "Seating / Chair / Lounge", aliases: ["lounge chair", "accent chair", "barrel chair", "club chair", "swivel chair"] },
        ],
      },
      {
        label: "Stools",
        options: [
          { label: "Counter Height", value: "Seating / Stool / Counter Height", aliases: ["counter stool", "counter-height stool"] },
          { label: "Bar Height", value: "Seating / Stool / Bar Height", aliases: ["bar stool", "bar-height stool"] },
        ],
      },
    ],
  },
  {
    family: "Decor",
    groups: [
      {
        label: "Greens",
        options: [
          { label: "Small", value: "Decor / Greens / Small", aliases: ["small plant", "small greenery", "small stems"] },
          { label: "Medium", value: "Decor / Greens / Medium", aliases: ["plant", "greenery", "stem bundle", "branches"] },
          { label: "Large", value: "Decor / Greens / Large", aliases: ["large plant", "tree", "olive tree", "fiddle leaf"] },
        ],
      },
      {
        label: "Accents",
        options: [
          { label: "Books", value: "Decor / Books", aliases: ["book set", "coffee table book"] },
          { label: "Vases", value: "Decor / Vases", aliases: ["vase"] },
          { label: "Clocks", value: "Decor / Clocks", aliases: ["clock"] },
          { label: "Decorative Objects", value: "Decor / Decorative Objects", aliases: ["decor", "decor object", "sculpture", "object"] },
          { label: "Pillows", value: "Decor / Pillows", aliases: ["pillow", "cushion"] },
          { label: "Throws", value: "Decor / Throws", aliases: ["throw", "throw blanket", "blanket"] },
          { label: "Mirrors", value: "Decor / Mirrors", aliases: ["mirror"] },
          { label: "Wall Art", value: "Decor / Wall Art", aliases: ["art", "wall art", "painting", "print", "framed art", "wall decor"] },
        ],
      },
    ],
  },
  {
    family: "Lighting",
    groups: [
      {
        label: "Lighting Types",
        options: [
          { label: "Ceiling", value: "Lighting / Ceiling", aliases: ["chandelier", "pendant", "flush mount", "ceiling light"] },
          { label: "Wall", value: "Lighting / Wall", aliases: ["sconce", "wall light"] },
          { label: "Table", value: "Lighting / Table", aliases: ["table lamp", "desk lamp"] },
          { label: "Floor", value: "Lighting / Floor", aliases: ["floor lamp"] },
          { label: "Outdoor", value: "Lighting / Outdoor", aliases: ["outdoor light", "outdoor lighting"] },
        ],
      },
    ],
  },
  {
    family: "Rugs",
    groups: [
      {
        label: "Rug Types",
        options: [
          { label: "Area", value: "Rugs / Area", aliases: ["area rug", "rug"] },
          { label: "Runner", value: "Rugs / Runner", aliases: ["runner", "runner rug"] },
        ],
      },
    ],
  },
  {
    family: "Bedroom",
    groups: [
      {
        label: "Bedroom Pieces",
        options: [
          { label: "Bed", value: "Bedroom / Bed", aliases: ["bed", "headboard"] },
          { label: "Nightstand", value: "Bedroom / Nightstand", aliases: ["nightstand", "bedside table"] },
          { label: "Dresser", value: "Bedroom / Dresser", aliases: ["dresser", "chest"] },
        ],
      },
    ],
  },
  {
    family: "Storage",
    groups: [
      {
        label: "Storage Pieces",
        options: [
          { label: "Cabinet", value: "Storage / Cabinet", aliases: ["cabinet"] },
          { label: "Shelving", value: "Storage / Shelving", aliases: ["shelf", "shelving", "bookcase", "etagere"] },
          { label: "Media Console", value: "Storage / Media Console", aliases: ["media console", "tv console"] },
        ],
      },
    ],
  },
];

export const inventoryCategoryFamilies = inventoryCategoryTaxonomy.map((section) => section.family);
export const inventoryCategoryOptions = inventoryCategoryTaxonomy.flatMap((section) =>
  section.groups.flatMap((group) => group.options),
);
export const inventoryCategorySuggestionValues = [
  ...inventoryCategoryFamilies,
  ...inventoryCategoryOptions.map((option) => option.value),
];

const categoryValueBySimplifiedLabel = new Map<string, string>();
const familyOrder = new Map(inventoryCategoryFamilies.map((family, index) => [family, index]));

for (const family of inventoryCategoryFamilies) {
  categoryValueBySimplifiedLabel.set(simplifyCategoryLabel(family), family);
}

for (const option of inventoryCategoryOptions) {
  categoryValueBySimplifiedLabel.set(simplifyCategoryLabel(option.value), option.value);
  for (const alias of option.aliases ?? []) {
    categoryValueBySimplifiedLabel.set(simplifyCategoryLabel(alias), option.value);
  }
}

function simplifyCategoryLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[/>:|,-]+/g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

type CategoryMatcher = {
  match: (value: string) => boolean;
  value: string;
};

const categoryMatchers: CategoryMatcher[] = [
  { match: (value) => value.includes("coffee table"), value: "Tables / Coffee" },
  { match: (value) => value.includes("cocktail table"), value: "Tables / Coffee" },
  { match: (value) => value.includes("sofa table"), value: "Tables / Sofa" },
  { match: (value) => value.includes("console table") || value.includes("entry table"), value: "Tables / Console" },
  { match: (value) => value.includes("end table") || value.includes("side table") || value.includes("drink table"), value: "Tables / End" },
  { match: (value) => value.includes("dining table") || value.includes("breakfast table"), value: "Tables / Dining" },
  { match: (value) => value.includes("buffet") || value.includes("sideboard") || value.includes("credenza"), value: "Tables / Buffet" },
  { match: (value) => value.includes("counter stool"), value: "Seating / Stool / Counter Height" },
  { match: (value) => value.includes("bar stool"), value: "Seating / Stool / Bar Height" },
  { match: (value) => value.includes("desk chair") || value.includes("office chair") || value.includes("task chair"), value: "Seating / Chair / Desk" },
  { match: (value) => value.includes("dining chair") || value.includes("wishbone chair"), value: "Seating / Chair / Dining" },
  {
    match: (value) =>
      value.includes("lounge chair") ||
      value.includes("accent chair") ||
      value.includes("barrel chair") ||
      value.includes("club chair") ||
      value.includes("swivel chair"),
    value: "Seating / Chair / Lounge",
  },
  { match: (value) => value.includes("chair"), value: "Seating / Chair / Sitting" },
  { match: (value) => value.includes("sectional") || value.includes("loveseat") || value.includes("sofa") || value.includes("settee"), value: "Seating / Sofa" },
  { match: (value) => value.includes("bench") || value.includes("banquette"), value: "Seating / Bench" },
  { match: (value) => value.includes("ottoman") || value.includes("pouf") || value.includes("footstool"), value: "Seating / Ottoman" },
  { match: (value) => value.includes("table lamp") || value.includes("desk lamp"), value: "Lighting / Table" },
  { match: (value) => value.includes("floor lamp"), value: "Lighting / Floor" },
  { match: (value) => value.includes("sconce") || value.includes("wall light"), value: "Lighting / Wall" },
  { match: (value) => value.includes("chandelier") || value.includes("pendant") || value.includes("flush mount") || value.includes("ceiling light"), value: "Lighting / Ceiling" },
  { match: (value) => value.includes("outdoor light") || value.includes("outdoor lighting"), value: "Lighting / Outdoor" },
  { match: (value) => value.includes("runner rug") || value.includes("runner"), value: "Rugs / Runner" },
  { match: (value) => value.includes("rug"), value: "Rugs / Area" },
  { match: (value) => value.includes("nightstand") || value.includes("bedside table"), value: "Bedroom / Nightstand" },
  { match: (value) => value.includes("dresser") || value.includes("chest"), value: "Bedroom / Dresser" },
  { match: (value) => value.includes("headboard") || value.includes("bed"), value: "Bedroom / Bed" },
  { match: (value) => value.includes("media console") || value.includes("tv console"), value: "Storage / Media Console" },
  { match: (value) => value.includes("bookcase") || value.includes("etagere") || value.includes("shelving") || value.includes("shelf"), value: "Storage / Shelving" },
  { match: (value) => value.includes("cabinet"), value: "Storage / Cabinet" },
  { match: (value) => value.includes("coffee table book") || value.includes("book set") || value.includes("books"), value: "Decor / Books" },
  { match: (value) => value.includes("vase"), value: "Decor / Vases" },
  { match: (value) => value.includes("clock"), value: "Decor / Clocks" },
  { match: (value) => value.includes("pillow") || value.includes("cushion"), value: "Decor / Pillows" },
  { match: (value) => value.includes("throw blanket") || value.startsWith("throw "), value: "Decor / Throws" },
  { match: (value) => value.includes("mirror"), value: "Decor / Mirrors" },
  {
    match: (value) =>
      value.includes("wall art") ||
      value.includes("painting") ||
      value.includes("framed art") ||
      value.includes("wall decor") ||
      value.includes(" print") ||
      value.startsWith("print "),
    value: "Decor / Wall Art",
  },
  { match: (value) => value.includes("tree") || value.includes("large plant") || value.includes("fiddle leaf") || value.includes("olive tree"), value: "Decor / Greens / Large" },
  { match: (value) => value.includes("small greenery") || value.includes("small plant") || value.includes("small stems"), value: "Decor / Greens / Small" },
  { match: (value) => value.includes("plant") || value.includes("greenery") || value.includes("stem bundle") || value.includes("branches"), value: "Decor / Greens / Medium" },
  { match: (value) => value.includes("decor object") || value.includes("decorative object") || value.includes("sculpture"), value: "Decor / Decorative Objects" },
];

export function canonicalizeInventoryCategory(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const simplified = simplifyCategoryLabel(trimmed);
  const directMatch = categoryValueBySimplifiedLabel.get(simplified);
  if (directMatch) {
    return directMatch;
  }

  const matcher = categoryMatchers.find((entry) => entry.match(simplified));
  if (matcher) {
    return matcher.value;
  }

  return trimmed.replace(/\s+/g, " ");
}

export function getInventoryCategoryFamily(value: string | null | undefined) {
  const canonical = canonicalizeInventoryCategory(value);
  if (!canonical) {
    return null;
  }

  const family = canonical.split("/")[0]?.trim();
  return inventoryCategoryFamilies.includes(family as InventoryCategoryFamily) ? (family as InventoryCategoryFamily) : null;
}

export function getInventoryCategoryGroups(family: InventoryCategoryFamily | null | undefined) {
  return inventoryCategoryTaxonomy.find((section) => section.family === family)?.groups ?? [];
}

export function sortInventoryCategories(values: string[]) {
  return [...values].sort((left, right) => {
    const leftFamily = getInventoryCategoryFamily(left);
    const rightFamily = getInventoryCategoryFamily(right);
    const leftOrder = leftFamily == null ? Number.MAX_SAFE_INTEGER : (familyOrder.get(leftFamily) ?? Number.MAX_SAFE_INTEGER);
    const rightOrder = rightFamily == null ? Number.MAX_SAFE_INTEGER : (familyOrder.get(rightFamily) ?? Number.MAX_SAFE_INTEGER);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.localeCompare(right, undefined, { sensitivity: "base" });
  });
}
