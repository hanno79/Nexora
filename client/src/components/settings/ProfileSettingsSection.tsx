/**
 * Author: rahn
 * Datum: 03.03.2026
 * Version: 1.0
 * Beschreibung: Profil-Einstellungen Sektion
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutationErrorHandler } from "@/hooks/useMutationErrorHandler";
import { useTranslation } from "@/lib/i18n";

interface ProfileSettingsSectionProps {
  user?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    company?: string | null;
    role?: string | null;
  } | null;
}

export function ProfileSettingsSection({ user }: ProfileSettingsSectionProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const onMutationError = useMutationErrorHandler();

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [company, setCompany] = useState(user?.company ?? "");
  const [role, setRole] = useState(user?.role ?? "");

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", "/api/auth/user", {
        firstName,
        lastName,
        company,
        role,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: t.common.success,
        description: t.settings.profileUpdated,
      });
    },
    onError: onMutationError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.profileInformation}</CardTitle>
        <CardDescription>{t.settings.profileDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">{t.settings.firstName}</Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={100}
              data-testid="input-first-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">{t.settings.lastName}</Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={100}
              data-testid="input-last-name"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t.settings.email}</Label>
          <Input
            id="email"
            value={user?.email || ""}
            disabled
            className="bg-muted"
            data-testid="input-email"
          />
          <p className="text-xs text-muted-foreground">
            {t.settings.emailCannotChange}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="company">{t.settings.company}</Label>
            <Input
              id="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={200}
              placeholder={t.settings.companyPlaceholder}
              data-testid="input-company"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">{t.settings.role}</Label>
            <Input
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              maxLength={100}
              placeholder={t.settings.rolePlaceholder}
              data-testid="input-role"
            />
          </div>
        </div>

        <Button
          onClick={() => updateProfileMutation.mutate()}
          disabled={updateProfileMutation.isPending}
          data-testid="button-save-profile"
        >
          <Save className="w-4 h-4 mr-2" />
          {updateProfileMutation.isPending ? t.settings.saving : t.settings.saveProfile}
        </Button>
      </CardContent>
    </Card>
  );
}
