import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app/AppShell";
import { seo } from "../shared/seo";

export const Route = createFileRoute("/g/$groupId")({
  head: () => seo({ title: "Group", noindex: true }),
  component: Group,
});

function Group() {
  const { groupId } = Route.useParams();
  return <AppShell groupId={groupId} />;
}
