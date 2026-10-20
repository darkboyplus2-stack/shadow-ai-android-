# Firestore Security Specification: SHADOW AI Long-Term Memory

## 1. Data Invariants

1. **User Subcollection Isolation**: Every user resource (`memories`, `chats`, `settings`) lives exclusively under `/users/{userId}/`. Access to a resource requires `request.auth != null && request.auth.uid == userId`.
2. **Verified Auth Identity**: Standard cloud persistence writes require `request.auth.uid != null`.
3. **Owner Field Integrity**: The `userId` field inside any written document must strictly equal `request.auth.uid` and path variable `userId`. Once created, `userId` cannot be modified.
4. **Id Shape & Size Protection**: Document IDs and ID path variables must conform to `^[a-zA-Z0-9_\-]+$` and have length `<= 128`.
5. **Memory Entity Schema Bounds**:
   - `content` must be string, size between 1 and 1000 characters.
   - `category` must be one of `['preference', 'project', 'instruction', 'constraint', 'fact']`.
   - `provenance` must be one of `['explicit_user', 'implicit_inference']`.
   - `tags` must be a list with size `<= 20`.
6. **Chat Entity Bounds**:
   - `title` must be string, size `<= 200`.
   - `messages` must be a list with size `<= 500`.
7. **Settings Entity Bounds**:
   - `autoMemoryEnabled` must be boolean.
   - Key counts and allowed keys are strictly guarded.

---

## 2. The "Dirty Dozen" Threat Payloads

1. **Cross-User Snooping**: User B reads `/users/user_A/memories/mem_1`. Expected: `PERMISSION_DENIED`.
2. **Unauthenticated Read**: Anonymous/unauthenticated client queries `/users/user_A/memories`. Expected: `PERMISSION_DENIED`.
3. **Identity Spoofing**: User A writes a memory into `/users/user_A/memories/mem_1` with payload `{ userId: "user_B" }`. Expected: `PERMISSION_DENIED`.
4. **ID Injection / Path Poisoning**: User A attempts to write a document with a 2KB garbage document ID `mem_$$$###...`. Expected: `PERMISSION_DENIED`.
5. **Unbounded Content DOS (Denial of Wallet)**: User A attempts to save a 5MB string in `content`. Expected: `PERMISSION_DENIED`.
6. **Invalid Category Tamper**: User A writes memory with `category: "super_admin_backdoor"`. Expected: `PERMISSION_DENIED`.
7. **Unbounded Tags Injection**: User A writes memory with an array of 5,000 tags. Expected: `PERMISSION_DENIED`.
8. **Owner Immutability Violation**: User A updates existing memory and attempts to alter `userId` to another user. Expected: `PERMISSION_DENIED`.
9. **Ghost Key Injection**: User A inserts a ghost field `{ isAdmin: true }` into `UserSettings`. Expected: `PERMISSION_DENIED`.
10. **Cross-User Chat Insertion**: User B attempts to push a chat session into `/users/user_A/chats/chat_1`. Expected: `PERMISSION_DENIED`.
11. **Blanket Query Scraping**: User attempts `getDocs(collectionGroup('memories'))`. Expected: `PERMISSION_DENIED`.
12. **Root Document Overwrite**: User attempts to write directly to `/users/{userId}` or `/system`. Expected: `PERMISSION_DENIED`.
