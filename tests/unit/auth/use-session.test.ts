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
    signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
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

  describe("signInWithPassword (ADR-0068)", () => {
    it("calls supabase.auth.signInWithPassword and returns ok on success", async () => {
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.signInWithPassword(
          "you@example.com",
          "supersecret",
        );
      });
      expect(outcome?.ok).toBe(true);
      expect(mockClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "you@example.com",
        password: "supersecret",
      });
    });

    it("rewrites Supabase's terse 'Invalid login credentials' into a clearer message", async () => {
      mockClient.auth.signInWithPassword.mockResolvedValue({
        error: { message: "Invalid login credentials" },
      });
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.signInWithPassword(
          "you@example.com",
          "wrong",
        );
      });
      expect(outcome?.ok).toBe(false);
      expect(outcome?.error).toBe("Email or password is incorrect");
    });

    it("forwards other Supabase errors verbatim", async () => {
      mockClient.auth.signInWithPassword.mockResolvedValue({
        error: { message: "Email rate limit exceeded" },
      });
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.signInWithPassword(
          "you@example.com",
          "x",
        );
      });
      expect(outcome?.ok).toBe(false);
      expect(outcome?.error).toBe("Email rate limit exceeded");
    });

    it("rejects empty email locally without hitting Supabase", async () => {
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.signInWithPassword("   ", "secret");
      });
      expect(outcome?.ok).toBe(false);
      expect(mockClient.auth.signInWithPassword).not.toHaveBeenCalled();
    });

    it("rejects empty password locally without hitting Supabase", async () => {
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.signInWithPassword(
          "you@example.com",
          "",
        );
      });
      expect(outcome?.ok).toBe(false);
      expect(mockClient.auth.signInWithPassword).not.toHaveBeenCalled();
    });
  });

  describe("setPassword (ADR-0068)", () => {
    it("calls supabase.auth.updateUser with the new password", async () => {
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.setPassword("brand-new-pass-123");
      });
      expect(outcome?.ok).toBe(true);
      expect(mockClient.auth.updateUser).toHaveBeenCalledWith({
        password: "brand-new-pass-123",
      });
    });

    it("rejects passwords shorter than 8 chars locally without hitting Supabase", async () => {
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.setPassword("short");
      });
      expect(outcome?.ok).toBe(false);
      expect(outcome?.error).toContain("at least 8");
      expect(mockClient.auth.updateUser).not.toHaveBeenCalled();
    });

    it("returns Supabase error verbatim when updateUser fails", async () => {
      mockClient.auth.updateUser.mockResolvedValue({
        error: {
          message: "New password should be different from the old password.",
        },
      });
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.setPassword("the-same-old-pass");
      });
      expect(outcome?.ok).toBe(false);
      expect(outcome?.error).toBe(
        "New password should be different from the old password.",
      );
    });
  });

  describe("requestPasswordReset (ADR-0068)", () => {
    it("calls supabase.auth.resetPasswordForEmail with a /reset-password redirect", async () => {
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.requestPasswordReset(
          "you@example.com",
        );
      });
      expect(outcome?.ok).toBe(true);
      expect(mockClient.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        "you@example.com",
        expect.objectContaining({
          redirectTo: expect.stringContaining("/reset-password"),
        }),
      );
    });

    it("rejects empty email locally without hitting Supabase", async () => {
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.requestPasswordReset("   ");
      });
      expect(outcome?.ok).toBe(false);
      expect(mockClient.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("returns Supabase rate-limit error verbatim", async () => {
      mockClient.auth.resetPasswordForEmail.mockResolvedValue({
        error: { message: "Email rate limit exceeded" },
      });
      const { result } = renderHook(() => useSession());
      await waitFor(() => expect(result.current.status).toBe("anonymous"));
      let outcome: { ok: boolean; error?: string } | undefined;
      await act(async () => {
        outcome = await result.current.requestPasswordReset(
          "you@example.com",
        );
      });
      expect(outcome?.ok).toBe(false);
      expect(outcome?.error).toBe("Email rate limit exceeded");
    });
  });
});
