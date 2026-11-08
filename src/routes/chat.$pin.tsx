import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app/AppShell";

export const Route = createFileRoute("/chat/$pin")({
  component: Chat,
});

function Chat() {
  const { pin } = Route.useParams();
  return <AppShell chatPin={pin} />;
}
