"use client";

import {
  Copy,
  FilePlus,
  FolderInput,
  FolderOpen,
  Loader2,
  LogOut,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/auth/use-session";
import { emptyProjectDocument } from "@/lib/project/document";
import { importProjectToCloud } from "@/lib/project/file";
import type {
  ProjectRecord,
  ProjectState,
} from "@/lib/repositories/project-repository";
import { getProjectRepository } from "@/lib/repositories/supabase-project-repository";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ProjectsDashboard() {
  const { user, signOut } = useSession();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    const toastId = toast.loading("Opening project file…");
    try {
      const id = await importProjectToCloud(file, user.id);
      toast.success("Project imported", { id: toastId });
      router.push(`/projetos/${id}`);
    } catch (err) {
      console.error("[projects] import failed:", err);
      toast.error("Could not open that file", { id: toastId });
    }
  }

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const list = await getProjectRepository().list(user.id);
      setProjects(list);
    } catch (err) {
      console.error("[projects] list failed:", err);
      toast.error("Failed to load projects");
      setProjects([]);
    }
  }, [user]);

  useEffect(() => {
    void (async () => {
      await refresh();
    })();
  }, [refresh]);

  async function createProject() {
    if (!user || busy) return;
    setBusy(true);
    try {
      const rec = await getProjectRepository().save({
        ownerId: user.id,
        name: "Untitled Project",
        state: emptyProjectDocument("Untitled Project") as unknown as ProjectState,
      });
      router.push(`/projetos/${rec.id}`);
    } catch (err) {
      console.error("[projects] create failed:", err);
      toast.error("Failed to create project");
      setBusy(false);
    }
  }

  async function duplicateProject(id: string) {
    try {
      await getProjectRepository().duplicate(id);
      toast.success("Project duplicated");
      await refresh();
    } catch (err) {
      console.error("[projects] duplicate failed:", err);
      toast.error("Failed to duplicate project");
    }
  }

  async function deleteProject(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone here.`)) return;
    try {
      await getProjectRepository().softDelete(id);
      toast.success("Project deleted");
      await refresh();
    } catch (err) {
      console.error("[projects] delete failed:", err);
      toast.error("Failed to delete project");
    }
  }

  async function commitRename(id: string) {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    try {
      await getProjectRepository().rename(id, name);
      await refresh();
    } catch (err) {
      console.error("[projects] rename failed:", err);
      toast.error("Failed to rename project");
    }
  }

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <span className="relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-foreground">
            <Image src="/logo.png" alt="Cookbook" width={32} height={32} priority />
          </span>
          <h1 className="text-sm font-semibold tracking-tight">Projects</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".cookbook,.json,.zip,application/json,application/zip"
            className="hidden"
            onChange={(e) => void onPickFile(e)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5"
          >
            <FolderInput className="h-3.5 w-3.5" />
            Open file
          </Button>
          <Button
            size="sm"
            onClick={() => void createProject()}
            disabled={busy}
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FilePlus className="h-3.5 w-3.5" />
            )}
            New project
          </Button>
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 items-center rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.06]">
                {user.email}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void signOut()}>
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {projects === null ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <FolderOpen className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No projects yet. Create your first one to start building.
            </p>
            <Button onClick={() => void createProject()} disabled={busy} className="gap-1.5">
              <FilePlus className="h-3.5 w-3.5" />
              New project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                data-testid="project-card"
                className="group relative flex flex-col gap-2 rounded-xl border border-border/60 bg-card/40 p-4 transition-colors hover:border-border"
              >
                {renamingId === p.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename(p.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="h-8 rounded-md border border-border/60 bg-background px-2 text-sm"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => router.push(`/projetos/${p.id}`)}
                    className="text-left text-sm font-medium hover:underline"
                  >
                    {p.name}
                  </button>
                )}
                <span className="text-[11px] text-muted-foreground">
                  Updated {formatWhen(p.updatedAt)}
                </span>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Project actions"
                    className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.06] group-hover:opacity-100 data-[popup-open]:opacity-100"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => router.push(`/projetos/${p.id}`)}>
                      <FolderOpen className="h-3.5 w-3.5" />
                      Open
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setRenameValue(p.name);
                        setRenamingId(p.id);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void duplicateProject(p.id)}>
                      <Copy className="h-3.5 w-3.5" />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => void deleteProject(p.id, p.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
