"use client";

import { Handle, Position, type HandleProps } from "@xyflow/react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DataType } from "@/types/node";

const DATATYPE_VAR: Record<DataType, string> = {
  text: "var(--datatype-text)",
  image: "var(--datatype-image)",
  video: "var(--datatype-video)",
  number: "var(--datatype-number)",
  "soul-id": "var(--datatype-soul-id)",
  any: "var(--datatype-any)",
};

interface DotHandleProps
  extends Omit<HandleProps, "position" | "type" | "id"> {
  id: string;
  side: "left" | "right";
  dataType: DataType;
  /**
   * Human-readable handle label (e.g. "user", "system", "out"). Shown as a
   * hover tooltip — never inline on the node. The label lives next to its
   * dot only on hover so the body stays uncluttered (ADR-0021).
   */
  label?: string;
}

/**
 * DotHandle — a colored circle anchored to the side of a node card. Color
 * is driven by the datatype CSS variable so the tokens stay centralized.
 *
 * Every dot looks identical except for its color (datatype). Whether the
 * handle accepts multiple incoming edges (`multiple:true` in the schema)
 * is intentionally *not* visualized (ADR-0023) — multi-edge connections
 * "just work" because the engine aggregates them; users discover the
 * capability by trying, which keeps the canvas read uniform across all
 * ports of the same datatype.
 *
 * The handle label (if any) appears as a tooltip on hover, oriented away
 * from the card on whichever side the handle sits.
 */
export function DotHandle({
  id,
  side,
  dataType,
  label,
  className,
  ...rest
}: DotHandleProps) {
  const handleType = side === "left" ? "target" : "source";
  const position = side === "left" ? Position.Left : Position.Right;

  const handle = (
    <Handle
      id={id}
      type={handleType}
      position={position}
      className={cn(
        "!h-2.5 !w-2.5 !rounded-full !border-2 !border-background",
        className,
      )}
      style={{ background: DATATYPE_VAR[dataType] }}
      {...rest}
    />
  );

  if (!label) return handle;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{handle}</TooltipTrigger>
      <TooltipContent side={side === "left" ? "left" : "right"}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
