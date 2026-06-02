import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { RolePicker } from "@/components/assistant/role-picker";
import { useAssistantRoleStore } from "@/lib/stores/assistant-role-store";

if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).getAnimations = function () {
    return [];
  };
}

function withTooltip(node: React.ReactNode) {
  return <TooltipProvider>{node}</TooltipProvider>;
}

beforeEach(() => {
  useAssistantRoleStore.getState().reset();
  localStorage.clear();
});

afterEach(() => {
  useAssistantRoleStore.getState().reset();
});

describe("RolePicker", () => {
  it("renders the trigger pill labeled with the active role", () => {
    render(withTooltip(<RolePicker />));
    const trigger = screen.getByTestId("role-picker-trigger");
    expect(trigger.textContent).toMatch(/general/i);
    expect(trigger.getAttribute("aria-label")).toMatch(/General/i);
  });

  it("clicking the trigger opens the popover with one button per role", async () => {
    render(withTooltip(<RolePicker />));
    fireEvent.click(screen.getByTestId("role-picker-trigger"));
    await waitFor(() => {
      expect(screen.getByTestId("role-option-general")).toBeTruthy();
      expect(screen.getByTestId("role-option-prompt-engineer")).toBeTruthy();
      expect(screen.getByTestId("role-option-storyboard-director")).toBeTruthy();
      expect(screen.getByTestId("role-option-timeline-director")).toBeTruthy();
      expect(screen.getByTestId("role-option-recipe-architect")).toBeTruthy();
    });
  });

  it("clicking a role option persists it in the store and updates the trigger label", async () => {
    render(withTooltip(<RolePicker />));
    fireEvent.click(screen.getByTestId("role-picker-trigger"));
    await waitFor(() =>
      screen.getByTestId("role-option-storyboard-director"),
    );
    fireEvent.click(screen.getByTestId("role-option-storyboard-director"));
    await waitFor(() => {
      expect(useAssistantRoleStore.getState().roleId).toBe(
        "storyboard-director",
      );
    });
    expect(screen.getByTestId("role-picker-trigger").textContent).toMatch(
      /storyboard director/i,
    );
  });

  it("marks the active role with data-selected=true and the others with false", async () => {
    useAssistantRoleStore.getState().setRoleId("recipe-architect");
    render(withTooltip(<RolePicker />));
    fireEvent.click(screen.getByTestId("role-picker-trigger"));
    await waitFor(() => screen.getByTestId("role-option-recipe-architect"));
    expect(
      screen
        .getByTestId("role-option-recipe-architect")
        .getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("role-option-general").getAttribute("data-selected"),
    ).toBe("false");
  });

  it("each role option shows its description text inside the popover", async () => {
    render(withTooltip(<RolePicker />));
    fireEvent.click(screen.getByTestId("role-picker-trigger"));
    await waitFor(() =>
      screen.getByTestId("role-option-prompt-engineer"),
    );
    const peButton = screen.getByTestId("role-option-prompt-engineer");
    expect(peButton.textContent).toMatch(/universal prompt/i);
  });
});
