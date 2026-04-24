# AURA Security Audit (Client Repo) — April 24, 2026

> Scope: static review of this frontend repository (`/workspace/AURA`).
> Important: this repo does **not** include the Cloudflare Worker/payment backend implementation, so server-side guarantees are listed as required controls, not verified controls.

## Executive summary

- I found and prioritized vulnerabilities/abuse paths across auth, paywall, session, XSS, and operational hardening.
- Several high-risk client findings have been fixed in this branch (see **Fixed now** section).
- Full “cannot be bypassed” protection is only achievable with backend enforcement (token verification, authorization, quotas, billing checks, rate limiting, anti-fraud).

---

## Fixed now (this branch)

1. **XSS hardening in landing hero chat rendering**
   - Replaced unsafe `innerHTML` message injection with DOM nodes + `textContent`.
2. **XSS hardening in onboarding summary card**
   - Added escaping before interpolating user-provided values (`nativeLanguage`, goal text, etc.) into summary HTML.
3. **Mock test token flow auth hardening**
   - Added Bearer `Authorization` headers to `/token` requests in mock-test flows.
4. **Mock test paywall consistency**
   - Added authoritative `checkSessionAccess()` check before live mock test start.
5. **Mock test content injection hardening**
   - Escaped dynamic card/calendar fields rendered with `innerHTML`.

---

## Remaining findings and required controls

## Critical

### C1) Backend must be final authority for authz and billing
- Risk: any client checks (`window` state, UI guards) can be bypassed by direct HTTP requests.
- Required control: in worker, derive `userId` from verified Bearer token only; never trust client-supplied identifiers.

### C2) Payment/paywall bypass via multi-account farming
- Risk: users can create many accounts to avoid payment.
- Required control: combine payment state with anti-abuse signals (email verification, velocity limits, device/IP heuristics, risk scoring, optional phone/3DS/KYC for repeated abuse).

### C3) Missing enforced rate limits (backend)
- Risk: high-cost endpoints can be abused for denial-of-wallet and service degradation.
- Required control: per-IP + per-user + per-session quotas and burst limits on `/token`, `/eval`, `/consolidate`, `/memory`.

## High

### H1) Third-party model calls from browser should be brokered by backend
- Risk: client-orchestrated model access can be replayed/spammed and is harder to govern/cost-control.
- Required control: route all model calls through backend policy and budget guardrails.

### H2) Lack of explicit idempotency/transaction guarantees (backend)
- Risk: retries/double-submits may duplicate writes or create inconsistent state.
- Required control: idempotency keys + transactional writes for session open/close/eval consolidation.

### H3) Insufficient security headers/CSP in served pages
- Risk: XSS blast radius and clickjacking risk increase without strong browser policies.
- Required control: strict CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, `HSTS`.

## Medium

### M1) Broad `window.*` function exposure increases tampering surface
- Risk: attackers can invoke/sequence internal functions via DevTools.
- Mitigation: keep sensitive logic server-side, reduce exposed globals where possible.

### M2) Silent/non-fatal error swallowing can hide attacks/incidents
- Risk: abuse and data-loss patterns remain undetected.
- Mitigation: structured telemetry, alerting, trace IDs, and user-visible retry states.

### M3) Endpoint hardcoding resilience
- Status: improved in this branch via runtime/env overrides.
- Next step: pair with health checks, staged failover, and config validation at boot.

## Low

### L1) Client local storage values are user-controlled
- Risk: any logic tied to local storage is manipulable.
- Mitigation: treat local storage as cosmetic only; enforce policy server-side.

---

## What “very very secure” looks like (must-have backend checklist)

1. Verify JWT on every protected endpoint and bind all writes to token subject.
2. Enforce paid/free entitlement and quota server-side only.
3. Add layered rate limiting and anomaly detection.
4. Use idempotency keys and transactional persistence for session lifecycle.
5. Add anti-fraud controls for account farming and payment abuse.
6. Centralize model/provider calls behind backend budgets and allow-lists.
7. Implement security headers/CSP and continuous vulnerability scanning.
8. Add security monitoring: SIEM alerts for abuse spikes, auth failures, and cost anomalies.

