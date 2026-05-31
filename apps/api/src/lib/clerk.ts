import { ClerkExpressRequireAuth, clerkClient as clerkClientInstance } from "@clerk/clerk-sdk-node";
import { getFrontendUrl } from "./frontend-url";

export const clerkAuth = ClerkExpressRequireAuth({
  authorizedParties: [getFrontendUrl(), "http://localhost:3000"],
});

export const clerkClient = clerkClientInstance;
