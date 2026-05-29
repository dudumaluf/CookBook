import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectRecord } from "@/lib/repositories/project-repository";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...props} alt="logo" />,
}));

vi.mock("@/lib/auth/use-session", () => ({
  useSession: () => ({
    user: { id: "u1", email: "me@example.com" },
    signOut: vi.fn(),
  }),
}));

const repo = {
  list: vi.fn(),
  save: vi.fn(),
  duplicate: vi.fn(),
  softDelete: vi.fn(),
  rename: vi.fn(),
};
vi.mock("@/lib/repositories/supabase-project-repository", () => ({
  getProjectRepository: () => repo,
  SupabaseProjectRepository: class {},
}));

const { ProjectsDashboard } = await import(
  "@/components/projects/projects-dashboard"
);

function rec(id: string, name: string): ProjectRecord {
  return {
    id,
    ownerId: "u1",
    name,
    state: { version: 2 },
    stateVersion: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    deletedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("ProjectsDashboard", () => {
  it("lists the user's projects", async () => {
    repo.list.mockResolvedValue([rec("a", "Alpha"), rec("b", "Beta")]);
    render(<ProjectsDashboard />);
    expect(await screen.findByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("shows an empty state when there are no projects", async () => {
    repo.list.mockResolvedValue([]);
    render(<ProjectsDashboard />);
    expect(await screen.findByText(/No projects yet/i)).toBeTruthy();
  });

  it("creates a project and navigates to it", async () => {
    repo.list.mockResolvedValue([]);
    repo.save.mockResolvedValue(rec("new-1", "Untitled Project"));
    render(<ProjectsDashboard />);
    await screen.findByText(/No projects yet/i);

    // Two "New project" buttons (header + empty state) — click the first.
    fireEvent.click(
      screen.getAllByRole("button", { name: /New project/i })[0]!,
    );

    await waitFor(() => expect(repo.save).toHaveBeenCalledTimes(1));
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "u1" }),
    );
    expect(push).toHaveBeenCalledWith("/projetos/new-1");
  });
});
