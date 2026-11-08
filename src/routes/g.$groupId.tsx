import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app/AppShell";

export const Route = createFileRoute("/g/$groupId")({
  component: Group,
});

function Group() {
  const { groupId } = Route.useParams();
  return <AppShell groupId={groupId} />;
}
