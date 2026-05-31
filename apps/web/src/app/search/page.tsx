"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type SearchUser = {
  username: string;
  displayName: string | null;
  bio: string | null;
  profileVisibility: string;
};

export default function SearchPage() {
  const searchParams = useSearchParams();
  const { publicFetcher } = useApi();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      publicFetcher(`/api/users/search?q=${encodeURIComponent(q)}`)
        .then((data: { users: SearchUser[] }) => setResults(data.users))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [query, publicFetcher]);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Find people</h1>
        <p className="mt-1 text-sm text-muted-foreground">Search by username</p>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search username..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="theme-input pl-10"
          autoFocus
        />
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="theme-skeleton h-14 w-full" />
          <Skeleton className="theme-skeleton h-14 w-full" />
        </div>
      )}

      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No users found for &quot;{query}&quot;</p>
      )}

      <ul className="space-y-2">
        {results.map((user) => (
          <li key={user.username}>
            <Link
              href={`/profile/${user.username}`}
              className="water-card block rounded-xl p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {user.displayName || user.username}
                  </p>
                  <p className="text-sm text-muted-foreground">@{user.username}</p>
                  {user.bio && (
                    <p className="mt-1 truncate text-sm text-muted-foreground">{user.bio}</p>
                  )}
                </div>
                <Badge variant="outline" className="shrink-0 capitalize">
                  {user.profileVisibility}
                </Badge>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
