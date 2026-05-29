import { AuthGate } from "@/components/auth/auth-gate";
import { ProjectsDashboard } from "@/components/projects/projects-dashboard";

/**
 * Projects dashboard — the app's home. Lists the signed-in user's
 * projects and lets them create, open, rename, duplicate, delete, or open
 * a project file. Opening a project navigates to /projetos/[id].
 */
export default function ProjectsPage() {
  return (
    <AuthGate>
      <ProjectsDashboard />
    </AuthGate>
  );
}
