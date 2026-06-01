import { AuthGate } from "@/components/auth/auth-gate";
import { RecipeEditShell } from "@/components/layout/recipe-edit-shell";

/**
 * Recipe edit route — Cookbook Library Phase B1 (ADR-0051).
 *
 * Gated by `AuthGate` so an anonymous visitor can't read another user's
 * recipe by URL guessing (the recipe-edit-session also enforces RLS
 * server-side, but failing fast in the client is cheaper). Next 16
 * passes `params` as a Promise — same pattern as the project route.
 */
export default async function RecipeEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AuthGate>
      <RecipeEditShell recipeId={id} />
    </AuthGate>
  );
}
