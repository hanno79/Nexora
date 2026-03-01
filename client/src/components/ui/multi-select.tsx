"use client"

import * as React from "react"
import { Check, ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"

export interface MultiSelectOption {
  value: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
}

interface MultiSelectProps {
  options: MultiSelectOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  label: string
  allLabel?: string
  className?: string
  "data-testid"?: string
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Auswählen...",
  label,
  allLabel = "Alle",
  className,
  "data-testid": dataTestId,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)

  const toggleOption = (value: string) => {
    const newSelected = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]
    onChange(newSelected)
  }

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  const displayText = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label || placeholder
      : `${label} (${selected.length})`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-10 justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-sm font-medium hover:bg-muted/80",
            selected.length > 0 && "bg-background",
            className
          )}
          data-testid={dataTestId}
        >
          <span className="truncate">{displayText}</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {selected.length > 0 && (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-xs font-medium"
                onClick={clearSelection}
              >
                {selected.length}
                <X className="ml-1 h-3 w-3" />
              </Badge>
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {options.map((option) => {
            const Icon = option.icon
            const isSelected = selected.includes(option.value)
            return (
              <label
                key={option.value}
                className={cn(
                  "flex items-center gap-2 cursor-pointer py-2 px-2 rounded-sm text-sm",
                  "hover:bg-accent hover:text-accent-foreground",
                  "transition-colors"
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleOption(option.value)}
                  className="border-muted-foreground"
                />
                {Icon && <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                <span className="truncate">{option.label}</span>
                {isSelected && (
                  <Check className="ml-auto h-4 w-4 text-primary flex-shrink-0" />
                )}
              </label>
            )
          })}
        </div>
        {selected.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2 text-sm font-medium"
            onClick={() => onChange([])}
          >
            {allLabel}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
