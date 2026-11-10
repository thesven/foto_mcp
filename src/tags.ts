// Official Foto 303 Curated Whitelist Tags
export const FOTO_ALLOWED_TAGS: readonly string[] = [
  "35mm",
  "Abandoned",
  "Abstract",
  "Action",
  "Actor",
  "Actress",
  "Adventure",
  "Advertising",
  "Aerial",
  "Aerospace",
  "Agriculture",
  "AI",
  "Aircraft",
  "Alternative Process",
  "Ambrotype",
  "Americana",
  "Analog",
  "Animals",
  "Antique",
  "Appetizer",
  "Architecture",
  "Art",
  "Astrophotography",
  "Automotive",
  "Aviation",
  "Banal",
  "Beach",
  "Beauty",
  "BIPOC",
  "Birds",
  "Black and White",
  "Blue Hour",
  "Boats",
  "Books",
  "Botanical",
  "Boudoir",
  "Breakfast",
  "Bridge",
  "Cafe",
  "Candid",
  "Car",
  "Castle",
  "Cat",
  "Celebrations",
  "Ceramic",
  "Child",
  "Children",
  "Cityscapes",
  "Classic",
  "Clouds",
  "Coast",
  "Cocktail",
  "Coffee",
  "Collage",
  "Color",
  "Commercial",
  "Conceptual",
  "Concert",
  "Conservation",
  "Cooking",
  "Corporate",
  "Cosplay",
  "Countryside",
  "Crowd",
  "Cultural",
  "Cyanotype",
  "Cycling",
  "Dance",
  "Darkroom",
  "Dawn",
  "Daytime",
  "Decay",
  "Decorations",
  "Desert",
  "Dessert",
  "Design",
  "Digital Art",
  "Dinner",
  "Documentary",
  "Dog",
  "Door",
  "Drawing",
  "Drone",
  "Dusk",
  "Dry Plate",
  "Editorial",
  "Education",
  "Environmental Art",
  "Environmental Portrait",
  "Equine",
  "Esports",
  "Events",
  "Everyday Life",
  "Evening",
  "Experimental",
  "Explore",
  "Family",
  "Fall",
  "Farm",
  "Farmer",
  "Fashion",
  "Fatherhood",
  "Festival",
  "Fiber Art",
  "Figurative",
  "Film",
  "Fine Art",
  "Fine Art Nude",
  "Fitness",
  "Flash",
  "Flower",
  "Fog",
  "Food",
  "Forest",
  "Foto Walk",
  "Fruit",
  "Furniture",
  "Futuristic",
  "Gaming",
  "Garden",
  "Garage",
  "Glass",
  "Glamour",
  "Golden Hour",
  "Graffiti",
  "Graphic Design",
  "Gum Bichromate",
  "Healthcare",
  "Hiking",
  "Historical",
  "Horse",
  "Hospitality",
  "House",
  "Humor",
  "Ice",
  "ICM",
  "Illustration",
  "Impressionism",
  "Indigenous",
  "Industrial",
  "Infrared",
  "Insects",
  "Instant Film",
  "Interior",
  "Infrastructure",
  "Island",
  "Knitting",
  "Landscape",
  "Large Format",
  "LGBTQ+",
  "Lightning",
  "Lifestyle",
  "Light Painting",
  "Liminal",
  "Lomography",
  "Long Exposure",
  "Lunch",
  "Luxury",
  "Macro",
  "Man",
  "Manufacturing",
  "Marketing",
  "Martial Arts",
  "Maternity",
  "Medium Format",
  "Mental Health",
  "Metal",
  "Military",
  "Minimalist",
  "Miniature",
  "Mist",
  "Mixed Media",
  "Mobile Photo",
  "Model",
  "Modern",
  "Monochrome",
  "Moon",
  "Morning",
  "Motherhood",
  "Mountains",
  "Mountain Biking",
  "Motion",
  "Motion Blur",
  "Motorcycle",
  "Motorsports",
  "Multiple Exposure",
  "Music",
  "Musicians",
  "Nature",
  "Neon",
  "Newborn",
  "News",
  "Night",
  "Nightlife",
  "Noir",
  "Ocean",
  "Outdoor",
  "Painting",
  "Panoramic",
  "Partial AI",
  "Party",
  "Pattern",
  "Painterly",
  "People",
  "Performance",
  "Personal",
  "Pet",
  "Photojournalism",
  "Pictorialism",
  "Pinhole",
  "Plane",
  "Plants",
  "Polaroid",
  "Portrait",
  "Pottery",
  "Prairie",
  "Printmaking",
  "Product",
  "Production Still",
  "Project",
  "Real Estate",
  "Reflection",
  "Religious",
  "Reportage",
  "Reptile",
  "Restaurant",
  "Retro",
  "Rhythm",
  "Rural",
  "Science",
  "Scifi",
  "Sculpture",
  "Seascape",
  "Sewing",
  "Self Portrait",
  "Shadow",
  "Shop",
  "Ships",
  "Silhouette",
  "Silver Gelatin",
  "Skateboarding",
  "Skiing",
  "Sky",
  "Snack",
  "Snow",
  "Snowboarding",
  "Spirituality",
  "Spring",
  "Sports",
  "Stage",
  "Stars",
  "Still Life",
  "Storm",
  "Street",
  "Studio",
  "Summer",
  "Sunrise",
  "Sunset",
  "Surfing",
  "Surreal",
  "Surrealism",
  "Symmetry",
  "Tattoo",
  "Tea",
  "Tech",
  "Technology",
  "Telephoto",
  "Texture",
  "Theatre",
  "Tilt-Shift",
  "Time-Lapse",
  "Tintype",
  "Topographic",
  "Toy",
  "Toy Camera",
  "Train",
  "Transportation",
  "Travel",
  "Trees",
  "Truck",
  "Typography",
  "Underwater",
  "Urban",
  "Van",
  "Vegetable",
  "Vintage",
  "Visual Art",
  "Visual Diary",
  "Wall",
  "War",
  "Water",
  "Waterfall",
  "Weather",
  "Wedding",
  "Wet Plate Collodion",
  "Wetlands",
  "Wide Angle",
  "Wildlife",
  "Window",
  "Winter",
  "Woman",
  "Woodland",
  "Work In Progress"
];

const TAG_MAP_LOWER = new Map<string, string>(
  FOTO_ALLOWED_TAGS.map(t => [t.toLowerCase(), t])
);

/**
 * Validates whether a tag is in Foto's 303 allowed curated tags list (case-insensitive).
 * Returns the canonical tag string if valid, or null if invalid.
 */
export function getCanonicalTag(tag: string): string | null {
  const trimmed = tag.trim().replace(/^#/, "");
  return TAG_MAP_LOWER.get(trimmed.toLowerCase()) || null;
}

/**
 * Validates an array of tags. Returns { valid: boolean, canonicalTags: string[], invalidTags: string[], error?: string }
 */
export function validateTags(tags: string[]): {
  valid: boolean;
  canonicalTags: string[];
  invalidTags: string[];
  error?: string;
} {
  if (!Array.isArray(tags) || tags.length === 0) {
    return {
      valid: false,
      canonicalTags: [],
      invalidTags: [],
      error: "At least 1 tag is required by Foto (maximum 3)."
    };
  }

  if (tags.length > 3) {
    return {
      valid: false,
      canonicalTags: [],
      invalidTags: [],
      error: `Foto strictly allows a maximum of 3 tags per post (received ${tags.length}).`
    };
  }

  const canonicalTags: string[] = [];
  const invalidTags: string[] = [];

  for (const t of tags) {
    const canonical = getCanonicalTag(t);
    if (canonical) {
      if (!canonicalTags.includes(canonical)) {
        canonicalTags.push(canonical);
      }
    } else {
      invalidTags.push(t);
    }
  }

  if (invalidTags.length > 0) {
    return {
      valid: false,
      canonicalTags,
      invalidTags,
      error: `Invalid tags: ${invalidTags.map(t => '"' + t + '"').join(", ")}. Tags must be selected from Foto's 303 curated tags list.`
    };
  }

  return {
    valid: true,
    canonicalTags,
    invalidTags: []
  };
}

/**
 * Searches the 303 curated tags by substring or prefix.
 */
export function searchTags(query: string, limit = 20): string[] {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (!q) return FOTO_ALLOWED_TAGS.slice(0, limit);

  const prefixMatches: string[] = [];
  const substringMatches: string[] = [];

  for (const tag of FOTO_ALLOWED_TAGS) {
    const lower = tag.toLowerCase();
    if (lower.startsWith(q)) {
      prefixMatches.push(tag);
    } else if (lower.includes(q)) {
      substringMatches.push(tag);
    }
  }

  return [...prefixMatches, ...substringMatches].slice(0, limit);
}

/**
 * Suggests tags from Foto's curated list based on descriptive input.
 */
export function suggestTags(params: {
  caption?: string;
  cameraInfo?: string;
  keywords?: string[];
}): { suggestedTags: string[]; explanation: string } {
  const suggestions: Set<string> = new Set();
  const notes: string[] = [];

  const textToScan = [
    params.caption || "",
    params.cameraInfo || "",
    ...(params.keywords || [])
  ].join(" ").toLowerCase();

  const rules: Array<{ pattern: RegExp; tag: string; note: string }> = [
    { pattern: /\b(bird|birds|avian|duck|mallard|raven|crow|turkey|owl|eagle|hawk|heron|warbler|goose|geese|falcon)\b/i, tag: "Birds", note: "Detected bird/avian subject" },
    { pattern: /\b(wildlife|wildlifephotography|fauna)\b/i, tag: "Wildlife", note: "Detected wildlife subject" },
    { pattern: /\b(animal|animals|mammal|mammals|deer|moose|elk|squirrel|otter|fox|coyote|wolf|bear|beaver|toad|frog)\b/i, tag: "Animals", note: "Detected animal subject" },
    { pattern: /\b(nature|wilderness|outdoors|wild|ontariowildlife)\b/i, tag: "Nature", note: "Detected nature theme" },
    { pattern: /\b(35mm|135|film scan|film camera|leica|slr|rangefinder)\b/i, tag: "35mm", note: "Detected 35mm film context" },
    { pattern: /\b(120|220|medium format|6x6|6x7|645|hasselblad|mamiya|pentax 67|rolleiflex)\b/i, tag: "Medium Format", note: "Detected Medium Format context" },
    { pattern: /\b(4x5|8x10|large format|view camera|linhof|sinar)\b/i, tag: "Large Format", note: "Detected Large Format context" },
    { pattern: /\b(acros|tri-x|hp5|delta 100|delta 400|delta 3200|t-max|tmax|fomapan|kentmere|pan f|ilford|monochrome|b&w|black and white|grayscale)\b/i, tag: "Black and White", note: "Detected black and white aesthetic or film stock" },
    { pattern: /\b(classic chrome|classic neg|classic negative|eterna|nostalgic neg|pro neg|bleach bypass)\b/i, tag: "Analog", note: "Detected Fujifilm film simulation" },
    { pattern: /\b(portra|portra 160|portra 400|portra 800|ektar|gold 200|colorplus|ultramax|superia|pro 400h|cinestill|cinestill 800t|cinestill 400d|kodachrome|ektachrome|film stock|shot on film|analog)\b/i, tag: "Analog", note: "Detected analog film gear/film stock" },
    { pattern: /\b(velvia|provia|astia)\b/i, tag: "Color", note: "Detected Fujifilm color transparency simulation" },
    { pattern: /\b(film photography|darkroom|grain|emulsion)\b/i, tag: "Film", note: "Detected film photography theme" },
    { pattern: /\b(street|candid|urban|pedestrian|sidewalk)\b/i, tag: "Street", note: "Detected street photography" },
    { pattern: /\b(portrait|headshot|person|face|model)\b/i, tag: "Portrait", note: "Detected portrait subject" },
    { pattern: /\b(landscape|mountain|mountains|valley|vista)\b/i, tag: "Landscape", note: "Detected landscape scenery" },
    { pattern: /\b(architecture|building|facade|interior|structure|bridge)\b/i, tag: "Architecture", note: "Detected architecture subject" },
    { pattern: /\b(sunset|sunrise|golden hour|dusk|dawn)\b/i, tag: "Golden Hour", note: "Detected golden hour lighting" },
    { pattern: /\b(night|blue hour|twilight|evening)\b/i, tag: "Blue Hour", note: "Detected blue hour lighting" },
    { pattern: /\b(forest|trees|woodland|redwoods|pines)\b/i, tag: "Forest", note: "Detected forest environment" },
    { pattern: /\b(ocean|sea|beach|waves|coast|coastal|water|lake|pond|river)\b/i, tag: "Water", note: "Detected water/coastal environment" },
    { pattern: /\b(cityscape|downtown|skyline|metropolis)\b/i, tag: "Cityscapes", note: "Detected cityscape theme" },
    { pattern: /\b(macro|close up|detail|texture|insect|flower)\b/i, tag: "Macro", note: "Detected macro photography" },
    { pattern: /\b(minimal|minimalism|minimalist|clean)\b/i, tag: "Minimalist", note: "Detected minimalist composition" },
    { pattern: /\b(documentary|story|photojournalism|reportage)\b/i, tag: "Documentary", note: "Detected documentary style" },
    { pattern: /\b(astrophotography|milky way|stars|night sky|astro|after dark)\b/i, tag: "Astrophotography", note: "Detected astrophotography" },
    { pattern: /\b(coffee|cafe|espresso|latte)\b/i, tag: "Coffee", note: "Detected coffee context" },
    { pattern: /\b(travel|wanderlust|journey|vacation)\b/i, tag: "Travel", note: "Detected travel theme" },
    { pattern: /\b(fog|foggy|mist|misty|haze)\b/i, tag: "Fog", note: "Detected fog/mist atmosphere" }
  ];

  for (const rule of rules) {
    if (suggestions.size >= 3) break;
    if (rule.pattern.test(textToScan)) {
      suggestions.add(rule.tag);
      notes.push(rule.note);
    }
  }

  for (const tag of FOTO_ALLOWED_TAGS) {
    if (suggestions.size >= 3) break;
    const lower = tag.toLowerCase();
    const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefixBoundary = /^\w/.test(lower) ? "\\b" : "(?:^|\\s|[.,!?;:(])";
    const suffixBoundary = /\w$/.test(lower) ? "\\b" : "(?:$|\\s|[.,!?;:)])";
    const regex = new RegExp(`${prefixBoundary}${escaped}${suffixBoundary}`, "i");
    if (regex.test(textToScan) && !suggestions.has(tag)) {
      suggestions.add(tag);
      notes.push(`Matched exact tag: ${tag}`);
    }
  }

  if (suggestions.size === 0) {
    suggestions.add("Everyday Life");
    notes.push("Defaulted to Everyday Life");
  }

  return {
    suggestedTags: Array.from(suggestions).slice(0, 3),
    explanation: notes.join("; ")
  };
}
