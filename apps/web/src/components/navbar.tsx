"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  CalendarClock,
  LayoutDashboard,
  Search,
  Settings,
  Trophy,
  User,
} from "lucide-react";
import { useApi } from "@/lib/api-client";

export function Navbar() {
  const pathname = usePathname();
  const { publicFetcher } = useApi();
  const [hasToken, setHasToken] = useState(false);
  const [myUsername, setMyUsername] = useState<string | null>(null);

  const links = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/search", label: "Search", icon: Search },
    { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
    ...(myUsername
      ? [{ href: `/profile/${myUsername}`, label: "Profile", icon: User }]
      : []),
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  useEffect(() => {
    const syncToken = () => {
      const token = localStorage.getItem("deadlineai_token");
      setHasToken(!!token);
      if (!token) {
        setMyUsername(null);
        return;
      }
      publicFetcher("/api/profile")
        .then((p: { username: string }) => setMyUsername(p.username))
        .catch(() =>
          publicFetcher("/api/users/me")
            .then((p: { username: string }) => setMyUsername(p.username))
            .catch(() => setMyUsername(null))
        );
    };
    syncToken();
    window.addEventListener("storage", syncToken);
    window.addEventListener("focus", syncToken);
    return () => {
      window.removeEventListener("storage", syncToken);
      window.removeEventListener("focus", syncToken);
    };
  }, [publicFetcher]);

  const signOut = () => {
    localStorage.removeItem("deadlineai_token");
    setHasToken(false);
    window.location.href = "/auth";
  };

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex cursor-pointer items-center gap-2.5">
          <motion.span
            whileHover={{ scale: 1.05, rotate: 2 }}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-muted text-foreground"
          >
            <CalendarClock className="h-5 w-5" />
          </motion.span>
          <span className="text-lg font-bold tracking-tight text-foreground">
            Deadline<span className="text-muted-foreground">AI</span>
          </span>
        </Link>

        <nav className="relative flex items-center gap-1 sm:gap-2">
          {links.map((l) => {
            const Icon = l.icon;
            const active =
              pathname === l.href ||
              (l.href.startsWith("/profile/") && pathname.startsWith("/profile/"));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "relative z-10 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-300",
                  active
                    ? "text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-lg bg-primary"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <Icon className="relative h-4 w-4" />
                <span className="relative hidden sm:inline">{l.label}</span>
              </Link>
            );
          })}
          <ThemeToggle />
          {hasToken ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-1 cursor-pointer"
              onClick={signOut}
            >
              Sign out
            </Button>
          ) : (
            <Button size="sm" className="ml-1 cursor-pointer" asChild>
              <Link href="/auth">Sign in</Link>
            </Button>
          )}
        </nav>
      </div>
    </motion.header>
  );
}
