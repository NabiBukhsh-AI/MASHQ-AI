import { redirect } from "next/navigation";

/**
 * /admin held a "built in a later task" placeholder long after the admin screens were built,
 * so anyone who followed the nav link or typed the path landed on a dead end. Settings are the
 * screen people mean by "admin", so that is where it goes.
 */
export default function AdminHome() {
  redirect("/admin/config");
}
