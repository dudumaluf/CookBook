"use client";

import { NodeResizeControl, type ControlPosition } from "@xyflow/react";
import { MoreHorizontal, Play } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExecutionStore } from "@/lib/stores/execution-store";
import { cn } from "@/lib/utils";
import type { NodeIO, NodeResizable, NodeSchema } from "@/types/node";

import { DotHandle } from "./handle-dot";
import { NodeStatusChip } from "./status-chip";

/**
 * Settings slot wired to the standardized `⋯` trigger in the header. The
 * trigger placement + icon + popover wrapper are BaseNode's responsibility
 * (ADR-0027); only `content` differs per node kind. `hasOverrides` lights
 * up the accent dot on the trigger so non-default settings are visible at
 * a glance without opening the popover.
 *
 * `ariaLabel` should describe *what* the settings are ("Text settings
 * (font, size)") so screen readers identify the trigger meaningfully —
 * generic "Settings" is the fallback.
 */
export interface BaseNodeSettings {
  content: ReactNode;
  hasOverrides?: boolean;
  ariaLabel?: string;
}

/**
 * Sizing slot (ADR-0028). Width / height come from `NodeInstance.size`
 * (user resize) falling back to `NodeSchema.size.default*`; min / max
 * come straight from the schema and apply both to the natural CSS layout
 * (so unbounded content can't blow out the silhouette) and to the
 * NodeResizeControl drag bounds (so the user can't drag past the design
 * ceiling either). `resizable` is the schema's opt-in for the drag
 * handle — `undefined` / `"none"` renders no handle, no chrome.
 */
export interface BaseNodeSize {
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  resizable?: NodeResizable;
}

/**
 * Floor for the card width when no schema explicitly opts in to a
 * different one. Matches the legacy `min-w-[240px]` we hardcoded before
 * the size slot existed — keeps every pre-ADR-0028 node visually
 * identical to its previous self.
 */
const DEFAULT_MIN_WIDTH = 240;

/**
 * Floor for user-resized height. Below this, the header + handle dots
 * collide with each other and the node card looks broken. We don't apply
 * this to the content-driven (no `style.height`) case — that one's
 * naturally bounded by header height + body content.
 */
const DEFAULT_RESIZE_MIN_HEIGHT = 80;

export interface BaseNodeProps {
  nodeId: string;
  schema: NodeSchema;
  selected: boolean;
  /** Per-instance label override. When empty/undefined, falls back to `schema.title`. */
  label?: string;
  /** Persist a new label (empty string clears it). Optional → header read-only when absent. */
  onRename?: (label: string) => void;
  /**
   * Optional settings slot. When provided, BaseNode renders a `⋯` icon
   * button in the top-right of the header that opens a Popover with
   * `settings.content`. See {@link BaseNodeSettings}.
   */
  settings?: BaseNodeSettings;
  /**
   * Optional size slot (ADR-0028). When omitted, the card is purely
   * content-driven with `min-width: 240px` and no resize handle (legacy
   * default). When provided, applies CSS dimension constraints to the
   * card and, when `resizable !== "none" | undefined`, renders a
   * standardized drag handle in the matching position.
   */
  size?: BaseNodeSize;
  /**
   * Optional override for the rendered handles. Lets callers pass a
   * dynamically-computed I/O list (e.g. composite nodes whose handles
   * come from `config.exposedInputs/Outputs`) without making BaseNode
   * itself aware of how that derivation works. Falls back to the
   * schema's static `inputs` / `outputs` when omitted.
   */
  inputs?: NodeIO[];
  outputs?: NodeIO[];
  children: ReactNode;
}

/**
 * BaseNode — shared shell for every node component on the canvas.
 *
 * Slim chrome (ADR-0021):
 *   - Header is a single row (icon · editable title · status chip). No
 *     border-bottom — the body flows out of it visually so the whole card
 *     reads as one surface instead of three stacked panels.
 *   - No footer with handle labels. Labels live in the handle's own
 *     hover-tooltip (see `DotHandle`), keeping the body unobstructed.
 *   - Body wrapper has zero padding; node bodies own their own spacing so
 *     they can go flush to the card edge (textareas, image previews, etc.)
 *     when the design calls for it. Bodies that want breathing room add
 *     `px-3 py-2` themselves.
 *
 * Header has no delete affordance on purpose: React Flow's built-in
 * Backspace/Delete keybinding fires a remove event that we wire to
 * `removeNode` in canvas-flow. Matches every other node-graph editor
 * (Figma, Blender, ComfyUI).
 *
 * Double-click the title → inline rename. Enter / blur commits, Escape
 * reverts. Empty input clears the per-instance label so the header falls
 * back to the schema's default title.
 *
 * Handles are positioned absolutely on the card sides (left = inputs,
 * right = outputs), one row per handle. The vertical placement reads from
 * the schema order, so reordering inputs in the schema reorders them
 * visually.
 *
 * ## Drag / click protocol (ADR-0031, Slice 5.4)
 *
 * Every BaseNode has a single, predictable rule for what initiates a node
 * drag vs. what is "click here, type here, scroll here" content:
 *
 *  - **Header is the drag handle.** Hovering the header shows `cursor-grab`;
 *    while dragging, the cursor flips to `grabbing`. The whole header row
 *    (icon · title · status chip · `⋯`) reads as "grab me to move".
 *  - **Body wrapper opts out of drag** via the `nodrag` class — React Flow
 *    recognizes this class natively and never starts a node drag from any
 *    descendant. So clicking on text in the body, dragging to highlight a
 *    selection, scrolling a long output, etc., never accidentally moves the
 *    node. The body still bubbles single-click events up to React Flow for
 *    selection (just not drag).
 *  - **The title `<span>` keeps `select-none`** so a single click on it
 *    bubbles cleanly to React Flow's selection logic instead of starting
 *    a text-selection (we never want users selecting "Text" / "Image" /
 *    etc. as if it were copy-pasteable content).
 *  - Inputs / textareas / popover triggers inside body content already
 *    `stopPropagation` on `pointerDown` (belt-and-suspenders alongside
 *    the `nodrag` wrapper, harmless when both apply).
 *
 * New nodes get this for free as long as they pass their content through
 * the BaseNode `children` slot. Don't add a custom `cursor-grab` to body
 * elements — the body is intentionally not a drag handle.
 */
export function BaseNode({
  nodeId,
  schema,
  selected,
  label,
  onRename,
  settings,
  size,
  inputs,
  outputs,
  children,
}: BaseNodeProps) {
  const Icon = schema.icon;
  const displayTitle =
    label && label.length > 0 ? label : schema.title;

  // Compose the CSS dimension constraints. `minWidth` always lands (with
  // the legacy 240 fallback so no-size-slot nodes look identical). The
  // others are conditional — `undefined` style values get tree-shaken out
  // of the inline style object so we don't emit `style="max-width: ;"`.
  const minWidth = size?.minWidth ?? DEFAULT_MIN_WIDTH;
  const cardStyle: CSSProperties = {
    minWidth,
    ...(size?.maxWidth !== undefined ? { maxWidth: size.maxWidth } : {}),
    ...(size?.minHeight !== undefined ? { minHeight: size.minHeight } : {}),
    ...(size?.maxHeight !== undefined ? { maxHeight: size.maxHeight } : {}),
    ...(size?.width !== undefined ? { width: size.width } : {}),
    ...(size?.height !== undefined ? { height: size.height } : {}),
  };

  const resizable = size?.resizable ?? "none";
  const hasResize = resizable !== "none";
  // The body wrapper needs `flex-1 min-h-0` whenever the card has an
  // upper bound on height — either an explicit `height` (user-resized) or
  // a schema `maxHeight` (ADR-0028). Without it, a body that wants to
  // scroll internally (`overflow-y-auto`) can't shrink to fit the card,
  // so its contents punch through the card boundary visually.
  const hasBoundedHeight =
    size?.height !== undefined || size?.maxHeight !== undefined;

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card/95 backdrop-blur-sm shadow-md shadow-black/40 transition-colors",
        selected
          ? "border-accent/80 ring-1 ring-accent/40"
          : "border-border/80 hover:border-border",
      )}
      style={cardStyle}
    >
      {/* Header — single row, no divider. Body flows visually into it.
       *
       * `shrink-0` so a flex-fill body (when the user has resized the node
       * with explicit height) can't squish the header. Layout reads
       * left-to-right as `[icon · title · ……spacer…… · status · ⋯ settings]`.
       * The settings trigger anchors the rightmost slot (ADR-0027) so every
       * settings-capable node parks its "secondary knobs" handle in the
       * same pixel-stable spot, no matter what the node body is up to.
       * Status chip pops in/out beside it during a run — settings position
       * never shifts.
       *
       * Header is the explicit drag handle for the node (ADR-0031, Slice
       * 5.4): `cursor-grab` on hover, `cursor-grabbing` while React Flow's
       * dragging-state class is on the wrapper. The body wrapper below
       * carries `nodrag` to opt out of drag from inside content, so this
       * is the only surface that initiates a node move. */}
      <header
        data-testid="node-drag-handle"
        className="flex shrink-0 cursor-grab items-center gap-2 px-3 pb-1 pt-2 text-xs font-medium text-foreground/90 active:cursor-grabbing"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {onRename ? (
          <EditableNodeTitle
            value={displayTitle}
            isCustom={Boolean(label && label.length > 0)}
            schemaTitle={schema.title}
            onCommit={onRename}
          />
        ) : (
          <span className="min-w-0 flex-1 select-none truncate">
            {displayTitle}
          </span>
        )}
        {/* Run-here button (Slice 5.8) only makes sense on EXPENSIVE nodes —
         *  the ones whose execution costs money or time and which the user
         *  wants to fire deliberately. Reactive nodes (Text, Array, List,
         *  Number, Iterators, Soul ID) update live via the reactive runner
         *  and don't need an explicit trigger. Slice 6.4 hotfix. */}
        {schema.execute && schema.reactive !== true ? (
          <RunHereButton nodeId={nodeId} />
        ) : null}
        <NodeStatusChip nodeId={nodeId} />
        {settings && <NodeSettingsTrigger settings={settings} />}
      </header>

      {/* Body — node-specific content. Padding is the body's responsibility
       *  so it can flush textareas / image previews to the card edge.
       *
       *  Wrapper uses `flex-1 min-h-0` *only* when the card has an explicit
       *  height (user has resized) or a schema maxHeight — that's when we
       *  need the body to share the leftover space with the header and for
       *  any `overflow-auto` inside the body to actually scroll. For
       *  content-driven cards (default), `min-h-0` would let a 0-height
       *  body collapse, so we keep the wrapper as a plain block. Either
       *  way the body sees the same `width:100%` semantics.
       *
       *  `overflow-hidden` is the silhouette guard (ADR — "card outline
       *  is sacred"): body content NEVER pierces the rounded card border.
       *  For bounded nodes (Text, LLM Text, Text Concat — `maxHeight`
       *  set) it clips overflow so a long output gets cleanly cut off
       *  at the bottom edge instead of spilling visually past the card.
       *  For unbounded nodes (image previews, etc.) it's a no-op — the
       *  card grows naturally to fit body content. Bodies that want to
       *  be scrollable opt in by adding `overflow-y-auto` to their
       *  primary content region (LLM Text output, Text Concat output,
       *  Text node editor).
       *
       *  The `nodrag` class is the React Flow native opt-out (recognized
       *  by the lib without any prop config) — every descendant is
       *  click-through for canvas selection but does NOT initiate a node
       *  drag (ADR-0031, Slice 5.4). The header above keeps the drag
       *  responsibility. */}
      <div
        data-testid="node-body"
        className={cn(
          "nodrag flex w-full flex-col overflow-hidden",
          hasBoundedHeight && "min-h-0 flex-1",
        )}
      >
        {children}
      </div>

      {hasResize && (
        <NodeBodyResizeHandle direction={resizable} size={size} />
      )}

      {/* Handle rails on each side. Inputs left, outputs right.
       *
       *  Layout: `justify-around` distributes the dots evenly along the
       *  card's full height (vs `justify-center + gap-X` which clusters
       *  them in the middle and cramps multi-input nodes like LLM Text).
       *  As a happy side-effect, on a tall node with N inputs the dots
       *  end up roughly aligned with the matching body rows — `user`
       *  near the user textarea, `system` near the system textarea, etc.
       *
       *  Each handle sits inside a wider invisible click target (`h-6`)
       *  so a small mouse miss still picks up the connection intent. The
       *  hover tooltip (DotHandle) reads the label without inline chrome. */}
      <div className="pointer-events-none absolute -left-1 top-0 flex h-full flex-col items-start justify-around py-3">
        {(inputs ?? schema.inputs).map((io) => (
          <div
            key={io.id}
            className="pointer-events-auto flex h-6 -translate-x-1/2 items-center"
          >
            <DotHandle
              id={io.id}
              side="left"
              dataType={io.dataType}
              label={io.label}
            />
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute -right-1 top-0 flex h-full flex-col items-end justify-around py-3">
        {(outputs ?? schema.outputs).map((io) => (
          <div
            key={io.id}
            className="pointer-events-auto flex h-6 translate-x-1/2 items-center"
          >
            <DotHandle
              id={io.id}
              side="right"
              dataType={io.dataType}
              label={io.label}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface EditableNodeTitleProps {
  value: string;
  /** True iff the displayed value is a custom label (not the schema default). */
  isCustom: boolean;
  schemaTitle: string;
  /**
   * Commit the edit. Empty/whitespace-only input clears the per-instance
   * label so the header falls back to the schema title.
   */
  onCommit: (next: string) => void;
}

/**
 * Inline-editable node title. Renders as a non-interactive span until the
 * user double-clicks; then swaps to an autofocused input with the current
 * text pre-selected.
 *
 * - Enter or blur → commit
 * - Escape → cancel + revert
 * - `onPointerDown.stopPropagation` keeps React Flow from initiating a
 *   node drag while editing.
 */
function EditableNodeTitle({
  value,
  isCustom,
  schemaTitle,
  onCommit,
}: EditableNodeTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  // `draft` is only meaningful while `isEditing` is true; outside of edit
  // mode we render `value` directly, so there's no need to sync from props
  // (which would trip the React 19 set-state-in-effect lint).
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  function startEditing() {
    // Pre-fill the input with the current custom label so renaming feels
    // like editing existing text. If the node still has the schema title
    // (no custom label yet), leave the input blank so the placeholder
    // hints at the default and the first keystroke isn't a backspace.
    setDraft(isCustom ? value : "");
    setIsEditing(true);
  }

  function commit() {
    setIsEditing(false);
    if (draft !== value) onCommit(draft);
  }

  function cancel() {
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        placeholder={schemaTitle}
        aria-label={`Rename node (default: ${schemaTitle})`}
        className="min-w-0 flex-1 rounded-sm bg-background/70 px-1 text-xs font-medium text-foreground outline-none ring-1 ring-accent/60 placeholder:text-muted-foreground/60"
        // nodrag/nopan are React Flow conventions to opt this element out of
        // canvas-level pan/drag while keeping pointer events for typing.
        // Belt + suspenders alongside the stopPropagation above.
        data-nodrag="true"
      />
    );
  }

  // Plain span (no button role / tabIndex / key handlers) — critical so
  // single-click bubbles through to React Flow's node-selection logic and
  // doesn't steal focus. If the title were a focusable button, focusing it
  // would put us inside React Flow's "ignore key presses inside inputs /
  // buttons" branch, and Backspace/Delete would silently no-op. F2 keyboard
  // path lives at the canvas-flow level instead (Slice 3 will wire it).
  return (
    <span
      onDoubleClick={startEditing}
      title="Double-click to rename"
      className={cn(
        "min-w-0 flex-1 cursor-text select-none truncate rounded-sm px-0.5 transition-colors hover:bg-background/40",
        isCustom ? "text-foreground" : "text-foreground/90",
      )}
    >
      {value}
    </span>
  );
}

/**
 * Standardized `⋯` (three-dot) trigger that opens a Popover with the node's
 * settings content. Lives in the header's rightmost slot — opposite side
 * of the node title — so every settings-capable node parks its trigger in
 * the same pixel-stable position (ADR-0027). Tooltip on hover so users
 * discover the affordance without opening the popover.
 *
 * Accent dot in the top-right corner of the button when
 * `settings.hasOverrides === true` — the "you have something non-default
 * here" signal that surfaces without requiring a click. `data-testid` on
 * the dot keeps tests unambiguous (the `MoreHorizontal` icon itself has
 * `aria-hidden`, so a generic `[aria-hidden]` selector would be too broad).
 */
function NodeSettingsTrigger({ settings }: { settings: BaseNodeSettings }) {
  const [open, setOpen] = useState(false);
  const label = settings.ariaLabel ?? "Settings";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              data-testid="node-settings-trigger"
              // Stop React Flow from interpreting clicks as canvas-pan or
              // node-drag — without this, mousedown bubbles up and the
              // popover's first frame races with a tiny canvas-pan twitch.
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                "relative h-6 w-6 shrink-0 text-muted-foreground/80 hover:text-foreground",
                settings.hasOverrides && "text-foreground/85",
              )}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              {settings.hasOverrides && (
                <span
                  aria-hidden
                  data-testid="node-settings-dot"
                  className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent"
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>

      <PopoverContent
        side="bottom"
        align="end"
        className="w-[280px] p-3"
        // Slider drag / number-input drag inside the popover bubbles up to
        // React Flow otherwise and pans the canvas. Capture-phase stop so
        // it wins over any descendant handlers.
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        {settings.content}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Per-node Run button. Renders a small play icon next to the status chip
 * in the BaseNode header for any node whose schema has an `execute()`.
 *
 * Default click = surgical "run only this node"
 * (`startRunNode(nodeId)`): the target re-executes but upstream ancestors
 * are reused from their current recorded outputs (only empty ancestors the
 * target depends on run on demand). This is what users expect from
 * "regenerate this one node" — it never silently re-runs the LLM / prompt
 * chain above it.
 *
 * Shift-click = "Run including upstream" (`startRunFrom(nodeId)`): the
 * classic run-here that re-executes the node and all ancestors, for when
 * the user deliberately wants upstream refreshed.
 *
 * Disabled only while THIS node is running — other nodes can render in
 * parallel (e.g. two Seedance nodes at once). `onPointerDown
 * stopPropagation` keeps the click from initiating a node drag (header is
 * the drag handle — ADR-0031).
 */
function RunHereButton({ nodeId }: { nodeId: string }) {
  const isThisNodeRunning =
    useExecutionStore((s) => s.getRecord(nodeId)?.status) === "running";
  const startRunNode = useExecutionStore((s) => s.startRunNode);
  const startRunFrom = useExecutionStore((s) => s.startRunFrom);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="node-run-here"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) =>
            e.shiftKey
              ? void startRunFrom(nodeId)
              : void startRunNode(nodeId)
          }
          disabled={isThisNodeRunning}
          aria-label="Run this node"
          className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-3 w-3 fill-current" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Run this node · shift-click to include upstream
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Standardized drag handle for ADR-0028 resizable nodes. Renders an
 * absolutely-positioned `NodeResizeControl` in the bottom-right corner
 * (for `both`), right edge (for `horizontal`), or bottom edge (for
 * `vertical`) with the schema's `min*` / `max*` as the drag bounds.
 *
 * The visual is a tiny two-line "corner" mark — the universally-recognized
 * resize affordance used by macOS, GTK, browser textareas, etc. — drawn
 * inline as SVG so it adopts the current text color and tints with hover
 * via `currentColor`. Subtle by default (40 % opacity), more visible on
 * hover so it's discoverable without dominating the silhouette.
 *
 * The handle uses `pointer-events-auto` so React Flow's wrapper (which
 * is `pointer-events: none` on the node card edges) doesn't swallow the
 * drag. The corner is offset 1 px out from the card so it doesn't sit
 * inside the rounded-xl clip and end up partially hidden.
 */
function NodeBodyResizeHandle({
  direction,
  size,
}: {
  direction: Exclude<NodeResizable, "none">;
  size?: BaseNodeSize;
}) {
  // `NodeResizeControl` defaults `minWidth` to 10 and `minHeight` to 10
  // (effectively zero). We back-fill our own defaults so a user can't
  // accidentally drag a node into a 10×10 unreadable square:
  //   - width:  `size.minWidth` or DEFAULT_MIN_WIDTH (240, matches the
  //     card's min-width so the drag bound and the CSS bound agree).
  //   - height: `size.minHeight` or DEFAULT_RESIZE_MIN_HEIGHT (80, just
  //     enough to fit the header + a handle dot or two).
  const minWidth = size?.minWidth ?? DEFAULT_MIN_WIDTH;
  const minHeight = size?.minHeight ?? DEFAULT_RESIZE_MIN_HEIGHT;
  const position: ControlPosition =
    direction === "horizontal"
      ? "right"
      : direction === "vertical"
        ? "bottom"
        : "bottom-right";

  // The default NodeResizeControl renders a 5×5 white square with a border
  // — fine for the demo, ugly in our card. We pass `style={{ background:
  // "transparent", border: "none" }}` to wipe its chrome and put our own
  // visual inside via children. `className=""` overrides the lib's default
  // class so the absolute-positioning + cursor styles below take effect.
  return (
    <NodeResizeControl
      position={position}
      minWidth={minWidth}
      minHeight={minHeight}
      maxWidth={size?.maxWidth}
      maxHeight={size?.maxHeight}
      // The lib renders an absolutely-positioned wrapper; we let it own the
      // position math (it knows about React Flow's measurement units) and
      // just style the visible thumb via children.
      style={{
        background: "transparent",
        border: "none",
        width: direction === "vertical" ? "100%" : 16,
        height: direction === "horizontal" ? "100%" : 16,
      }}
    >
      <div
        aria-hidden
        data-testid="node-resize-handle"
        data-direction={direction}
        className={cn(
          // Visual sits flush in the corner / edge mid-point — the
          // wrapper from NodeResizeControl already handles the bounds.
          "pointer-events-none absolute text-muted-foreground/40 transition-colors",
          // Hover state: comes from `group/node` on the BaseNode card —
          // we use the card's hover signal so the affordance "lights up"
          // as the user approaches even before they touch the handle.
          "group-hover:text-muted-foreground/80",
          // Cursor per direction (visual matches the drag axis).
          direction === "horizontal" && "right-0.5 top-1/2 -translate-y-1/2",
          direction === "vertical" && "bottom-0.5 left-1/2 -translate-x-1/2",
          direction === "both" && "bottom-0.5 right-0.5",
        )}
      >
        {direction === "both" ? (
          // Two short diagonals — the canonical macOS / browser-textarea
          // "drag corner" mark. Drawn as a 10×10 SVG so it scales with
          // the surrounding text color.
          <svg
            width={10}
            height={10}
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinecap="round"
          >
            <path d="M 1 9 L 9 1" />
            <path d="M 5 9 L 9 5" />
          </svg>
        ) : direction === "horizontal" ? (
          // Short vertical grip line on the right edge.
          <svg
            width={3}
            height={14}
            viewBox="0 0 3 14"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinecap="round"
          >
            <path d="M 1.5 1 L 1.5 13" />
          </svg>
        ) : (
          // Short horizontal grip line on the bottom edge.
          <svg
            width={14}
            height={3}
            viewBox="0 0 14 3"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.2}
            strokeLinecap="round"
          >
            <path d="M 1 1.5 L 13 1.5" />
          </svg>
        )}
      </div>
    </NodeResizeControl>
  );
}
