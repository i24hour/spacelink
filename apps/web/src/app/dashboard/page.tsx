"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Bookmark,
  Flame,
  Search,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { useApi } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DeadlineCard, type SavedLink } from "@/components/dashboard/deadline-card";
import { DashboardEmptyState } from "@/components/dashboard/empty-state";

type FilterTab = "all" | "active" | "urgent" | "upcoming" | "missed";

const filters: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "urgent", label: "Urgent" },
  { id: "upcoming", label: "Upcoming" },
  { id: "missed", label: "Missed" },
];

export default function DashboardPage() {
  const { fetcher } = useApi();
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");

  useEffect(() => {
    fetcher("/api/links")
      .then((data: SavedLink[]) => setLinks(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [fetcher]);

  const stats = useMemo(() => {
    const now = Date.now();
    const total = links.length;
    const active = links.filter((l) => l.status === "active").length;
    const urgent = links.filter(
      (l) =>
        (l.urgencyScore ?? 0) >= 7 ||
        (l.extractedDeadline &&
          new Date(l.extractedDeadline).getTime() - now < 24 * 60 * 60 * 1000 &&
          new Date(l.extractedDeadline).getTime() > now)
    ).length;
    const missed = links.filter(
      (l) =>
        l.extractedDeadline &&
        new Date(l.extractedDeadline).getTime() < now &&
        l.status !== "archived"
    ).length;
    const upcoming = links.filter(
      (l) =>
        l.extractedDeadline &&
        new Date(l.extractedDeadline).getTime() > now &&
        l.status !== "archived"
    ).length;
    return { total, active, urgent, missed, upcoming };
  }, [links]);

  const filtered = useMemo(() => {
    const now = Date.now();
    let list = links;

    if (tab === "active") list = list.filter((l) => l.status === "active");
    if (tab === "urgent")
      list = list.filter(
        (l) =>
          (l.urgencyScore ?? 0) >= 7 ||
          (l.extractedDeadline &&
            new Date(l.extractedDeadline).getTime() - now < 7 * 24 * 60 * 60 * 1000 &&
            new Date(l.extractedDeadline).getTime() > now)
      );
    if (tab === "upcoming")
      list = list.filter(
        (l) =>
          l.extractedDeadline &&
          new Date(l.extractedDeadline).getTime() > now &&
          l.status !== "archived"
      );
    if (tab === "missed")
      list = list.filter(
        (l) =>
          l.extractedDeadline &&
          new Date(l.extractedDeadline).getTime() < now &&
          l.status !== "archived"
      );

    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        (l.category || "").toLowerCase().includes(q) ||
        l.url.toLowerCase().includes(q)
    );
  }, [links, query, tab]);

  const handleArchive = async (id: string) => {
    await fetcher(`/api/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });
    setLinks((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status: "archived" } : l))
    );
  };

  const handleDelete = async (id: string) => {
    await fetcher(`/api/links/${id}`, { method: "DELETE" });
    setLinks((prev) => prev.filter((l) => l.id !== id));
  };

  return (
    <div className="space-y-8">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
            <Sparkles className="h-3.5 w-3.5" />
            AI-powered deadline tracking
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Dashboard</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Every opportunity you save — deadlines extracted, urgency scored, reminders
            scheduled.
          </p>
        </div>
        <div className="glass-card rounded-xl px-4 py-3 text-sm">
          <span className="text-muted-foreground">Next up</span>
          <p className="font-semibold text-primary">
            {stats.upcoming > 0
              ? `${stats.upcoming} upcoming deadline${stats.upcoming === 1 ? "" : "s"}`
              : "Save your first link to get started"}
          </p>
        </div>
      </motion.header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Saved"
          value={stats.total}
          hint="Total opportunities"
          icon={<Bookmark className="h-5 w-5" />}
          accent="primary"
          delay={0}
        />
        <StatCard
          title="Active"
          value={stats.active}
          hint="Being tracked now"
          icon={<Target className="h-5 w-5" />}
          accent="primary"
          delay={0.05}
        />
        <StatCard
          title="Urgent"
          value={stats.urgent}
          hint="Due within 7 days"
          icon={<Flame className="h-5 w-5" />}
          accent="accent"
          delay={0.1}
        />
        <StatCard
          title="Missed"
          value={stats.missed}
          hint="Past deadline"
          icon={<AlertCircle className="h-5 w-5" />}
          accent="destructive"
          delay={0.15}
        />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by title, category, or URL..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="cursor-text border-border/80 bg-card/60 pl-10 backdrop-blur-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTab(f.id)}
              className={cn(
                "cursor-pointer rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-200",
                tab === f.id
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                  : "bg-secondary/80 text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <DashboardEmptyState filtered={Boolean(query) || tab !== "all"} />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            {filtered.length} opportunit{filtered.length === 1 ? "y" : "ies"}
          </div>
          {filtered.map((link, index) => (
            <DeadlineCard
              key={link.id}
              link={link}
              index={index}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  hint,
  icon,
  accent,
  delay,
}: {
  title: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  accent: "primary" | "accent" | "destructive";
  delay: number;
}) {
  const accentClass = {
    primary: "from-primary/20 to-primary/5 text-primary ring-primary/20",
    accent: "from-accent/20 to-accent/5 text-accent ring-accent/20",
    destructive: "from-destructive/20 to-destructive/5 text-destructive ring-destructive/20",
  }[accent];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="glass-card group relative overflow-hidden rounded-2xl p-5 transition-all duration-200 hover:border-primary/25"
    >
      <div
        className={cn(
          "absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gradient-to-br opacity-60 blur-2xl transition-opacity group-hover:opacity-100",
          accent === "primary" && "from-primary/30 to-transparent",
          accent === "accent" && "from-accent/30 to-transparent",
          accent === "destructive" && "from-destructive/30 to-transparent"
        )}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <span
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ring-1",
            accentClass
          )}
        >
          {icon}
        </span>
      </div>
    </motion.div>
  );
}
