import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const modKey = isMac ? '\u2318' : 'Ctrl';

const shortcuts = [
  { category: 'Editor', items: [
    { keys: `${modKey}+S`, description: 'Save PRD' },
    { keys: `${modKey}+Shift+E`, description: 'Export as PDF' },
    { keys: `${modKey}+Shift+A`, description: 'Open Dual-AI Assist' },
  ]},
  { category: 'Navigation', items: [
    { keys: `${modKey}+B`, description: 'Toggle sidebar' },
    { keys: `${modKey}+/`, description: 'Show keyboard shortcuts' },
  ]},
];

export function KeyboardShortcutsHelp({ open, onOpenChange }: KeyboardShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {shortcuts.map((group) => (
            <div key={group.category}>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">{group.category}</h4>
              <div className="space-y-1.5">
                {group.items.map((shortcut) => (
                  <div key={shortcut.keys} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/50">
                    <span className="text-sm">{shortcut.description}</span>
                    <kbd className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted border text-xs font-mono text-muted-foreground">
                      {shortcut.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
