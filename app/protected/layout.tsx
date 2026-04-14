import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  void children;
  redirect("/dashboard");
}
