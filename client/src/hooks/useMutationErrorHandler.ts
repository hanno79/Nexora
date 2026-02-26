import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { isUnauthorizedError } from "@/lib/authUtils";
import { getLoginPath } from "@/lib/authRoutes";

/**
 * Returns a reusable onError handler for React Query mutations.
 * Handles auth errors (401 -> redirect to login) and shows a toast for all other errors.
 *
 * Usage:
 *   const onError = useMutationErrorHandler("Failed to save PRD");
 *   const mutation = useMutation({ mutationFn: ..., onError });
 *
 * @param fallbackMessage - Optional message shown when error.message is empty.
 */
export function useMutationErrorHandler(fallbackMessage?: string) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const loginPath = getLoginPath();

  return (error: Error) => {
    if (isUnauthorizedError(error)) {
      toast({
        title: t.auth.unauthorized,
        description: t.auth.loggedOut,
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = loginPath;
      }, 500);
      return;
    }
    toast({
      title: t.common.error,
      description: error.message || fallbackMessage || t.common.error,
      variant: "destructive",
    });
  };
}
