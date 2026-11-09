import assert from "node:assert";
import {
  FOTO_ALLOWED_TAGS,
  getCanonicalTag,
  validateTags,
  searchTags,
  suggestTags
} from "../../src/tags.js";

export async function runTagTests() {
  console.log("--- Testing Tags module ---");

  // 1. Basic properties
  assert.strictEqual(FOTO_ALLOWED_TAGS.length, 303);

  // 2. getCanonicalTag
  assert.strictEqual(getCanonicalTag("35mm"), "35mm");
  assert.strictEqual(getCanonicalTag("#Street"), "Street");
  assert.strictEqual(getCanonicalTag("  golden hour  "), "Golden Hour");
  assert.strictEqual(getCanonicalTag("non_existent_tag_xyz"), null);
  assert.strictEqual(getCanonicalTag(""), null);

  // 3. validateTags
  // Empty or non-array
  assert.strictEqual(validateTags([]).valid, false);
  assert.strictEqual(validateTags(null as any).valid, false);

  // Exceeds 3 tags
  const four = validateTags(["35mm", "Street", "Analog", "Portrait"]);
  assert.strictEqual(four.valid, false);
  assert(four.error?.includes("maximum of 3 tags"));

  // Invalid tag
  const bad = validateTags(["Street", "NotATag"]);
  assert.strictEqual(bad.valid, false);
  assert.deepStrictEqual(bad.invalidTags, ["NotATag"]);

  // Valid tags with deduplication
  const dupes = validateTags(["street", "STREET", "Street"]);
  assert.strictEqual(dupes.valid, true);
  assert.deepStrictEqual(dupes.canonicalTags, ["Street"]);

  // 4. searchTags
  // Empty query returns top limit
  const top10 = searchTags("", 10);
  assert.strictEqual(top10.length, 10);

  // Prefix vs substring
  const landMatches = searchTags("Land");
  assert(landMatches.includes("Landscape"));

  // Limit enforcement
  const limited = searchTags("a", 3);
  assert.strictEqual(limited.length, 3);

  // 5. suggestTags rule branches
  const samples = [
    { text: "A mallard duck flying over the river", expected: "Birds" },
    { text: "Wildlife in the backcountry wilderness", expected: "Wildlife" },
    { text: "A deer and beaver near the lake", expected: "Animals" },
    { text: "The Great Outdoors nature photography", expected: "Nature" },
    { text: "Leica rangefinder film scan", expected: "35mm" },
    { text: "Pentax 67 120 medium format frame", expected: "Medium Format" },
    { text: "Linhof 4x5 view camera large format", expected: "Large Format" },
    { text: "Portra 400 analog grain", expected: "Analog" },
    { text: "Monochrome grayscale b&w study", expected: "Black and White" },
    { text: "Candid urban sidewalk pedestrian", expected: "Street" },
    { text: "Studio headshot portrait of a model", expected: "Portrait" },
    { text: "Mountain valley vista landscape", expected: "Landscape" },
    { text: "Bridge architecture interior facade", expected: "Architecture" },
    { text: "Sunset at golden hour", expected: "Golden Hour" },
    { text: "Night twilight blue hour", expected: "Blue Hour" },
    { text: "Pine trees and woodland forest", expected: "Forest" },
    { text: "Ocean waves on the beach coastal water", expected: "Water" },
    { text: "Downtown cityscape skyline", expected: "Cityscapes" },
    { text: "Macro insect close up detail", expected: "Macro" },
    { text: "Clean minimalist composition", expected: "Minimalist" },
    { text: "Documentary photojournalism story", expected: "Documentary" },
    { text: "Stars in the milky way astrophotography", expected: "Astrophotography" },
    { text: "Espresso in a quiet cafe coffee", expected: "Coffee" },
    { text: "Vacation wanderlust travel journey", expected: "Travel" },
    { text: "Morning misty fog haze", expected: "Fog" }
  ];

  for (const s of samples) {
    const res = suggestTags({ caption: s.text });
    assert(
      res.suggestedTags.includes(s.expected),
      `Expected "${s.expected}" in suggestions for "${s.text}", got: ${JSON.stringify(res.suggestedTags)}`
    );
  }

  // Exact tag matching
  const exact = suggestTags({ keywords: ["Ambrotype", "Castle"] });
  assert(exact.suggestedTags.includes("Ambrotype") || exact.suggestedTags.includes("Castle"));

  // Default fallback when no rules match
  const fallback = suggestTags({ caption: "xyz 123 completely unrelated gibberish qwerty" });
  assert.strictEqual(fallback.suggestedTags[0], "Everyday Life");
  assert(fallback.explanation.includes("Defaulted to Everyday Life"));

  console.log("  ✓ Tags unit tests passed");
}
