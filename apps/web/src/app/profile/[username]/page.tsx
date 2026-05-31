"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Clock, Lock, UserMinus, UserPlus, Users } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatDeadlineDate,
  formatDistanceToNow,
} from "@/lib/utils";

type ProfileLink = {
  id: string;
  title: string;
  url: string;
  category: string | null;
  extractedDeadline: string | null;
  visibility?: string;
};

type PublicProfile = {
  username: string;
  displayName: string | null;
  bio: string | null;
  profileVisibility: string;
  isPrivate: boolean;
  isSelf: boolean;
  isFollowing: boolean;
  followersCount: number;
  followingCount: number;
  links: ProfileLink[];
};

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { fetcher, publicFetcher } = useApi();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    publicFetcher(`/api/users/${encodeURIComponent(username)}`)
      .then((data: PublicProfile) => {
        setProfile(data);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        if (!options?.silent) setLoading(false);
      });
  };

  useEffect(() => {
    if (username) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const toggleFollow = async () => {
    if (!profile || profile.isSelf) return;
    setFollowLoading(true);
    try {
      const method = profile.isFollowing ? "DELETE" : "POST";
      const res = await fetcher(`/api/users/${profile.username}/follow`, { method });
      setProfile((p) =>
        p
          ? {
              ...p,
              isFollowing: res.isFollowing,
              followersCount: res.followersCount ?? p.followersCount,
              followingCount: res.followingCount ?? p.followingCount,
            }
          : p
      );
      load({ silent: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update follow");
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="theme-skeleton h-12 w-64" />
        <Skeleton className="theme-skeleton h-24 w-full" />
        <Skeleton className="theme-skeleton h-32 w-full" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="water-card rounded-2xl p-8 text-center">
        <p className="text-muted-foreground">{error || "Profile not found"}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/search">Find users</Link>
        </Button>
      </div>
    );
  }

  const display = profile.displayName || profile.username;

  return (
    <div className="space-y-8">
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="water-card rounded-2xl p-6 sm:p-8"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">{display}</h1>
            {profile.bio && (
              <p className="mt-3 max-w-xl text-muted-foreground">{profile.bio}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                {profile.followersCount} followers · {profile.followingCount} following
              </span>
              <Badge variant="outline" className="capitalize">
                {profile.profileVisibility} profile
              </Badge>
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            {profile.isSelf ? (
              <Button asChild>
                <Link href="/settings">Edit profile</Link>
              </Button>
            ) : (
              <Button
                onClick={toggleFollow}
                disabled={followLoading}
                className="gap-2"
                variant={profile.isFollowing ? "outline" : "default"}
              >
                {profile.isFollowing ? (
                  <>
                    <UserMinus className="h-4 w-4" />
                    Unfollow
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Follow
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {profile.isPrivate && (
          <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4 shrink-0" />
            This profile is private. Follow to see their public deadlines.
          </div>
        )}
      </motion.header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">
          {profile.isSelf ? "Your deadlines" : "Public deadlines"}
        </h2>
        {profile.links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {profile.isPrivate && !profile.isSelf
              ? "No visible deadlines yet."
              : "No public deadlines shared yet."}
          </p>
        ) : (
          <div className="space-y-3">
            {profile.links.map((link) => (
              <article key={link.id} className="water-card rounded-2xl p-5">
                <h3 className="font-semibold text-foreground">{link.title}</h3>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block truncate text-sm text-muted-foreground hover:text-foreground"
                >
                  {link.url.replace(/^https?:\/\//, "")}
                </a>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {link.category && (
                    <Badge variant="outline" className="capitalize text-muted-foreground">
                      {link.category}
                    </Badge>
                  )}
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {link.extractedDeadline
                      ? `${formatDistanceToNow(link.extractedDeadline)} · ${formatDeadlineDate(link.extractedDeadline)}`
                      : "Deadline TBD"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
