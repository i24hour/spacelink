import crypto from "crypto";
import { Response, NextFunction } from "express";
import { prisma } from "./prisma";
import { AuthRequest, verifyMobileToken } from "./auth";

export interface MobileAuthRequest extends AuthRequest {
  mobileDeviceId?: string;
}

export function hashMobileToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function mobileAuth(
  req: MobileAuthRequest,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const decoded = token ? verifyMobileToken(token) : null;

  if (!decoded) return res.status(401).json({ error: "Invalid mobile token" });

  const device = await prisma.mobileDevice.findFirst({
    where: {
      id: decoded.deviceId,
      userId: decoded.sub,
      tokenHash: hashMobileToken(token),
      revokedAt: null,
    },
    select: { id: true },
  });

  if (!device) return res.status(401).json({ error: "Mobile device is revoked" });

  req.userId = decoded.sub;
  req.mobileDeviceId = device.id;
  void prisma.mobileDevice
    .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
  next();
}
