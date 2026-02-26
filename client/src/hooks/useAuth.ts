import { useQuery } from "@tanstack/react-query";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import type { User } from "@shared/schema";
import { getQueryFn } from "@/lib/queryClient";
import { hasClerkFrontendConfig } from "@/lib/authRoutes";

const CLERK_FRONTEND_ENABLED = hasClerkFrontendConfig();

function useClerkBackedAuth() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const {
    data: user,
    isLoading: isUserLoading,
  } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: isLoaded && !!isSignedIn,
    retry: false,
    refetchOnMount: "always",
  });

  return {
    user: user ?? undefined,
    isLoading: !isLoaded || (!!isSignedIn && isUserLoading),
    isAuthenticated: !!isSignedIn,
  };
}

function useLegacyApiAuth() {
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  return {
    user: user ?? undefined,
    isLoading,
    isAuthenticated: !!user,
  };
}

export function useAuth() {
  return CLERK_FRONTEND_ENABLED ? useClerkBackedAuth() : useLegacyApiAuth();
}
