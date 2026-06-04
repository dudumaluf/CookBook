import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  setPassword: vi.fn<
    (newPassword: string) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
  signOut: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/lib/auth/use-session", () => ({
  useSession: () => ({
    status: "authenticated" as const,
    user: { id: "u1", email: "me@example.com" },
    session: null,
    signInWithMagicLink: vi.fn(async () => ({ ok: true })),
    signInWithPassword: vi.fn(async () => ({ ok: true })),
    requestPasswordReset: vi.fn(async () => ({ ok: true })),
    setPassword: mocks.setPassword,
    signOut: mocks.signOut,
  }),
}));

const { AccountSettingsDialog } = await import(
  "@/components/settings/account-settings-dialog"
);

beforeEach(() => {
  mocks.setPassword.mockClear();
  mocks.signOut.mockClear();
  mocks.toastSuccess.mockClear();
  mocks.setPassword.mockImplementation(async () => ({ ok: true }));
});

afterEach(() => cleanup());

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <AccountSettingsDialog open={true} onOpenChange={onOpenChange} />,
  );
  return { onOpenChange };
}

describe("<AccountSettingsDialog />", () => {
  it("shows the signed-in email in the description", () => {
    renderDialog();
    expect(
      screen.getByTestId("account-settings-dialog"),
    ).toHaveTextContent("me@example.com");
  });

  it("renders the password form fields and the Save button", () => {
    renderDialog();
    expect(screen.getByTestId("account-password")).toBeInTheDocument();
    expect(
      screen.getByTestId("account-password-confirm"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("account-set-password")).toBeInTheDocument();
  });

  it("rejects mismatched passwords without calling setPassword", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("account-password"), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByTestId("account-password-confirm"), {
      target: { value: "different" },
    });
    fireEvent.click(screen.getByTestId("account-set-password"));
    await waitFor(() => {
      expect(screen.getByTestId("account-error")).toHaveTextContent(
        /don't match/i,
      );
    });
    expect(mocks.setPassword).not.toHaveBeenCalled();
  });

  it("calls setPassword on submit, toasts, and closes the dialog on success", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByTestId("account-password"), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByTestId("account-password-confirm"), {
      target: { value: "newpassword1" },
    });
    fireEvent.click(screen.getByTestId("account-set-password"));
    await waitFor(() => {
      expect(mocks.setPassword).toHaveBeenCalledWith("newpassword1");
    });
    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Password updated");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders an inline error and keeps dialog open when setPassword fails", async () => {
    mocks.setPassword.mockResolvedValueOnce({
      ok: false,
      error: "Password must be at least 8 characters",
    });
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByTestId("account-password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByTestId("account-password-confirm"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByTestId("account-set-password"));
    await waitFor(() => {
      expect(screen.getByTestId("account-error")).toHaveTextContent(
        /at least 8/i,
      );
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("'Sign out' calls signOut", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("account-signout"));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("Save button is disabled when fields are empty", () => {
    renderDialog();
    expect(screen.getByTestId("account-set-password")).toBeDisabled();
  });
});
