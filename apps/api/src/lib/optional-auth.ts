import { Response, NextFunction } from "express";
import { clerkClient } from "./clerk";
import { verifyToken as verifyLocalToken } from "./auth";
import { AuthRequest } from "./auth";

export async function optionalUniversalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) return next();

  const local = verifyLocalToken(token);
  if (local) {
    req.userId = local.sub;
    return next();
  }

  try {
    const session = await clerkClient.verifyToken(token, {});
    if (session?.sub) {
      req.userId = session.sub;
    }
  } catch {
    // ignore invalid optional token
  }

  return next();
}
