import { AuthGate } from "@/components/auth/auth-gate";
import { AppShell } from "@/components/layout/shell";

export default function Home() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}
