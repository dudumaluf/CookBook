/**
 * Prompt constants for the ByteDance singer-performance method.
 *
 * ByteDance/Seedance's recommended way to make a character sing a song is
 * to DECOMPOSE the task into stages rather than feeding character image +
 * motion video + audio into one call (where they fight):
 *
 *   Stage 1 — character swap: edit the performance video to replace ONLY
 *             the character's identity, anchored to a required first/last
 *             frame. → {@link CHARACTER_SWAP_PROMPT}
 *   Stage 2 — decompose: extract ordered keyframes from the swapped clip +
 *             render the song as a black-screen MP4 (the `audio-to-video`
 *             node) so it can ride Seedance's video channel as an
 *             audio-only reference.
 *   Stage 3 — keyframe-anchored singing: Seedance reference mode with the
 *             keyframes as @Image1…@ImageN and the black-screen song as
 *             @Video1 (audio-only), then concat the chunks.
 *             → {@link KEYFRAME_ANCHORED_SINGING_PROMPT}
 *
 * These are the canonical TS home for the two stage prompts. The seeded
 * "Singer Performance (ByteDance)" recipe embeds the same literal text in
 * its Text nodes' `config.text` (SQL can't import TS), so keep the two in
 * sync if you edit either.
 */

/** Stage 1 — identity swap on a performance clip, anchored to first/last frame. */
export const CHARACTER_SWAP_PROMPT = `Strictly edit @Video1 and modify ONLY the character's identity to match @Image1 (face, hairstyle, body shape, clothing, overall appearance).
@Image2 is the required FIRST frame: the output must start by matching @Image2 in subject identity, pose, composition, camera angle, framing, lighting, background, and overall layout.
@Image3 is the required LAST frame: the output must end by matching @Image3 in those same attributes.
Preserve the original video's motion, timing, and camera movement as much as possible — change only the character's features to @Image1.
Highest priority: match @Image2 as the first frame and @Image3 as the last frame. Do not introduce new subjects, objects, backgrounds, camera cuts, or unrelated style changes.`;

/** Stage 3 — sing through ordered keyframes, audio driven by the black-screen @Video1. */
export const KEYFRAME_ANCHORED_SINGING_PROMPT = `Use the provided keyframes @Image1 … @ImageN as ordered visual anchors; @Image1 is the first frame and @ImageN is the last. They define the visual progression from start to end.
Generate a singing-performance video that transitions naturally through the keyframes in order, matching each keyframe as closely as possible at its moment — character identity, face, body shape, clothing, scene, background, lighting, camera angle, framing, composition, and visual style.
Use @Video1 ONLY as the singing audio reference: the character sings according to @Video1 (lyrics, melody, rhythm, tempo, pauses, pronunciation, emotional tone, lip-sync timing). Do NOT copy any identity, scene, clothing, background, or camera from @Video1.
Between keyframes, generate natural motion preserving character and scene continuity; allow natural head, facial, mouth, jaw, shoulder and subtle upper-body movement fitting the rhythm and emotion.
Priority: (1) preserve identity/scene/style/framing from the keyframes; (2) follow @Video1 for lyrics/rhythm/timing/lip-sync; (3) pass through keyframes in order with smooth transitions; (4) natural singing motion between keyframes; (5) keep unrelated visuals stable.
Do not let @Video1 override appearance or scene. Do not rigidly copy original motion if it conflicts with the singing.`;
