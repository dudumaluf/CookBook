import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

import { _setRequireUserOverrideForTests } from "@/lib/auth/test-override";

// Slice 7.7 — `requireUser` now gates every API route. Existing route
// tests pre-date this gate and don't fabricate a Supabase session.
// Globally short-circuit `requireUser` to a synthetic user so route
// tests focus on the route's logic, not the auth scaffolding. Tests
// that specifically want to assert 401 behaviour can flip the
// override back to `null` inside their own `beforeEach`/`it`.
beforeEach(() => {
  _setRequireUserOverrideForTests({
    userId: "00000000-0000-0000-0000-000000000001",
    accessToken: "test-access-token",
  });
});

// JSDOM (as of 24.x) does not implement Element.getAnimations(). The
// @base-ui/react ScrollArea viewport calls it on a recurring timer to
// detect scroll animations; the missing function surfaces as an
// unhandled "TypeError: viewport.getAnimations is not a function" once
// the test unmounts the tree but the timer is still queued. Polyfill
// it as a no-op so the timer is harmless. Returning [] matches the
// spec for "no Animation objects associated with the element".
if (typeof Element !== "undefined" && !("getAnimations" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "getAnimations", {
    value: () => [] as Animation[],
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
});
