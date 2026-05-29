# State after — M1 projects arc (surgical runs + persistent results + multi-project + file portability)

Snapshot date: 2026-05-29. Read this first if you're picking up after a context flip.

## What shipped (Phases 1-4, ADR-0049 + ADR-0050)

Cookbook is now a document-based, multi-project app. Three user-facing wins:

1. **Surgical runs** — clicking a node's Run regenerates just that node, reusing upstream nodes' existing results (only empty upstreams it depends on run on demand). No more "run one image node, the whole LLM chain re-fires". Shift-click = "run including upstream".
2. **Results survive reload** — each node's last output + history persist inside the project document and rehydrate on load. The canvas comes back exactly as you left it (text + images + videos), not just the graph.
3. **Projects** — create / open / rename / duplicate / delete, each at its own URL (`/projetos/[id]`), tied to the signed-in user. Save a project to a file (`.cookbook` JSON or self-contained `.cookbook.zip` with media) and open it back — not locked to Supabase.

## Where things live

- **Engine** — `src/lib/engine/run-workflow.ts`: `seedOutputs` option (reuse ancestor outputs by node-id in a node-only run).
- **Execution store** — `src/lib/stores/execution-store.ts`: `startRunNode(nodeId)` (surgical); `setActiveProject(projectId)` (per-project output-cache namespace).
- **Project document** — `src/lib/project/document.ts`: `serializeProject` / `applyProjectDocument` / `migrateProjectDocument` + execution-state (de)serialize + `emptyProjectDocument`. The single canonical shape for cloud + file. Restored records use status `"cached"`.
- **Project session** — `src/lib/project/session.ts`: `openProject` / `closeProject`, race-guarded lifecycle (teardown → reset → cache namespace → load → rehydrate → subscribe).
- **File portability** — `src/lib/project/file.ts`: pure core (`collectMediaUrls`, `rewriteUrls`, `buildProjectBundle`, `readProjectBundle`) + browser wrappers (`exportProjectJson`, `exportProjectBundle`, `importProjectFile`, `importProjectToCloud`). Dep: `fflate`.
- **Repository** — `src/lib/repositories/*project-repository*`: `getById` + `duplicate` added (`list`/`save`/`rename`/`softDelete` already there). `ProjectState` v2 (`executionState`, `projectName`).
- **Sync** — `src/lib/sync/project-sync.ts`: snapshot/apply delegate to the document module; autosave also observes the execution-store; `onSaving` callback. `generation-sync` unchanged (cached records skipped).
- **UI** — `src/app/page.tsx` (→ `/projetos`), `src/app/projetos/page.tsx` + `src/app/projetos/[id]/page.tsx`, `src/components/projects/projects-dashboard.tsx`, `src/components/layout/project-menu.tsx` (New / All projects / Open file / Export / Export with media), `src/components/layout/save-indicator.tsx`, `src/lib/stores/save-status-store.ts`.

## Persistence model (important)

- **Cloud is canonical per project.** `cookbook_projects.state` (JSONB) holds the whole document including `executionState`. The shell no longer rehydrates localStorage; it shows a spinner and the ProjectSession applies the cloud document. The legacy localStorage workflow key is a harmless write-only artifact.
- **Gallery is separate.** `cookbook_generations` remains the curated, searchable archive. Canvas results come from the document, not a generations scan.

## Tests / checks

- 947 tests green. New: `tests/unit/project/document.test.ts`, `tests/unit/project/session.test.ts`, `tests/unit/project/file.test.ts`, `tests/component/projects/projects-dashboard.test.tsx`, plus run-workflow `seedOutputs` + execution-store `startRunNode` + repo `getById`/`duplicate`.
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run docs:check` all clean.

## Known / deferred

- File-with-media `.zip` of very large videos is memory-bound in the browser (explicit user action; a size warning could be added).
- The workflow v1-v9 node migration still lives in the workflow-store `persist.migrate`; opening very old *files* relies on the document-level migrator. Extracting a shared `migrateWorkflowGraph` is a future cleanup.
- Soul ID training (M1 Slice G) remains deferred.
