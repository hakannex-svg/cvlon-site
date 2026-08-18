import { redirect } from "next/navigation";

/** The staff console landing point. `/admin` previously had no page at all. */
export default function AdminIndexPage() {
  redirect("/admin/queue");
}
