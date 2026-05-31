"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Medal, Trophy } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type LeaderboardEntry = {
  username: string;
  displayName: string | null;
  activeLinkCount: number;
  followersCount: number;
};

export default function LeaderboardPage() {
  const { publicFetcher } = useApi();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    publicFetcher("/api/leaderboard")
      .then((data: { leaderboard: LeaderboardEntry[] }) => setEntries(data.leaderboard))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [publicFetcher]);

  return (
    <div className="space-y-8">
      <header>
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="theme-badge mb-3"
        >
          <Trophy className="h-3.5 w-3.5" />
          Site-wide rankings
        </motion.div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Leaderboard</h1>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Top contributors ranked by active tracked links. Only users with public profiles
          appear here.
        </p>
      </header>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="theme-skeleton h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="water-card rounded-2xl p-8 text-center text-muted-foreground">
          No public profiles with active links yet. Set your profile to public and save
          links to appear here.
        </div>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry, index) => (
            <motion.li
              key={entry.username}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04 }}
            >
              <Link
                href={`/profile/${entry.username}`}
                className="water-card flex cursor-pointer items-center gap-4 rounded-2xl p-4 transition-colors hover:bg-muted/50"
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold",
                    index === 0 && "bg-primary text-primary-foreground",
                    index === 1 && "bg-primary/80 text-primary-foreground",
                    index === 2 && "bg-primary/50 text-primary-foreground",
                    index > 2 && "bg-muted text-muted-foreground"
                  )}
                >
                  {index < 3 ? <Medal className="h-5 w-5" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">
                    {entry.displayName || entry.username}
                  </p>
                  <p className="text-sm text-muted-foreground">@{entry.username}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium text-foreground">{entry.activeLinkCount} links</p>
                  <p className="text-muted-foreground">{entry.followersCount} followers</p>
                </div>
              </Link>
            </motion.li>
          ))}
        </ol>
      )}
    </div>
  );
}
