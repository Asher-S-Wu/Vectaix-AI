import GuestWorkspace from "@/app/components/guest/GuestWorkspace";

export default async function GuestPage({ params }) {
  const { workspace = [] } = await params;
  return <GuestWorkspace key={workspace.join("/")} workspace={workspace.join("/")} />;
}
