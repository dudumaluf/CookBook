import { AuthGate } from "@/components/auth/auth-gate";
import { AppShell } from "@/components/layout/shell";

/**
 * Per-project editor route. The project id lives in the URL so a reload
 * reopens the exact same project (graph + generated results). Next 16
 * passes `params` as a Promise — awaited here, then handed to the shell.
 */
export default async function ProjectEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AuthGate>
      <AppShell projectId={id} />
    </AuthGate>
  );
}
