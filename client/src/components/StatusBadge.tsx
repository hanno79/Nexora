import { Badge } from "@/components/ui/badge";
import { Circle } from "lucide-react";

type Status = 'draft' | 'in-progress' | 'review' | 'pending-approval' | 'approved' | 'completed';

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

const statusConfig: Record<Status, { label: string; className: string }> = {
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
  'pending-approval': {
    label: 'Pending Approval',
    className: 'bg-orange-500/10 text-orange-600 dark:text-orange-500 border-orange-500/20',
  },
  approved: {
    label: 'Approved',
    className: 'bg-blue-500/10 text-blue-600 dark:text-blue-500 border-blue-500/20',
  },
  completed: {
    label: 'Completed',
    className: 'bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20',
  },
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = statusConfig[status];
  
  // Fallback if status is not recognized
  if (!config) {
    return (
      <Badge 
        variant="outline" 
        className={`${className} text-xs font-medium gap-1.5`}
        data-testid={`badge-status-${status}`}
      >
        <Circle className="w-2 h-2 fill-current" />
        {status}
      </Badge>
    );
  }
  
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
