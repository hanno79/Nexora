import React from "react";
import { Badge } from "../ui/badge";
import { normalizeModelDisplayName } from "./aiModelSettingsHelpers";

interface AiModelDisplayLabelProps {
  name: string;
  isFree?: boolean;
  providerDisplayName?: string;
  providerColor?: string;
  className?: string;
  textClassName?: string;
}

export function AiModelDisplayLabel({
  name,
  isFree = false,
  providerDisplayName,
  providerColor,
  className,
  textClassName,
}: AiModelDisplayLabelProps) {
  const rootClassName = ["flex min-w-0 items-center gap-2", className].filter(Boolean).join(" ");
  const labelClassName = ["truncate", textClassName].filter(Boolean).join(" ");

  return (
    <span className={rootClassName}>
      <span className={labelClassName}>{normalizeModelDisplayName(name)}</span>
      {isFree && (
        <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
          Free
        </Badge>
      )}
      {providerDisplayName && providerColor && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ backgroundColor: `${providerColor}20`, color: providerColor }}
        >
          {providerDisplayName}
        </span>
      )}
    </span>
  );
}
