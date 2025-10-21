import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Save, Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TopBar } from "@/components/TopBar";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useAuth } from "@/hooks/useAuth";

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
      setCompany(user.company || "");
      setRole(user.role || "");
    }
  }, [user]);

  const { data: linearStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/linear/status"],
  });

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
        title: "Success",
        description: "Profile updated successfully",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      
      <div className="container max-w-4xl mx-auto px-4 md:px-6 py-8">
        <h1 className="text-3xl font-semibold mb-8">Settings</h1>

        <div className="space-y-6">
          {/* Profile Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Update your personal information and preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    data-testid="input-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    data-testid="input-last-name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={user?.email || ""}
                  disabled
                  className="bg-muted"
                  data-testid="input-email"
                />
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company">Company</Label>
                  <Input
                    id="company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Optional"
                    data-testid="input-company"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role</Label>
                  <Input
                    id="role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="e.g., Product Manager"
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
                {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </CardContent>
          </Card>

          {/* Linear Integration */}
          <Card>
            <CardHeader>
              <CardTitle>Linear Integration</CardTitle>
              <CardDescription>
                Connect your Linear workspace to export PRDs as issues
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                    <Link2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Linear Workspace</p>
                    <p className="text-sm text-muted-foreground">
                      {linearStatus?.connected ? "Connected" : "Not connected"}
                    </p>
                  </div>
                </div>
                {linearStatus?.connected ? (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
                    <Check className="w-5 h-5" />
                    <span className="text-sm font-medium">Connected</span>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" disabled data-testid="button-connect-linear">
                    Configure
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Linear integration is pre-configured. You can export PRDs directly from the editor.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
