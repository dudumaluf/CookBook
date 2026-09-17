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
        "Add a blocking stand-in. capsule = a person. plane = floor. box/sphere/cylinder = props.",
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
        "Set PSR (and camera lookAt) at tMs (default 0 = rest pose). Creates or moves a keyframe.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Object id or 'camera'." },
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
      description: "Upsert a key on position|rotation|scale|lookAt (lookAt = camera only).",
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
      description: "Set camera position, lookAt, and/or fov. Keyframes when tMs is set.",
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

Conventions (do not invent others):
- Y-up, meters. Origin is stage center. Ground is y=0.
- capsule ≈ a person (~1.8m). Use capsules for characters unless a mesh is already in the scene.
- Camera id is always "camera". It cannot be deleted. Drive it with position + lookAt + fov. Do not add lights or bones.
- Times are milliseconds. Default duration is 5000ms at 24fps.
- Rotation is Euler degrees XYZ.
- After you keyframe motion, call sample_at at start / mid / end to verify objects actually move.

Workflow:
1. read_scene
2. add / place objects
3. set_duration if the beat needs a different length
4. set_keyframe or set_transform at tMs for animation
5. set_camera so the shot reads
6. sample_at to confirm
7. Stop. Do not playblast — the user hits Run for that.

Never mention Blender, lights, rigs, or materials. If the user asks for those, refuse and keep blocking.`;
