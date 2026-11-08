import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../components/app/AppShell";
import { seo } from "../shared/seo";

export const Route = createFileRoute("/chat/$pin")({
  head: () => seo({ title: "Chat", noindex: true }),
  component: Chat,
});

function Chat() {
  const { pin } = Route.useParams();
  return <AppShell chatPin={pin} />;
}
