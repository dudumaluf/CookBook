"use client";

import { Handle, Position, type HandleProps } from "@xyflow/react";

import { cn } from "@/lib/utils";
import type { DataType } from "@/types/node";

const DATATYPE_VAR: Record<DataType, string> = {
  text: "var(--datatype-text)",
  image: "var(--datatype-image)",
  video: "var(--datatype-video)",
  number: "var(--datatype-number)",
  any: "var(--datatype-any)",
};

interface DotHandleProps
  extends Omit<HandleProps, "position" | "type" | "id"> {
  id: string;
  side: "left" | "right";
  dataType: DataType;
  label?: string;
}

/**
 * DotHandle — a colored circle anchored to the side of a node card, with an
 * optional inline label. Color is driven by the datatype CSS variable so the
 * tokens stay centralized.
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

  return (
    <div
      className={cn(
        "relative flex h-6 items-center gap-1.5",
        side === "left" ? "justify-start pl-0" : "justify-end pr-0",
      )}
    >
      {side === "right" && label && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {label}
        </span>
      )}
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
      {side === "left" && label && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {label}
        </span>
      )}
    </div>
  );
}
