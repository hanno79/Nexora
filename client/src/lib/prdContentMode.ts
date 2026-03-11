const DEFAULT_TEMPLATE_PLACEHOLDERS = new Set([
  'brief description of the feature',
  'what we aim to achieve',
  'as a [user], i want [goal] so that [benefit]',
  'functional and non-functional requirements',
  'how we measure success',
  'key milestones and deadlines',
  'high-level overview of the epic',
  'long-term vision and strategic alignment',
  "what's included and what's not",
  'breakdown of individual features',
  'team and technical dependencies',
  'kpis and success criteria',
  'phased delivery plan',
  "technical problem we're solving",
  'technical approach and architecture',
  'system design and components',
  'detailed technical specifications',
  "how we'll validate the solution",
  'scalability and optimization',
  'deployment strategy',
  "what we're launching and why",
  "who we're building for",
  'unique value and competitive advantage',
  'complete feature list',
  'marketing and launch plan',
  'launch kpis and goals',
  'launch schedule',
  'potential issues and solutions',
]);

function normalizeValue(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isTemplateSectionArray(value: unknown): value is Array<{ title?: unknown; content?: unknown }> {
  return Array.isArray(value) && value.every(entry => typeof entry === 'object' && entry !== null);
}

export function isTemplateScaffoldContent(content: string): boolean {
  const trimmed = String(content || '').trim();
  if (!trimmed) return false;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const sections = isTemplateSectionArray((parsed as any)?.sections)
        ? (parsed as any).sections
        : isTemplateSectionArray(parsed)
          ? parsed
          : null;

      if (sections && sections.length >= 3) {
        const placeholderMatches = sections.filter((section: { title?: unknown; content?: unknown }) =>
          DEFAULT_TEMPLATE_PLACEHOLDERS.has(normalizeValue(String(section?.content || '')))
        ).length;
        return placeholderMatches >= Math.max(3, Math.ceil(sections.length * 0.7));
      }
    } catch {
      // Non-JSON editor content falls through to markdown/text heuristics.
    }
  }

  const normalized = normalizeValue(trimmed);
  const markdownPlaceholderHits = Array.from(DEFAULT_TEMPLATE_PLACEHOLDERS)
    .filter(placeholder => normalized.includes(placeholder))
    .length;

  return markdownPlaceholderHits >= 3;
}

export function hasMeaningfulPrdContent(content: string): boolean {
  const trimmed = String(content || '').trim();
  if (!trimmed) return false;
  return !isTemplateScaffoldContent(trimmed);
}
