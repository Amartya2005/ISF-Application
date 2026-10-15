"use client";
import Link from "next/link";
import { can, useMe } from "@/lib/me";
import { Account } from "./account";

export function Nav() {
  const { me } = useMe();
  return (
    <nav className="nav" aria-label="Console">
      {can(me, "application.read_all") && <Link href="/applications">Applications</Link>}
      {can(me, "user.read") && <Link href="/users">Accounts</Link>}
      {can(me, "import.manage") && <Link href="/imports">Imports</Link>}
      <Account />
    </nav>
  );
}
