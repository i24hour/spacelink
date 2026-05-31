import { prisma } from "./prisma";

export type ProfileVisibility = "public" | "private";
export type LinkVisibility = "public" | "private";

export async function canViewFullProfile(
  profileUserId: string,
  viewerId: string | null
): Promise<boolean> {
  if (viewerId && viewerId === profileUserId) return true;

  const user = await prisma.user.findUnique({
    where: { id: profileUserId },
    select: { profileVisibility: true },
  });
  if (!user) return false;
  if (user.profileVisibility === "public") return true;
  if (!viewerId) return false;

  const follow = await prisma.follow.findUnique({
    where: {
      followerId_followingId: { followerId: viewerId, followingId: profileUserId },
    },
  });
  return !!follow;
}

export function publicLinkWhere(userId: string) {
  return {
    userId,
    status: "active" as const,
    visibility: "public" as const,
  };
}

export async function getFollowCounts(userId: string) {
  const [followersCount, followingCount] = await Promise.all([
    prisma.follow.count({ where: { followingId: userId } }),
    prisma.follow.count({ where: { followerId: userId } }),
  ]);
  return { followersCount, followingCount };
}

export async function isFollowing(followerId: string, followingId: string) {
  const row = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId, followingId } },
  });
  return !!row;
}
