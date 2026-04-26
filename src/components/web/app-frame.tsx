"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOutAction } from "@/app/actions/auth";

type NavItem = {
  href: string;
  label: string;
  description: string;
};

const navItems: NavItem[] = [
  {
    href: "/inventory",
    label: "Inventory",
    description: "Items, photos, and status",
  },
  {
    href: "/jobs",
    label: "Jobs",
    description: "Projects and assignments",
  },
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function navItemClass(active: boolean) {
  return [
    "group rounded-2xl border px-4 py-3 transition",
    active
      ? "border-[#173f97] bg-[#173f97] text-white shadow-sm"
      : "border-border/80 bg-white/75 text-foreground hover:border-accent/40 hover:bg-white",
  ].join(" ");
}

function navLabelClass(active: boolean) {
  return active ? "text-white" : "text-foreground";
}

function navDescriptionClass(active: boolean) {
  return active ? "text-blue-100" : "text-muted";
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">{children}</main>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 md:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Link className="text-lg font-semibold tracking-tight" href="/inventory">
                StageKit
              </Link>
              <p className="text-sm text-muted">Web workspace for inventory and job operations.</p>
            </div>
            <form action={signOutAction} className="lg:hidden">
              <button className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium" type="submit">
                Sign Out
              </button>
            </form>
          </div>

          <nav aria-label="Primary" className="grid gap-2 sm:grid-cols-2 lg:min-w-[29rem]">
            {navItems.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <Link key={item.href} className={navItemClass(active)} href={item.href}>
                  <div className={`text-sm font-semibold ${navLabelClass(active)}`}>{item.label}</div>
                  <div className={`mt-1 text-xs ${navDescriptionClass(active)}`}>{item.description}</div>
                </Link>
              );
            })}
          </nav>

          <form action={signOutAction} className="hidden lg:block">
            <button className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium" type="submit">
              Sign Out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-4 bottom-4 z-20 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-white/95 p-2 shadow-lg backdrop-blur md:hidden"
      >
        {navItems.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              className={[
                "rounded-xl px-3 py-3 text-center text-sm font-medium transition",
                active ? "bg-[#173f97] text-white" : "text-muted hover:bg-slate-50 hover:text-foreground",
              ].join(" ")}
              href={item.href}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
