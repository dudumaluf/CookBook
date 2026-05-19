import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("sample component test", () => {
  it("renders a shadcn Button with text", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: /click me/i })).toBeInTheDocument();
  });

  it("respects the variant prop", () => {
    render(<Button variant="outline">Outline btn</Button>);
    const btn = screen.getByRole("button", { name: /outline btn/i });
    expect(btn.className).toMatch(/border/);
  });
});
