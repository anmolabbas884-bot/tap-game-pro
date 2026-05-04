# Security Specification - Tap Game Pro

## Data Invariants
1. A leaderboard entry must have a valid `userId` matching the authenticated user.
2. The `score` must be a positive integer.
3. The `difficulty` must be one of 'EASY', 'MEDIUM', 'HARD'.
4. `playerName` must be a string between 2 and 20 characters.
5. Documents are immutable once created (leaderboards are append-only usually, or we can allow updates if the user wants to update their own score, but for simplicity let's do append-only or specific score updates). Actually, let's allow users to update their own entries if needed, but typically standard leaderboards are "submit and done". We'll allow `create` only for users, and `read` for everyone.

## The Dirty Dozen (Test Payloads)
1. **Unauthorized Create**: An unauthenticated user tries to post a score. (Should be DENIED)
2. **Identity Spoofing**: User A tries to post a score for User B. (Should be DENIED)
3. **Invalid Score Type**: Posting a string as a score. (Should be DENIED)
4. **Negative Score**: Posting a score of -100. (Should be DENIED)
5. **Enormous Score**: Posting a score of 999,999,999. (Should be DENIED - though games can have high scores, let's cap at something reasonable like 10,000 for this game).
6. **ID Poisoning**: Using a 1KB string as entry ID. (Should be DENIED)
7. **Bypassing Player Name**: Empty player name. (Should be DENIED)
8. **Malicious Difficulty**: Difficulty = 'GOD_MODE'. (Should be DENIED)
9. **Timestamp Spoofing**: Providing a manual `createdAt` instead of `request.time`. (Should be DENIED)
10. **Unauthorized Update**: User B tries to change User A's score. (Should be DENIED)
11. **Shadow Fields**: Adding an `isAdmin: true` field. (Should be DENIED)
12. **Blanket List Read**: Trying to query without limits (though we might allow reading Top 100). (Actually we strictly enforce Top 5 query in the rules if possible, but standard is evaluating `resource.data`).

## Security Rules (Draft)
- `allow read`: if true (Public leaderboard).
- `allow create`: if authenticated and isValidEntry(incoming()) and incoming().userId == request.auth.uid.
- `allow update, delete`: if false (Entries are immutable).
