import { Link } from "wouter";
import { Search, User, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/lib/i18n";

interface TopBarProps {
  onSearchChange?: (value: string) => void;
  searchValue?: string;
}

export function TopBar({ onSearchChange, searchValue }: TopBarProps) {
  const { user } = useAuth();
  const { t } = useTranslation();

  const getInitials = (firstName?: string | null, lastName?: string | null, email?: string | null) => {
    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase();
    }
    if (email) {
      return email.substring(0, 2).toUpperCase();
    }
    return "U";
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center gap-4 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 hover-elevate rounded-md px-3 py-2 -ml-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-gradient-to-br from-primary to-accent">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            NEXORA
          </span>
        </Link>

        {onSearchChange && (
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t.dashboard.searchPlaceholder}
                className="pl-10 h-9"
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                data-testid="input-search"
              />
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="rounded-full"
                data-testid="button-user-menu"
              >
                <Avatar className="w-8 h-8">
                  <AvatarImage 
                    src={user?.profileImageUrl || undefined} 
                    alt={user?.firstName || "User"}
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {getInitials(user?.firstName, user?.lastName, user?.email)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center gap-3 p-2">
                <Avatar className="w-10 h-10">
                  <AvatarImage 
                    src={user?.profileImageUrl || undefined} 
                    alt={user?.firstName || "User"}
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {getInitials(user?.firstName, user?.lastName, user?.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <p className="text-sm font-medium">
                    {user?.firstName && user?.lastName 
                      ? `${user.firstName} ${user.lastName}` 
                      : user?.email}
                  </p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings" className="cursor-pointer" data-testid="link-settings">
                  <User className="mr-2 h-4 w-4" />
                  {t.nav.settings}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="/api/logout" className="cursor-pointer text-destructive" data-testid="link-logout">
                  <LogOut className="mr-2 h-4 w-4" />
                  {t.nav.signOut}
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
