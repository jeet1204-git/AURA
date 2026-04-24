# AURA Launch Risk Review (500 Concurrent Users)

This report lists the top 10 critical bugs/failure modes that can occur at launch time under ~500 concurrent users.

## 1) Unauthorized write access to `/eval`
- `POST /eval` does not verify an auth token before writing user/session data.
- Attackers can forge `userId` + `sessionId`, pollute analytics, and trigger DB writes/cost.
- Evidence: `handleEval` accepts body fields and calls `errorAgent` directly; no `Authorization` or token verification path is present.

## 2) Unauthorized write access to `/consolidate`
- `POST /consolidate` also has no auth verification.
- Anyone can close/overwrite session outcomes if they know or guess IDs.
- Evidence: `handleConsolidate` validates only body fields and immediately executes `consolidationAgent`.

## 3) IDOR/data tampering via trust of client-supplied `userId`
- Both `/eval` and `/consolidate` trust `userId` from request body instead of deriving user from a verified token.
- This is an insecure direct object reference issue with cross-user data impact.

## 4) Client-only paywall enforcement (easy bypass)
- Session gating is enforced in browser code (`checkPaywallGate`) using mutable client state (`window.userProfile`).
- A user can bypass by modifying front-end state or direct API calls.
- Worker `/token` does not enforce monthly quota.

## 5) Inconsistent free-session limits across modules
- `FREE_SESSION_LIMIT` is `2` in app constants but Firestore access check uses `3`.
- Causes inconsistent behavior (UI blocks vs backend-checked flows), user confusion, and support escalations.

## 6) Session row is created before Gemini token is confirmed
- `/token` creates `aura_sessions` row before Gemini token request completes.
- If Gemini fails, you can leave orphan/open sessions (`ended_at` null) and inflate “active session” logic under load.

## 7) Session creation failure is non-fatal (silent inconsistency)
- `createSessionRow` logs on failure but does not fail the request.
- Worker can still return a valid token/sessionId while DB has no session row, causing later `/eval` and `/consolidate` inconsistencies.

## 8) Race condition when starting concurrent sessions for same user
- `/token` first queries active session, then PATCHes it, then inserts a new session in separate calls.
- Two near-simultaneous starts can both observe no active row and both create sessions.
- High likelihood with retries/double-click/network jitter at scale.

## 9) Hot-path write amplification in `/eval`
- For every utterance, worker writes `session_utterances`, possibly reads+patches/inserts `error_log` per correction, and updates `student_progress`.
- This is multiple DB round-trips per utterance and scales poorly with 500 concurrent speakers.

## 10) No rate limiting or abuse throttling on high-cost endpoints
- `/token`, `/eval`, `/consolidate` have no explicit per-user/IP throttling.
- A few abusive clients can starve capacity and spike third-party API/DB costs during launch traffic.

## Recommended immediate fixes (priority order)
1. Require Bearer auth for `/eval` and `/consolidate`; derive `userId` server-side only.
2. Enforce paywall/session quota in worker `/token` using authoritative DB counters.
3. Wrap session open/close in transactional or conflict-safe DB logic.
4. Fail fast if `createSessionRow` fails.
5. Add rate limits (per IP and per user), request budgets, and circuit breakers.
6. Batch or queue eval writes; reduce per-utterance synchronous DB round-trips.
