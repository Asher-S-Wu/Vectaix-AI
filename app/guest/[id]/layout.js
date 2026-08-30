import { GuestSessionProvider } from "@/lib/client/GuestSession";

export default async function GuestLayout({ children, params }) {
  const { id } = await params;
  return <GuestSessionProvider key={id} id={id}>{children}</GuestSessionProvider>;
}
