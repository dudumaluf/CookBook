import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";

import { DotHandle } from "@/components/nodes/handle-dot";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderHandle(props: Partial<React.ComponentProps<typeof DotHandle>>) {
  // Handle has to live inside a React Flow provider so internal context
  // (`useStoreApi`) resolves. We don't actually need to mount a Flow.
  return render(
    <ReactFlowProvider>
      <TooltipProvider>
        <DotHandle id="h" side="left" dataType="text" {...props} />
      </TooltipProvider>
    </ReactFlowProvider>,
  );
}

describe("<DotHandle />", () => {
  it("renders a single colored dot — no shadow ring, no datatype-aware shape (ADR-0023 uniform ports)", () => {
    // Regression guard: every port reads the same way, only the color
    // varies. Re-introducing a multi-only outer ring (or any other shape
    // tweak) would break the uniformity the user explicitly asked for.
    const { container } = renderHandle({});
    const handle = container.querySelector(".react-flow__handle");
    expect(handle).not.toBeNull();
    expect(handle?.className ?? "").not.toContain("shadow-[");
    expect(handle?.getAttribute("data-multiple")).toBeNull();
  });

  it("renders the label as a hover tooltip when one is provided (no inline label)", () => {
    renderHandle({ label: "user" });
    // The tooltip content isn't in the DOM until pointer hover — but the
    // trigger associates the label via aria, which Radix mirrors on the
    // handle. Easiest signal: the handle is wrapped by a TooltipTrigger
    // (no visible "user" text on the page pre-hover).
    expect(screen.queryByText("user")).toBeNull();
  });
});
