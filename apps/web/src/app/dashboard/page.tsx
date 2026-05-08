"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow, cn } from "@/lib/utils";
import { Calendar, Clock, Flame, Archive, Trash2, Search } from "lucide-react";

type SavedLink = {
  id: string;
  url: string;
  title: string;
  extractedDeadline: string | null;
  category: string | null;
  urgencyScore: number | null;
  status: string;
  rollingApplication: boolean;
  estimatedCompletionMinutes: number | null;
  createdAt: string;
};

export default function DashboardPage() {
  const { fetcher } = useApi();
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetcher("/api/links")
      .then((data: SavedLink[]) => setLinks(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [fetcher]);

  const filtered = useMemo(() => {
    if (!query) return links;
    const q = query.toLowerCase();
    return links.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        (l.category || "").toLowerCase().includes(q)
    );
  }, [links, query]);

  const stats = useMemo(() => {
    const total = links.length;
    const active = links.filter((l) => l.status === "active").length;
    const high = links.filter((l) => (l.urgencyScore || 0) >= 7).length;
    const missed = links.filter(
      (l) =>
        l.extractedDeadline &&
        new Date(l.extractedDeadline) < new Date() &&
        l.status !== "archived"
    ).length;
    return { total, active, high, missed };
  }, [links]);

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
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Your saved opportunities and upcoming deadlines.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Saved links" value={stats.total} icon={<Calendar className="h-4 w-4" />} />
        <StatCard title="Active" value={stats.active} icon={<Clock className="h-4 w-4" />} />
        <StatCard title="High urgency" value={stats.high} icon={<Flame className="h-4 w-4 text-orange-400" />} />
        <StatCard title="Missed" value={stats.missed} icon={<Archive className="h-4 w-4 text-red-400" />} />
      </div>

      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search opportunities..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          No opportunities found. Save your first link via the browser extension.
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((link) => (
            <Card key={link.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-semibold">{link.title}</h3>
                  {link.rollingApplication && (
                    <Badge variant="secondary">Rolling</Badge>
                  )}
                  {link.urgencyScore != null && link.urgencyScore >= 7 && (
                    <Badge variant="destructive">Urgent</Badge>
                  )}
                </div>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block truncate text-xs text-muted-foreground hover:text-primary"
                >
                  {link.url}
                </a>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {link.category && <Badge variant="outline">{link.category}</Badge>}
                  {link.extractedDeadline && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(link.extractedDeadline)}
                    </span>
                  )}
                  {link.estimatedCompletionMinutes != null && (
                    <span>~{link.estimatedCompletionMinutes} min</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {link.status !== "archived" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleArchive(link.id)}
                  >
                    Archive
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => handleDelete(link.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
