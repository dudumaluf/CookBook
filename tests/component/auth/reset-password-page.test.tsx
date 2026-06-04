import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  setPassword: vi.fn<
    (newPassword: string) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
  signOut: vi.fn(async () => undefined),
  signInWithMagicLink: vi.fn(async () => ({ ok: true })),
  signInWithPassword: vi.fn(async () => ({ ok: true })),
  requestPasswordReset: vi.fn(async () => ({ ok: true })),
  status: "authenticated" as "loading" | "anonymous" | "authenticated",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

vi.mock("@/lib/auth/use-session", () => ({
  useSession: () => ({
    status: mocks.status,
    user:
      mocks.status === "authenticated"
        ? { id: "u1", email: "me@example.com" }
        : null,
    session: null,
    signInWithMagicLink: mocks.signInWithMagicLink,
    signInWithPassword: mocks.signInWithPassword,
    requestPasswordReset: mocks.requestPasswordReset,
    setPassword: mocks.setPassword,
    signOut: mocks.signOut,
  }),
}));

const { default: ResetPasswordPage } = await import(
  "@/app/reset-password/page"
);

beforeEach(() => {
  mocks.setPassword.mockClear();
  mocks.replace.mockClear();
  mocks.setPassword.mockImplementation(async () => ({ ok: true }));
  mocks.status = "authenticated";
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("<ResetPasswordPage />", () => {
  it("renders a loader while session probe is in flight", () => {
    mocks.status = "loading";
    render(<ResetPasswordPage />);
    expect(screen.getByTestId("reset-loading")).toBeInTheDocument();
  });

  it("renders an expired-link CTA when no recovery session is present", () => {
    mocks.status = "anonymous";
    render(<ResetPasswordPage />);
    expect(screen.getByTestId("reset-expired")).toBeInTheDocument();
  });

  it("renders the new-password form when authenticated via recovery", () => {
    render(<ResetPasswordPage />);
    expect(screen.getByTestId("reset-password")).toBeInTheDocument();
    expect(screen.getByTestId("reset-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("reset-submit")).toBeInTheDocument();
  });

  it("rejects mismatched passwords without calling setPassword", async () => {
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByTestId("reset-password"), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByTestId("reset-confirm"), {
      target: { value: "newpassword2" },
    });
    fireEvent.click(screen.getByTestId("reset-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("reset-error")).toHaveTextContent(
        /don't match/i,
      );
    });
    expect(mocks.setPassword).not.toHaveBeenCalled();
  });

  it("calls setPassword and redirects on success", async () => {
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByTestId("reset-password"), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByTestId("reset-confirm"), {
      target: { value: "newpassword1" },
    });
    fireEvent.click(screen.getByTestId("reset-submit"));
    await waitFor(() => {
      expect(mocks.setPassword).toHaveBeenCalledWith("newpassword1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("reset-done")).toBeInTheDocument();
    });
    vi.advanceTimersByTime(1500);
    expect(mocks.replace).toHaveBeenCalledWith("/projetos");
  });

  it("renders an inline error when setPassword fails", async () => {
    mocks.setPassword.mockResolvedValueOnce({
      ok: false,
      error: "Password too short",
    });
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByTestId("reset-password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByTestId("reset-confirm"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByTestId("reset-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("reset-error")).toHaveTextContent(
        /password too short/i,
      );
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
