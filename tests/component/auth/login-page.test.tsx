import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  signInWithMagicLink: vi.fn<
    (email: string) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
  signInWithPassword: vi.fn<
    (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
  requestPasswordReset: vi.fn<
    (email: string) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
  signOut: vi.fn(async () => undefined),
  setPassword: vi.fn<
    (newPassword: string) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
}));

vi.mock("@/lib/auth/use-session", () => ({
  useSession: () => ({
    status: "anonymous" as const,
    user: null,
    session: null,
    signInWithMagicLink: mocks.signInWithMagicLink,
    signInWithPassword: mocks.signInWithPassword,
    requestPasswordReset: mocks.requestPasswordReset,
    setPassword: mocks.setPassword,
    signOut: mocks.signOut,
  }),
}));

const { default: LoginPage } = await import("@/app/login/page");

beforeEach(() => {
  mocks.signInWithMagicLink.mockClear();
  mocks.signInWithPassword.mockClear();
  mocks.requestPasswordReset.mockClear();
  mocks.signInWithMagicLink.mockImplementation(async () => ({ ok: true }));
  mocks.signInWithPassword.mockImplementation(async () => ({ ok: true }));
  mocks.requestPasswordReset.mockImplementation(async () => ({ ok: true }));
});

afterEach(() => cleanup());

describe("<LoginPage /> — magic mode (default)", () => {
  it("renders the magic-link form by default", () => {
    render(<LoginPage />);
    expect(screen.getByTestId("login-submit")).toHaveTextContent(
      /send magic link/i,
    );
    expect(screen.getByTestId("login-mode-password")).toHaveTextContent(
      /use password instead/i,
    );
    expect(screen.queryByTestId("login-password")).not.toBeInTheDocument();
  });

  it("submitting the magic form calls signInWithMagicLink and shows the sent state", async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "you@example.com" },
    });
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("login-sent")).toBeInTheDocument();
    });
    expect(mocks.signInWithMagicLink).toHaveBeenCalledWith("you@example.com");
  });

  it("renders error message when magic link send fails", async () => {
    mocks.signInWithMagicLink.mockResolvedValueOnce({
      ok: false,
      error: "Rate limit exceeded",
    });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "you@example.com" },
    });
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("login-error")).toHaveTextContent(
        /rate limit/i,
      );
    });
    expect(screen.queryByTestId("login-sent")).not.toBeInTheDocument();
  });
});

describe("<LoginPage /> — password mode", () => {
  it("flips to the password form when 'Use password instead' is clicked", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByTestId("login-mode-password"));
    expect(screen.getByTestId("login-password")).toBeInTheDocument();
    expect(screen.getByTestId("login-submit-password")).toHaveTextContent(
      /sign in/i,
    );
  });

  it("submits email + password via signInWithPassword", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByTestId("login-mode-password"));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "me@example.com" },
    });
    fireEvent.change(screen.getByTestId("login-password"), {
      target: { value: "supersecret" },
    });
    fireEvent.click(screen.getByTestId("login-submit-password"));
    await waitFor(() => {
      expect(mocks.signInWithPassword).toHaveBeenCalledWith(
        "me@example.com",
        "supersecret",
      );
    });
  });

  it("renders an inline error when password sign-in fails", async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({
      ok: false,
      error: "Email or password is incorrect",
    });
    render(<LoginPage />);
    fireEvent.click(screen.getByTestId("login-mode-password"));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "me@example.com" },
    });
    fireEvent.change(screen.getByTestId("login-password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByTestId("login-submit-password"));
    await waitFor(() => {
      expect(screen.getByTestId("login-error")).toHaveTextContent(
        /password is incorrect/i,
      );
    });
  });

  it("disables the submit button while sending", async () => {
    let resolve: ((v: { ok: boolean }) => void) | undefined;
    mocks.signInWithPassword.mockImplementationOnce(
      () => new Promise((r) => { resolve = r; }),
    );
    render(<LoginPage />);
    fireEvent.click(screen.getByTestId("login-mode-password"));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "me@example.com" },
    });
    fireEvent.change(screen.getByTestId("login-password"), {
      target: { value: "secret-1" },
    });
    fireEvent.click(screen.getByTestId("login-submit-password"));
    await waitFor(() => {
      expect(screen.getByTestId("login-submit-password")).toBeDisabled();
    });
    resolve?.({ ok: true });
  });

  it("flips back to magic mode via the 'Use magic link instead' link", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByTestId("login-mode-password"));
    fireEvent.click(screen.getByTestId("login-mode-magic"));
    expect(screen.queryByTestId("login-password")).not.toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toHaveTextContent(
      /send magic link/i,
    );
  });
});

describe("<LoginPage /> — reset mode", () => {
  it("opens the reset form when 'Forgot password?' is clicked", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByTestId("login-mode-password"));
    fireEvent.click(screen.getByTestId("login-mode-reset"));
    expect(screen.getByTestId("login-submit-reset")).toHaveTextContent(
      /send reset email/i,
    );
    expect(screen.queryByTestId("login-password")).not.toBeInTheDocument();
  });

  it("submitting the reset form calls requestPasswordReset and shows confirmation", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByTestId("login-mode-password"));
    fireEvent.click(screen.getByTestId("login-mode-reset"));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "me@example.com" },
    });
    fireEvent.click(screen.getByTestId("login-submit-reset"));
    await waitFor(() => {
      expect(screen.getByTestId("login-reset-sent")).toBeInTheDocument();
    });
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith("me@example.com");
  });

  it("'Back to sign in' returns to password mode", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByTestId("login-mode-password"));
    fireEvent.click(screen.getByTestId("login-mode-reset"));
    fireEvent.click(screen.getByTestId("login-mode-password-back"));
    expect(screen.getByTestId("login-password")).toBeInTheDocument();
  });

  it("preserves the typed email when toggling between modes", () => {
    render(<LoginPage />);
    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    fireEvent.change(email, { target: { value: "persisted@example.com" } });
    fireEvent.click(screen.getByTestId("login-mode-password"));
    expect(
      (screen.getByLabelText(/email/i) as HTMLInputElement).value,
    ).toBe("persisted@example.com");
    fireEvent.click(screen.getByTestId("login-mode-reset"));
    expect(
      (screen.getByLabelText(/email/i) as HTMLInputElement).value,
    ).toBe("persisted@example.com");
  });
});
