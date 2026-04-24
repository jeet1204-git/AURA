# AURA Launch Risk Review (500 Concurrent Users)

This list focuses on **critical bugs/failure modes likely at launch** with ~500 simultaneous active users, based on the current web client and Supabase data-layer code.

## 1) Client-side-only paywall enforcement can be bypassed
- Session gating uses mutable browser state (`window.userProfile`) in `checkPaywallGate()`.
- An attacker can modify client state or call worker endpoints directly, bypassing free-tier limits.
- Evidence: `src/modules/session.js` (paywall gate + reliance on `window.userProfile`).

## 2) Session start does not send Authorization header to `/token`
- `/token` calls send `idToken` in JSON body, not a Bearer header.
- If worker-side validation is inconsistent, this can allow spoofed starts or weaker auth handling.
- Evidence: `src/modules/session.js` and `src/modules/session-bridge.js` (`fetch(.../token)` request headers).

## 3) Per-utterance `/eval` fan-out can overload backend under concurrency
- Each finalized utterance triggers a separate `/eval` POST.
- With 500 users speaking continuously, request volume spikes quickly and can saturate worker/DB.
- Evidence: `fireUtteranceEval()` in `src/modules/session-bridge.js`.

## 4) `/eval` failure is treated as non-fatal (silent learning-data loss)
- Failed eval requests only log warnings and continue.
- This creates hidden drift between what users did and what analytics/memory store.
- Evidence: `src/modules/session-bridge.js` (`/eval failed (non-fatal)`).

## 5) `/consolidate` failure is non-fatal (session outcomes may never persist)
- End-of-session consolidation logs warning and proceeds.
- User sees session end, but memory/xp/progress updates can be missing.
- Evidence: `fireConsolidate()` in `src/modules/session-bridge.js`.

## 6) Race condition risk in profile activation flow
- `createProfile()` inserts profile, then separately checks/updates `users.active_profile_id`.
- Concurrent profile creations can leave wrong active profile due to non-transactional sequence.
- Evidence: `createProfile()` in `src/modules/firestore.js`.

## 7) One-time initialization guard can lock dashboard into partial state
- `_initialized` is set before `onUserReady()` fully completes.
- If `onUserReady()` fails midway (network/intermittent Supabase errors), initialization is not retried.
- Evidence: auth bootstrap + `_initialized` logic in `src/modules/ui.js`.

## 8) Long-lived intervals without teardown can degrade performance
- UI sets recurring timers (`setInterval`) for pollers/animations and never clears them.
- Over long sessions/tabs, this increases CPU usage and contributes to degraded UX at scale.
- Evidence: `src/modules/ui.js` (state poller, accuracy refresh, waveform interval).

## 9) Hardcoded production service endpoints increase blast radius
- Worker and Supabase endpoints are hardcoded constants.
- No environment-based failover means outages or migration changes become full app failures.
- Evidence: `src/config/constants.js`.

## 10) Broad error swallowing in data layer hides production incidents
- Multiple critical data operations catch and suppress errors (console warning only).
- At launch traffic, this causes silent data inconsistency and delays incident detection.
- Evidence: `loadUserProfile`, `ensureUserDoc`, `loadProfiles`, `createProfile`, etc. in `src/modules/firestore.js`.

---

## Priority mitigation plan (launch-week)
1. Enforce worker-side auth on all endpoints (`/token`, `/eval`, `/consolidate`) using validated Bearer token.
2. Add rate limits + burst controls per user and per IP for speaking endpoints.
3. Introduce queueing/batching/backoff for per-utterance eval writes.
4. Make end-session consolidate durable (retry + idempotency key + user-visible failure state).
5. Convert multi-step profile/session writes to transactional/atomic server-side logic.
6. Replace silent catches with structured telemetry + alerting.
7. Move endpoint config to environment variables with health-check-based failover.
