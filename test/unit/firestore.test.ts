import assert from "node:assert";
import {
  generateFotoPostId,
  toFirestoreValue,
  fromFirestoreValue,
  setFirestoreDocument,
  getFirestoreDocument,
  savePrivateMetadata,
  savePostDocument,
  appendPostToUserProfile,
  indexPostTags,
  fetchUserProfile,
  deleteFirestoreDocument,
  resetUserProfilePosts
} from "../../src/api/firestore.js";

export async function runFirestoreTests() {
  console.log("--- Testing Firestore API module ---");

  // 1. generateFotoPostId
  const uid = "test-user-123";
  const pid = generateFotoPostId(uid);
  assert(pid.includes(uid));
  assert.match(pid, /^\d{14}-test-user-123-[a-zA-Z0-9]{8}$/);

  // 2. toFirestoreValue & fromFirestoreValue serialization roundtrip
  assert.deepStrictEqual(toFirestoreValue(null), { nullValue: null });
  assert.deepStrictEqual(toFirestoreValue(undefined), { nullValue: null });
  assert.strictEqual(fromFirestoreValue({ nullValue: null }), null);
  assert.strictEqual(fromFirestoreValue(null as any), null);
  assert.strictEqual(fromFirestoreValue("invalid" as any), null);

  assert.deepStrictEqual(toFirestoreValue(true), { booleanValue: true });
  assert.deepStrictEqual(toFirestoreValue(false), { booleanValue: false });
  assert.strictEqual(fromFirestoreValue({ booleanValue: true }), true);

  assert.deepStrictEqual(toFirestoreValue(42), { integerValue: "42" });
  assert.strictEqual(fromFirestoreValue({ integerValue: "42" }), 42);

  assert.deepStrictEqual(toFirestoreValue(3.1415), { doubleValue: 3.1415 });
  assert.strictEqual(fromFirestoreValue({ doubleValue: 3.1415 }), 3.1415);

  assert.deepStrictEqual(toFirestoreValue("hello"), { stringValue: "hello" });
  assert.strictEqual(fromFirestoreValue({ stringValue: "hello" }), "hello");

  const now = new Date();
  assert.deepStrictEqual(toFirestoreValue(now), { timestampValue: now.toISOString() });
  assert.strictEqual(fromFirestoreValue({ timestampValue: now.toISOString() }), now.toISOString());

  const arr = ["one", 2, true];
  assert.deepStrictEqual(toFirestoreValue(arr), {
    arrayValue: {
      values: [
        { stringValue: "one" },
        { integerValue: "2" },
        { booleanValue: true }
      ]
    }
  });
  assert.deepStrictEqual(
    fromFirestoreValue({
      arrayValue: {
        values: [{ stringValue: "one" }, { integerValue: "2" }]
      }
    }),
    ["one", 2]
  );
  assert.deepStrictEqual(fromFirestoreValue({ arrayValue: {} }), []);

  const obj = { str: "value", num: 10, und: undefined };
  assert.deepStrictEqual(toFirestoreValue(obj), {
    mapValue: {
      fields: {
        str: { stringValue: "value" },
        num: { integerValue: "10" }
      }
    }
  });
  assert.deepStrictEqual(
    fromFirestoreValue({
      mapValue: {
        fields: {
          str: { stringValue: "value" },
          num: { integerValue: "10" }
        }
      }
    }),
    { str: "value", num: 10 }
  );

  // BigInt or symbol fallback to stringValue
  assert.deepStrictEqual(toFirestoreValue(BigInt(99)), { stringValue: "99" });

  // 3. Mocked fetch tests for REST endpoints
  const originalFetch = globalThis.fetch;

  try {
    // setFirestoreDocument - success
    globalThis.fetch = async (url: any, init: any) => {
      return new Response(JSON.stringify({ name: "projects/foto-d963e/.../doc1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };
    const setResult = await setFirestoreDocument({
      collectionPath: "test_coll",
      documentId: "doc1",
      data: { key: "val" },
      idToken: "token123"
    });
    assert(setResult.name);

    // setFirestoreDocument - error
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: { message: "Permission Denied" } }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      });
    };
    await assert.rejects(
      async () => {
        await setFirestoreDocument({
          collectionPath: "test_coll",
          documentId: "doc1",
          data: { key: "val" },
          idToken: "token123"
        });
      },
      /Permission Denied/
    );

    // getFirestoreDocument - 404
    globalThis.fetch = async () => new Response("", { status: 404 });
    const notFound = await getFirestoreDocument({
      collectionPath: "test_coll",
      documentId: "missing",
      idToken: "token123"
    });
    assert.strictEqual(notFound, null);

    // getFirestoreDocument - 200 success
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          fields: {
            username: { stringValue: "lens_crafter" },
            postCount: { integerValue: "5" }
          }
        }),
        { status: 200 }
      );
    };
    const doc = await getFirestoreDocument({
      collectionPath: "user-profiles",
      documentId: "user1",
      idToken: "token123"
    });
    assert.deepStrictEqual(doc, { username: "lens_crafter", postCount: 5 });

    // getFirestoreDocument - 500 error
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Backend error" } }), { status: 500 });
    await assert.rejects(
      async () => {
        await getFirestoreDocument({
          collectionPath: "user-profiles",
          documentId: "user1",
          idToken: "token123"
        });
      },
      /Backend error/
    );

    // savePrivateMetadata - success
    globalThis.fetch = async () => new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    await savePrivateMetadata({
      privateMetadataId: "meta1",
      userId: "user1",
      imagePath: "posts/user1/img1",
      imageUrl: "https://storage.googleapis.com/...",
      publicDocPath: "posts/p1",
      exif: { Make: "Leica", Model: "M6" },
      idToken: "token123",
      portfolioImageId: "port1"
    });

    // savePrivateMetadata - failure
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 });
    await assert.rejects(
      async () => {
        await savePrivateMetadata({
          privateMetadataId: "meta1",
          userId: "user1",
          imagePath: "posts/user1/img1",
          imageUrl: "https://storage.googleapis.com/...",
          publicDocPath: "posts/p1",
          exif: {},
          idToken: "token123"
        });
      },
      /Quota exceeded/
    );

    // savePostDocument - success (single and series images)
    globalThis.fetch = async () => new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    await savePostDocument({
      postId: "p1",
      userId: "u1",
      imageUrl: "https://img.jpg",
      imagePath: "posts/u1/img",
      imageWidth: 1820,
      imageHeight: 1213,
      description: "Sample",
      tags: ["Landscape"],
      nudityRating: 0.01,
      privateMetadataId: "meta1",
      images: [{ imageId: "img1" }],
      idToken: "token123"
    });

    // savePostDocument - error
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Disk full" } }), { status: 500 });
    await assert.rejects(
      async () => {
        await savePostDocument({
          postId: "p1",
          userId: "u1",
          imageUrl: "https://img.jpg",
          imagePath: "posts/u1/img",
          imageWidth: 1820,
          imageHeight: 1213,
          description: "Sample",
          tags: ["Landscape"],
          nudityRating: 0.01,
          privateMetadataId: "meta1",
          idToken: "token123"
        });
      },
      /Disk full/
    );

    // appendPostToUserProfile - success on commit
    globalThis.fetch = async () => new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    await appendPostToUserProfile({
      userId: "u1",
      postId: "p1",
      idToken: "token123"
    });

    // appendPostToUserProfile - commit fails, fallback succeeds
    let callCount = 0;
    globalThis.fetch = async (url: any) => {
      callCount++;
      if (callCount === 1) {
        // commit fails
        return new Response(JSON.stringify({ error: "commit failed" }), { status: 400 });
      }
      if (callCount === 2) {
        // GET doc succeeds
        return new Response(JSON.stringify({ fields: { postIds: { arrayValue: { values: [{ stringValue: "old_post" }] } } } }), { status: 200 });
      }
      // PATCH doc succeeds
      return new Response(JSON.stringify({ name: "updated" }), { status: 200 });
    };
    await appendPostToUserProfile({
      userId: "u1",
      postId: "new_post",
      idToken: "token123"
    });

    // indexPostTags - normal shard and rollover shard
    callCount = 0;
    globalThis.fetch = async (url: any, init: any) => {
      callCount++;
      // Meta fetch for tag 1 (near limit)
      if (callCount === 1) {
        return new Response(JSON.stringify({ fields: { currentShard: { integerValue: "0" }, postCount: { integerValue: "15000" } } }), { status: 200 });
      }
      // Append to shard and update meta
      return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    };

    await indexPostTags({
      postId: "p1",
      tags: ["Landscape"],
      idToken: "token123"
    });

    // fetchUserProfile
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ fields: { username: { stringValue: "photog" } } }), { status: 200 });
    };
    const prof = await fetchUserProfile({ userId: "u1", idToken: "tok" });
    assert.strictEqual(prof?.username, "photog");

    // deleteFirestoreDocument
    globalThis.fetch = async () => new Response("", { status: 200 });
    const delOk = await deleteFirestoreDocument({
      collectionPath: "posts",
      documentId: "p1",
      idToken: "tok"
    });
    assert.strictEqual(delOk, true);

    // resetUserProfilePosts
    globalThis.fetch = async () => new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    const resetOk = await resetUserProfilePosts({
      userId: "u1",
      idToken: "tok"
    });
    assert.strictEqual(resetOk, true);

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("  ✓ Firestore unit tests passed");
}
