import { Response, NextFunction } from "express";
import { verifyToken as verifyLocalToken, AuthRequest } from "./auth";
import { clerkClient } from "./clerk";

export { AuthRequest };

export async function universalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Try DeadlineAI JWT first
  const local = verifyLocalToken(token);
  if (local) {
    req.userId = local.sub;
    return next();
  }

  // Fall back to Clerk JWT
  try {
    const session = await clerkClient.verifyToken(token, {});
    if (session?.sub) {
      req.userId = session.sub;
      return next();
    }
  } catch {
    // Not a Clerk token either
  }

  return res.status(401).json({ error: "Invalid token" });
}
