import { ClerkExpressRequireAuth, clerkClient as clerkClientInstance } from "@clerk/clerk-sdk-node";

export const clerkAuth = ClerkExpressRequireAuth({
  authorizedParties: [process.env.FRONTEND_URL || "http://localhost:3000"],
});

export const clerkClient = clerkClientInstance;
