import { redirect } from "next/navigation";

/**
 * The app entry now lives at /projetos (the project dashboard). Landing on
 * `/` redirects there so the user always starts by choosing or creating a
 * project — each project then owns its own URL (/projetos/[id]).
 */
export default function Home() {
  redirect("/projetos");
}
