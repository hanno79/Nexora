import { Badge } from "@/components/ui/badge";
import { Circle } from "lucide-react";

type Status = 'draft' | 'in-progress' | 'review' | 'completed';

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

const statusConfig = {
  draft: {
    label: 'Draft',
    className: 'bg-muted text-muted-foreground border-muted',
  },
  'in-progress': {
    label: 'In Progress',
    className: 'bg-accent/10 text-accent border-accent/20',
  },
  review: {
    label: 'Review',
    className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/20',
  },
  completed: {
    label: 'Completed',
    className: 'bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20',
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <Badge 
      variant="outline" 
      className={`${config.className} ${className} text-xs font-medium gap-1.5`}
      data-testid={`badge-status-${status}`}
    >
      <Circle className="w-2 h-2 fill-current" />
      {config.label}
    </Badge>
  );
}
