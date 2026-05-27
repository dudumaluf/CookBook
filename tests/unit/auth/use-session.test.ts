import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// `useSession` reads the singleton client from `@/lib/supabase/client`.
// Stub the entire module so each test owns its own auth surface.
type AuthChangeListener = (event: string, session: unknown) => void;

function makeMockClient() {
  let listener: AuthChangeListener | null = null;
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn((cb: AuthChangeListener) => {
      listener = cb;
      return {
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      };
    }),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    auth,
    fireAuthChange: (event: string, session: unknown) => {
      if (listener) listener(event, session);
    },
  };
}

let mockClient: ReturnType<typeof makeMockClient>;

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: () => mockClient,
  isSupabaseConfigured: () => true,
  _resetSupabaseClientForTests: () => {},
  getAssetsBucket: () => "cookbook-assets",
}));

const { useSession } = await import("@/lib/auth/use-session");

beforeEach(() => {
  mockClient = makeMockClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSession", () => {
  it("starts in `loading` then settles to `anonymous` when no session", async () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.status).toBe("loading");
    await waitFor(() => {
      expect(result.current.status).toBe("anonymous");
    });
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it("settles to `authenticated` when getSession returns a session", async () => {
    const fakeSession = {
      access_token: "tok",
      user: { id: "user-1", email: "me@example.com" },
    };
    mockClient.auth.getSession.mockResolvedValue({ data: { session: fakeSession } });
    const { result } = renderHook(() => useSession());
    await waitFor(() => {
      expect(result.current.status).toBe("authenticated");
    });
    expect(result.current.user?.id).toBe("user-1");
    expect(result.current.session).toBe(fakeSession);
  });

  it("flips to `authenticated` when onAuthStateChange fires SIGNED_IN", async () => {
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    act(() => {
      mockClient.fireAuthChange("SIGNED_IN", {
        access_token: "tok",
        user: { id: "user-2", email: "you@example.com" },
      });
    });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.user?.id).toBe("user-2");
  });

  it("flips to `anonymous` when onAuthStateChange fires SIGNED_OUT", async () => {
    mockClient.auth.getSession.mockResolvedValue({
      data: {
        session: { access_token: "tok", user: { id: "user-1", email: "x" } },
      },
    });
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    act(() => {
      mockClient.fireAuthChange("SIGNED_OUT", null);
    });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(result.current.user).toBeNull();
  });

  it("signInWithMagicLink calls signInWithOtp and returns ok on success", async () => {
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.signInWithMagicLink("you@example.com");
    });
    expect(outcome?.ok).toBe(true);
    expect(mockClient.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "you@example.com",
      options: expect.any(Object),
    });
  });

  it("signInWithMagicLink returns error message when Supabase returns an error", async () => {
    mockClient.auth.signInWithOtp.mockResolvedValue({
      error: { message: "Rate limit exceeded" },
    });
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.signInWithMagicLink("you@example.com");
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toBe("Rate limit exceeded");
  });

  it("signInWithMagicLink rejects empty email locally (no API call)", async () => {
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.signInWithMagicLink("   ");
    });
    expect(outcome?.ok).toBe(false);
    expect(mockClient.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("signOut calls supabase.auth.signOut", async () => {
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    await act(async () => {
      await result.current.signOut();
    });
    expect(mockClient.auth.signOut).toHaveBeenCalledTimes(1);
  });
});
