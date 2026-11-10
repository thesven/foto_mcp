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
  resetUserProfilePosts,
  fetchTagIndexMeta,
  fetchTagShardPosts,
  fetchPostDocument,
  fetchPostsDocuments,
  followUserInFirestore,
  unfollowUserInFirestore,
  deletePostFromFirestore,
  updatePostInFirestore,
  fetchPostWithMetadata,
  resolveUserByUsername,
  likePostInFirestore,
  unlikePostInFirestore,
  fetchPostComments,
  addPostComment,
  fetchUserNotifications,
  fetchHomeFeed,
  savePortfolioDocument,
  fetchUserPortfolios,
  fetchWithRetry,
  deleteCommentFromFirestore,
  fetchPostLikesUsers,
  updatePortfolioInFirestore,
  deletePortfolioFromFirestore,
  updateUserProfileInFirestore,
  reportContentInFirestore
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

    // fetchTagIndexMeta
    globalThis.fetch = async (url: any) => {
      const urlStr = decodeURIComponent(String(url));
      if (urlStr.includes("Fine Art Nude_meta")) {
        return new Response(JSON.stringify({ fields: { currentShard: { integerValue: "1" }, postCount: { integerValue: "420" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const metaFound = await fetchTagIndexMeta({ tag: "Fine Art Nude", idToken: "tok" });
    assert.strictEqual(metaFound?.currentShard, 1);
    assert.strictEqual(metaFound?.postCount, 420);

    const metaNotFound = await fetchTagIndexMeta({ tag: "Nonexistent", idToken: "tok" });
    assert.strictEqual(metaNotFound, null);

    // fetchTagShardPosts
    globalThis.fetch = async (url: any) => {
      const urlStr = decodeURIComponent(String(url));
      if (urlStr.includes("Fine Art Nude_0")) {
        return new Response(JSON.stringify({ fields: { posts: { arrayValue: { values: [{ stringValue: "post_1" }, { stringValue: "post_2" }] } } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const shardPosts = await fetchTagShardPosts({ tag: "Fine Art Nude", shard: 0, idToken: "tok" });
    assert.deepStrictEqual(shardPosts, ["post_1", "post_2"]);

    const shardPostsEmpty = await fetchTagShardPosts({ tag: "Empty", shard: 0, idToken: "tok" });
    assert.deepStrictEqual(shardPostsEmpty, []);

    // fetchPostDocument
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/post_1")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "post_1" }, description: { stringValue: "Artistic portrait" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const postDoc = await fetchPostDocument({ postId: "post_1", idToken: "tok" });
    assert.strictEqual(postDoc?.description, "Artistic portrait");

    const postDocMissing = await fetchPostDocument({ postId: "post_missing", idToken: "tok" });
    assert.strictEqual(postDocMissing, null);

    // fetchPostsDocuments
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/post_1")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "post_1" }, userId: { stringValue: "u1" } } }), { status: 200 });
      }
      if (urlStr.includes("posts/post_2")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "post_2" }, userId: { stringValue: "u2" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const batchPosts = await fetchPostsDocuments({ postIds: ["post_1", "post_2", "post_missing"], idToken: "tok" });
    assert.strictEqual(batchPosts.length, 2);
    assert.strictEqual(batchPosts[0].userId, "u1");
    assert.strictEqual(batchPosts[1].userId, "u2");

    // followUserInFirestore & unfollowUserInFirestore
    globalThis.fetch = async (url: any, init: any) => {
      return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    };
    const followOk = await followUserInFirestore({ currentUserId: "me", targetUserId: "target", idToken: "tok" });
    assert.strictEqual(followOk, true);

    const unfollowOk = await unfollowUserInFirestore({ currentUserId: "me", targetUserId: "target", idToken: "tok" });
    assert.strictEqual(unfollowOk, true);

    // deletePostFromFirestore (including series images[] and tag_index shard cleanup)
    globalThis.fetch = async (url: any, init: any) => {
      const urlStr = decodeURIComponent(String(url));
      if (urlStr.includes("posts/p_to_delete") && (!init?.method || init?.method === "GET")) {
        return new Response(
          JSON.stringify({
            fields: {
              postId: { stringValue: "p_to_delete" },
              privateMetadataId: { stringValue: "meta_to_delete" },
              images: {
                arrayValue: {
                  values: [
                    { mapValue: { fields: { privateMetadataId: { stringValue: "meta_series_2" } } } }
                  ]
                }
              },
              tags: { arrayValue: { values: [{ stringValue: "Street" }] } }
            }
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes("Street_meta")) {
        return new Response(JSON.stringify({ fields: { currentShard: { integerValue: "0" } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    };
    const delPostOk = await deletePostFromFirestore({ postId: "p_to_delete", userId: "u1", idToken: "tok" });
    assert.strictEqual(delPostOk, true);

    // updatePostInFirestore - success and permissions
    globalThis.fetch = async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/p_update")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_update" }, userId: { stringValue: "u1" }, description: { stringValue: "Old" } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: "updated" }), { status: 200 });
    };
    const updatedPost = await updatePostInFirestore({ postId: "p_update", userId: "u1", description: "New caption", tags: ["Street"], idToken: "tok" });
    assert.strictEqual(updatedPost.description, "New caption");
    assert.deepStrictEqual(updatedPost.tags, ["Street"]);

    // updatePostInFirestore - not found
    globalThis.fetch = async () => new Response("", { status: 404 });
    await assert.rejects(
      async () => {
        await updatePostInFirestore({ postId: "missing", userId: "u1", description: "x", idToken: "tok" });
      },
      /not found/
    );

    // updatePostInFirestore - permission denied
    globalThis.fetch = async () => new Response(JSON.stringify({ fields: { userId: { stringValue: "someone_else" } } }), { status: 200 });
    await assert.rejects(
      async () => {
        await updatePostInFirestore({ postId: "p_other", userId: "u1", description: "x", idToken: "tok" });
      },
      /Permission denied/
    );

    // fetchPostWithMetadata - success with exif
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/p_meta")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_meta" }, userId: { stringValue: "u1" }, privateMetadataId: { stringValue: "meta_123" } } }), { status: 200 });
      }
      if (urlStr.includes("image-private-metadata/meta_123")) {
        return new Response(JSON.stringify({ fields: { exif: { mapValue: { fields: { Make: { stringValue: "Leica" } } } } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const postWithMeta = await fetchPostWithMetadata({ postId: "p_meta", idToken: "tok" });
    assert(postWithMeta);
    assert.strictEqual(postWithMeta.postId, "p_meta");
    assert.strictEqual(postWithMeta.exif?.Make, "Leica");

    const postNotFoundMeta = await fetchPostWithMetadata({ postId: "p_none", idToken: "tok" });
    assert.strictEqual(postNotFoundMeta, null);

    // resolveUserByUsername
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("usernames/street_photog")) {
        return new Response(JSON.stringify({ fields: { userId: { stringValue: "uid_street" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const resolvedUid = await resolveUserByUsername({ username: "@street_photog", idToken: "tok" });
    assert.strictEqual(resolvedUid, "uid_street");

    const unresolvedUid = await resolveUserByUsername({ username: "unknown_user", idToken: "tok" });
    assert.strictEqual(unresolvedUid, null);

    // likePostInFirestore & unlikePostInFirestore
    globalThis.fetch = async () => new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    const likeOk = await likePostInFirestore({ postId: "p_like", userId: "u1", idToken: "tok" });
    assert.strictEqual(likeOk, true);

    const unlikeOk = await unlikePostInFirestore({ postId: "p_like", userId: "u1", idToken: "tok" });
    assert.strictEqual(unlikeOk, true);

    // fetchPostComments (with threaded replies)
    let commentQueryCall = 0;
    globalThis.fetch = async (url: any, init: any) => {
      commentQueryCall++;
      if (commentQueryCall === 1) {
        return new Response(
          JSON.stringify([
            {
              document: {
                name: "projects/.../comments/c1",
                fields: {
                  text: { stringValue: "Great lighting!" },
                  username: { stringValue: "anna_photo" }
                }
              }
            }
          ]),
          { status: 200 }
        );
      }
      // Second query is replies
      return new Response(
        JSON.stringify([
          {
            document: {
              name: "projects/.../replies/r1",
              fields: {
                text: { stringValue: "Thank you Anna!" },
                parentCommentId: { stringValue: "c1" }
              }
            }
          }
        ]),
        { status: 200 }
      );
    };
    const comments = await fetchPostComments({ postId: "p1", idToken: "tok", includeReplies: true });
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].text, "Great lighting!");
    assert.strictEqual(comments[0].commentId, "c1");
    assert.strictEqual(comments[0].replies?.length, 1);
    assert.strictEqual(comments[0].replies[0].text, "Thank you Anna!");

    // addPostComment (top-level and threaded reply)
    globalThis.fetch = async () => new Response(JSON.stringify({ name: "projects/.../comments/new_c" }), { status: 200 });
    const addedComment = await addPostComment({ postId: "p1", userId: "u1", text: "Inspiring shot!", idToken: "tok" });
    assert.strictEqual(addedComment.text, "Inspiring shot!");
    assert.strictEqual(addedComment.postId, "p1");

    const addedReply = await addPostComment({
      postId: "p1",
      userId: "u1",
      text: "Shot on Portra 400",
      parentCommentId: "c1",
      idToken: "tok"
    });
    assert.strictEqual(addedReply.parentCommentId, "c1");
    assert(addedReply.replyId);

    // deleteCommentFromFirestore (top-level and reply, plus permission errors)
    globalThis.fetch = async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes("comments/c_del") && (!init?.method || init?.method === "GET")) {
        return new Response(JSON.stringify({ fields: { userId: { stringValue: "u1" }, postId: { stringValue: "p1" } } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };
    const delComOk = await deleteCommentFromFirestore({ commentId: "c_del", postId: "p1", userId: "u1", idToken: "tok" });
    assert.strictEqual(delComOk, true);

    const delReplyOk = await deleteCommentFromFirestore({ commentId: "r_del", postId: "p1", userId: "u1", idToken: "tok", isReply: true });
    assert.strictEqual(delReplyOk, true);

    globalThis.fetch = async () => new Response(JSON.stringify({ fields: { userId: { stringValue: "other_user" } } }), { status: 200 });
    await assert.rejects(
      async () => deleteCommentFromFirestore({ commentId: "c_other", postId: "p1", userId: "u1", idToken: "tok" }),
      /Permission denied/
    );

    // fetchPostLikesUsers
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/p_liked")) {
        return new Response(JSON.stringify({ fields: { likes: { arrayValue: { values: [{ stringValue: "u_fan1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_fan1")) {
        return new Response(JSON.stringify({ fields: { username: { stringValue: "fan_one" }, displayName: { stringValue: "Fan One" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const likedUsers = await fetchPostLikesUsers({ postId: "p_liked", idToken: "tok" });
    assert.strictEqual(likedUsers.totalLikes, 1);
    assert.strictEqual(likedUsers.users[0].username, "fan_one");

    await assert.rejects(
      async () => fetchPostLikesUsers({ postId: "p_missing_likes", idToken: "tok" }),
      /not found/
    );

    // fetchUserNotifications
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify([
          {
            document: {
              name: "projects/.../notifications/n1",
              fields: {
                type: { stringValue: "like" },
                senderUsername: { stringValue: "bob" }
              }
            }
          }
        ]),
        { status: 200 }
      );
    };
    const notifs = await fetchUserNotifications({ userId: "u1", idToken: "tok" });
    assert.strictEqual(notifs.length, 1);
    assert.strictEqual(notifs[0].type, "like");

    // fetchHomeFeed
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("user-profiles/u_me")) {
        return new Response(JSON.stringify({ fields: { following: { arrayValue: { values: [{ stringValue: "u_friend" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("user-profiles/u_friend")) {
        return new Response(JSON.stringify({ fields: { postIds: { arrayValue: { values: [{ stringValue: "p_friend_1" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_friend_1")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_friend_1" }, userId: { stringValue: "u_friend" }, description: { stringValue: "Friend's photo" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const feed = await fetchHomeFeed({ userId: "u_me", idToken: "tok" });
    assert.strictEqual(feed.length, 1);
    assert.strictEqual(feed[0].postId, "p_friend_1");

    // fetchHomeFeed with empty following
    globalThis.fetch = async () => new Response(JSON.stringify({ fields: { following: { arrayValue: { values: [] } } } }), { status: 200 });
    const emptyFeed = await fetchHomeFeed({ userId: "u_lonely", idToken: "tok" });
    assert.strictEqual(emptyFeed.length, 0);

    // savePortfolioDocument - success
    globalThis.fetch = async () => new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
    await savePortfolioDocument({
      postId: "port_1",
      userId: "u1",
      title: "Arctic Horizons",
      description: "A series from the far north",
      tags: ["Landscape", "Travel"],
      coverImageId: "img_cover",
      coverAlignmentX: 0.5,
      coverImageUrl: "https://img.jpg/cover",
      coverImagePath: "portfolios/u1/cover",
      coverImageWidth: 1820,
      coverImageHeight: 1200,
      images: [
        {
          id: "img_cover",
          imageUrl: "https://img.jpg/cover",
          imagePath: "portfolios/u1/cover",
          aspectRatio: 1.5,
          fullWidth: 1820,
          fullHeight: 1200,
          caption: "Glacier vista",
          order: 1,
          privateMetadataId: "meta_1"
        }
      ],
      nudityRating: 0.0,
      idToken: "token123"
    });

    // savePortfolioDocument - error
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Permission denied" } }), { status: 403 });
    await assert.rejects(
      async () => {
        await savePortfolioDocument({
          postId: "port_err",
          userId: "u1",
          title: "Fail",
          tags: ["Landscape"],
          coverImageId: "img1",
          coverImageUrl: "https://img.jpg",
          coverImagePath: "p/u1/img1",
          coverImageWidth: 100,
          coverImageHeight: 100,
          images: [],
          nudityRating: 0.0,
          idToken: "token123"
        });
      },
      /Permission denied/
    );

    // fetchUserPortfolios
    globalThis.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("user-profiles/u_port")) {
        return new Response(JSON.stringify({ fields: { postIds: { arrayValue: { values: [{ stringValue: "p_std" }, { stringValue: "p_port" }] } } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_std")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_std" }, type: { stringValue: "post" } } }), { status: 200 });
      }
      if (urlStr.includes("posts/p_port")) {
        return new Response(JSON.stringify({ fields: { postId: { stringValue: "p_port" }, type: { stringValue: "portfolio" }, title: { stringValue: "My Portfolio" } } }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const userPorts = await fetchUserPortfolios({ userId: "u_port", idToken: "tok" });
    assert.strictEqual(userPorts.length, 1);
    assert.strictEqual(userPorts[0].postId, "p_port");

    // fetchUserPortfolios - empty user
    globalThis.fetch = async () => new Response("", { status: 404 });
    const emptyPorts = await fetchUserPortfolios({ userId: "nonexistent", idToken: "tok" });
    assert.strictEqual(emptyPorts.length, 0);

    // updatePortfolioInFirestore & deletePortfolioFromFirestore
    globalThis.fetch = async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes("posts/port_edit") && (!init?.method || init?.method === "GET")) {
        return new Response(
          JSON.stringify({
            fields: {
              postId: { stringValue: "port_edit" },
              userId: { stringValue: "u1" },
              type: { stringValue: "portfolio" },
              title: { stringValue: "Old Title" },
              images: {
                arrayValue: {
                  values: [
                    {
                      mapValue: {
                        fields: {
                          id: { stringValue: "img_1" },
                          imageUrl: { stringValue: "https://img/1.jpg" },
                          imagePath: { stringValue: "p/1" },
                          fullWidth: { integerValue: "1820" },
                          fullHeight: { integerValue: "1200" }
                        }
                      }
                    }
                  ]
                }
              }
            }
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ name: "updated" }), { status: 200 });
    };

    const updatedPort = await updatePortfolioInFirestore({
      postId: "port_edit",
      userId: "u1",
      title: "New Portfolio Title",
      description: "New Desc",
      tags: ["Landscape"],
      coverImageId: "img_1",
      coverAlignmentX: 0.3,
      idToken: "tok"
    });
    assert.strictEqual(updatedPort.title, "New Portfolio Title");
    assert.strictEqual(updatedPort.coverImageId, "img_1");

    const deletedPortOk = await deletePortfolioFromFirestore({
      postId: "port_edit",
      userId: "u1",
      idToken: "tok"
    });
    assert.strictEqual(deletedPortOk, true);

    // updateUserProfileInFirestore
    globalThis.fetch = async () => new Response(JSON.stringify({ fields: { username: { stringValue: "u1" }, bio: { stringValue: "Updated bio" } } }), { status: 200 });
    const updatedUserProf = await updateUserProfileInFirestore({
      userId: "u1",
      displayName: "Sven",
      bio: "Updated bio",
      website: "https://sven.photo",
      profilePhotoUrl: "https://sven.photo/avatar.jpg",
      idToken: "tok"
    });
    assert.strictEqual(updatedUserProf.bio, "Updated bio");

    // reportContentInFirestore
    globalThis.fetch = async () => new Response(JSON.stringify({ name: "reported" }), { status: 200 });
    const repPost = await reportContentInFirestore({
      reporterUserId: "u1",
      targetType: "post",
      targetId: "p_bad",
      reason: "Spam",
      details: "Bot post",
      idToken: "tok"
    });
    assert.strictEqual(repPost.postId, "p_bad");

    const repUser = await reportContentInFirestore({
      reporterUserId: "u1",
      targetType: "user",
      targetId: "u_bad",
      reason: "Impersonation",
      idToken: "tok"
    });
    assert.strictEqual(repUser.reportedUserId, "u_bad");

    // fetchWithRetry (retries on 429, succeeds on 2nd attempt)
    let retryCount = 0;
    globalThis.fetch = async () => {
      retryCount++;
      if (retryCount === 1) {
        return new Response("Too Many Requests", { status: 429 });
      }
      return new Response("OK", { status: 200 });
    };
    const retryRes = await fetchWithRetry("https://example.com/api", { method: "GET" }, { maxRetries: 2, baseDelayMs: 10 });
    assert.strictEqual(retryRes.status, 200);
    assert.strictEqual(retryCount, 2);

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("  ✓ Firestore unit tests passed");
}

