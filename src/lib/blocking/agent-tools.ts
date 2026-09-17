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
        "Add a NEW stand-in only when nothing on stage already fills that role. capsule = a person. plane = a floor mesh if they asked for one (the grid is already the ground reference — do not add a plane unless they want a visible floor). instancer = C4D-style cloner (parent sources under it). effector = jitter clones (parent onto an instancer). Prefer set_transform on an existing id.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "box",
              "sphere",
              "capsule",
              "cylinder",
              "plane",
              "instancer",
              "effector",
            ],
          },
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
        "Upsert a key on position|rotation|scale|lookAt|fov. lookAt / id='lookAt' changes only the aim point. fov is camera-only; value[0] is degrees (or pass a number).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          channel: { type: "string", enum: ["position", "rotation", "scale", "lookAt", "fov"] },
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
          channel: { type: "string", enum: ["position", "rotation", "scale", "lookAt", "fov"] },
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
          channel: { type: "string", enum: ["position", "rotation", "scale", "lookAt", "fov"] },
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
          channel: { type: "string", enum: ["position", "rotation", "scale", "lookAt", "fov"] },
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
        "Camera controls. position and lookAt are independent. fov is keyframed when tMs is set (zoom in/out over time). Pass only lookAt to change aim; only position to move; only fov to change zoom.",
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
      name: "set_parent",
      description:
        "Parent any object (or camera / lookAt) to another object so they follow it — eyes on a head, prop in a hand, camera dolly on a character. parentId=null unparents. World pose is preserved. Rejects cycles.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Object id, or 'camera' / 'lookAt'." },
          parentId: { type: "string", description: "Object id, or omit/null to unparent." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_color",
      description: "Set an object's display color as #rrggbb. color=null clears it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          color: { type: "string", description: "#rrggbb or omit/null to clear." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_instancer",
      description:
        "Configure an instancer (cloner). mode=linear|grid|scatter. Linear/scatter use count; grid uses columns×rows on the floor (X/Z). spacing is the step or scatter box. Parent sources under the instancer.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          mode: { type: "string", enum: ["linear", "grid", "scatter"] },
          count: { type: "number" },
          columns: { type: "number" },
          rows: { type: "number" },
          spacing: vec3,
          seed: { type: "number" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_effector",
      description:
        "Configure an effector. Parent it to an instancer. type=random|step. Toggle position/rotation/scale independently; amount is the max delta (degrees for rotation). Stack several effectors.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["random", "step"] },
          strength: { type: "number" },
          position: { type: "boolean" },
          rotation: { type: "boolean" },
          scale: { type: "boolean" },
          amount: vec3,
          seed: { type: "number" },
        },
        required: ["id"],
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
      name: "add_figure",
      description:
        "Add a thin primitive person (hips + torso/head/arms/legs, parented). Use when they ask for a person/figure and there is no VAT character.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          position: vec3,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_locomotion",
      description:
        "Walk a figure root from A to B and swing limbs. Writes pose keys on purpose.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          from: vec3,
          to: vec3,
          startMs: { type: "number" },
          endMs: { type: "number" },
        },
        required: ["id", "from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_preset",
      description: "Frame a subject: wide|medium|close|ots|profile. Inserts a camera pose.",
      parameters: {
        type: "object",
        properties: {
          preset: { type: "string", enum: ["wide", "medium", "close", "ots", "profile"] },
          subjectId: { type: "string" },
          tMs: { type: "number" },
          cameraId: { type: "string" },
        },
        required: ["preset", "subjectId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_shot",
      description: "Split the shot list at tMs (partition, no holes). cameraId optional.",
      parameters: {
        type: "object",
        properties: {
          tMs: { type: "number" },
          cameraId: { type: "string" },
        },
        required: ["tMs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_camera",
      description: "Add another playblast camera. Then add_shot to cut to it.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "duplicate_object",
      description: "Copy an existing object (same pose keys).",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "snap_to_floor",
      description: "Set Y so the stand-in sits on y=0 (capsule rest at y=1).",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, tMs: { type: "number" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "look_at_id",
      description: "Aim the camera (or yaw an object) at another object.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          targetId: { type: "string" },
          tMs: { type: "number" },
        },
        required: ["id", "targetId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "place_relative",
      description: "Move id to target + offset (meters).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          targetId: { type: "string" },
          offset: vec3,
          tMs: { type: "number" },
        },
        required: ["id", "targetId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_vat",
      description: "Add a sample VAT character (idle/walk in-place). Travel with pose keys.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          position: vec3,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_vat_clip",
      description: "Key a VAT clip (idle/walk) at tMs. Morphs toward the next clip key.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          clip: { type: "string" },
          tMs: { type: "number" },
        },
        required: ["id", "clip"],
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
- Match by name or kind (capsule ≈ person). The grid is the floor reference — only add a plane if they asked for a visible floor mesh.
- add_primitive only when they ask for a NEW actor that is not already listed.
- Reuse existing ids. Never invent a second hero next to an existing one.

Camera vs lookAt (independent):
- Camera id is always "camera". Aim id is "lookAt" (or set_camera with only lookAt).
- "look at X" / "aponta para" / change where it looks → set_camera({ lookAt }) or set_keyframe id=camera channel=lookAt. Do NOT move camera position unless they asked.
- "move the camera" / dolly / truck → set_camera({ position }) and leave lookAt alone unless they asked to reframe.
- Zoom / FOV / "abre o lente" → set_camera({ fov, tMs }) or set_keyframe id=camera channel=fov. Do not move the camera unless they asked.
- You can keyframe position, lookAt, and fov separately.
- "person walking" → add_figure then apply_locomotion (or add_vat + set_vat_clip + pose keys if a VAT body is on stage).
- "OTS then close-up" → apply_preset + add_shot (shot list is a partition).
- add_camera then add_shot to cut. Presets always write a camera pose.
- set_parent any object (or camera / lookAt) onto another so they ride its keys (eyes on a capsule, hat on a head, camera dolly). Add the child at world pose first, then set_parent. parentId=null to unparent. Do not add a new object just to parent.
- Crowd / copies: add_primitive kind=instancer, parent the source(s) under it, set_instancer mode/count/spacing. add_primitive kind=effector, parent onto the instancer, set_effector for which channels to jitter (P/R/S). Grid is columns×rows on the floor (X/Z).
- set_color id #rrggbb to tint a stand-in.

Conventions:
- Y-up, meters. Origin is stage center. The grid is y=0.
- capsule ≈ a person (~1.8m). Prefer a mesh already in the scene over a new capsule.
- Do not add lights or bones. Times are milliseconds. Rotation is Euler degrees XYZ.
- After keyframes, sample_at at start / mid / end. Stop. Do not playblast — the user hits Run for that.

Never mention Blender, lights, rigs, or materials. If the user asks for those, refuse and keep blocking.`;
