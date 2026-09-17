import type { ToolDefinition } from "@/lib/llm/types";

const vec3 = {
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
  description: "World-space [x, y, z]. Y-up, meters.",
} as const;

/**
 * Tool list the in-node scene agent (and the assistant wrappers) share.
 * Mutations map 1:1 onto `applyBlockingOp`.
 */
export const BLOCKING_AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_scene",
      description:
        "Compact listing of the stage at tMs (default 0): camera fov/pos/lookAt and each object PSR. Does not dump keyframe arrays.",
      parameters: {
        type: "object",
        properties: {
          tMs: { type: "number", description: "Playhead in milliseconds." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sample_at",
      description:
        "Evaluate interpolated PSR (and camera) at tMs. Call this after keyframing to verify motion.",
      parameters: {
        type: "object",
        properties: {
          tMs: { type: "number" },
          id: { type: "string", description: "Object id or 'camera'. Omit for everyone." },
        },
        required: ["tMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_objects",
      description: "Ids, names, kinds (includes camera).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "add_primitive",
      description:
        "Add a NEW stand-in only when nothing on stage already fills that role. capsule = a person. plane = floor (a ground plane usually already exists — do not add another). Prefer set_transform on an existing id.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["box", "sphere", "capsule", "cylinder", "plane"] },
          name: { type: "string" },
          id: { type: "string" },
          position: vec3,
          rotation: vec3,
          scale: vec3,
        },
        required: ["kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_object",
      description: "Delete an object. The camera cannot be removed.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_object",
      description: "Rename an object.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_transform",
      description:
        "Edit an existing object or the camera at tMs (default 0). Creates or moves a keyframe. id='camera' for camera position; id='lookAt' (or id='camera' + lookAt) to change only where the camera aims — camera position stays put if you omit position.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Existing object id, 'camera', or 'lookAt'." },
          position: vec3,
          rotation: vec3,
          scale: vec3,
          lookAt: vec3,
          tMs: { type: "number" },
          easing: { type: "string", enum: ["linear", "easeIn", "easeOut", "easeInOut"] },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_keyframe",
      description:
        "Upsert a key on position|rotation|scale|lookAt. lookAt / id='lookAt' changes only the aim point. Use this to edit motion on objects that already exist.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          channel: { type: "string", enum: ["position", "rotation", "scale", "lookAt"] },
          tMs: { type: "number" },
          value: vec3,
          easing: { type: "string", enum: ["linear", "easeIn", "easeOut", "easeInOut"] },
        },
        required: ["id", "channel", "tMs", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_keyframe",
      description: "Remove a key at tMs. The 0ms rest pose cannot be removed.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          channel: { type: "string", enum: ["position", "rotation", "scale", "lookAt"] },
          tMs: { type: "number" },
        },
        required: ["id", "channel", "tMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_keyframe",
      description:
        "Retiming only — slide an existing key to a new tMs. Value stays. Cannot move the 0ms rest pose.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          channel: { type: "string", enum: ["position", "rotation", "scale", "lookAt"] },
          fromMs: { type: "number" },
          toMs: { type: "number" },
        },
        required: ["id", "channel", "fromMs", "toMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_tracks",
      description: "Reset keys on an object (or one channel) back to a single rest pose.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          channel: { type: "string", enum: ["position", "rotation", "scale", "lookAt"] },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_camera",
      description:
        "Camera controls. position and lookAt are independent: pass only lookAt to change where it aims (camera stays); pass only position to move the camera (aim stays). fov optional. Keyframes when tMs is set.",
      parameters: {
        type: "object",
        properties: {
          position: vec3,
          lookAt: vec3,
          fov: { type: "number" },
          tMs: { type: "number" },
          easing: { type: "string", enum: ["linear", "easeIn", "easeOut", "easeInOut"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_duration",
      description: "Timeline length in milliseconds (200–60000).",
      parameters: {
        type: "object",
        properties: { durationMs: { type: "number" } },
        required: ["durationMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_fps",
      description: "Playblast frame rate (1–60). Default 24.",
      parameters: {
        type: "object",
        properties: { fps: { type: "number" } },
        required: ["fps"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "import_mesh",
      description: "Add a mesh actor from a durable URL (already uploaded GLB/OBJ/FBX).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          name: { type: "string" },
          id: { type: "string" },
          position: vec3,
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "play_clip",
      description: "Play an embedded GLB/FBX animation clip on a mesh (no retarget).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          startMs: { type: "number" },
          speed: { type: "number" },
        },
        required: ["id", "name"],
      },
    },
  },
];

export const BLOCKING_AGENT_SYSTEM = `You are the scene agent for Cookbook 3D Blocking — a previz / playblast stage used as motion reference for video models.

This is usually an EDIT of a stage that already exists. The snapshot in the user message lists every id. Read it before mutating.

Edit vs add:
- If the user talks about something already on stage ("the person", "the capsule", "him", "the box", "the camera", "where it looks"), EDIT that id. Do not add a duplicate.
- Match by name or kind (capsule ≈ person). Ground / plane is already there — never add a second floor.
- add_primitive only when they ask for a NEW actor that is not already listed.
- Reuse existing ids. Never invent a second hero next to an existing one.

Camera vs lookAt (independent):
- Camera id is always "camera". Aim id is "lookAt" (or set_camera with only lookAt).
- "look at X" / "aponta para" / change where it looks → set_camera({ lookAt }) or set_keyframe id=camera channel=lookAt. Do NOT move camera position unless they asked.
- "move the camera" / dolly / truck → set_camera({ position }) and leave lookAt alone unless they asked to reframe.
- You can keyframe them separately.

Conventions:
- Y-up, meters. Origin is stage center. Ground is y=0.
- capsule ≈ a person (~1.8m). Prefer a mesh already in the scene over a new capsule.
- Do not add lights or bones. Times are milliseconds. Rotation is Euler degrees XYZ.
- After keyframes, sample_at at start / mid / end. Stop. Do not playblast — the user hits Run for that.

Never mention Blender, lights, rigs, or materials. If the user asks for those, refuse and keep blocking.`;
