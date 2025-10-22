/**
 * CLAUDE.md Generator
 * Generates AI-readable development guidelines from PRD content
 */

interface PRDData {
  title: string;
  description?: string;
  content: string;
}

interface GeneratedClaudeMD {
  content: string;
  techStack: string[];
  hasArchitecture: boolean;
  hasAPIs: boolean;
  hasComponents: boolean;
}

/**
 * Extract tech stack mentions from PRD content
 */
function extractTechStack(content: string): string[] {
  const techKeywords: Record<string, string[]> = {
    frontend: ['react', 'vue', 'angular', 'next.js', 'vite', 'typescript', 'javascript', 'tailwind', 'css', 'html', 'svelte'],
    backend: ['node.js', 'express', 'fastify', 'nest.js', 'python', 'django', 'flask', 'ruby', 'rails', 'java', 'spring', 'go', 'rust'],
    database: ['postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'sqlite', 'supabase', 'firebase', 'prisma', 'drizzle'],
    mobile: ['react native', 'flutter', 'swift', 'kotlin', 'ios', 'android'],
    cloud: ['aws', 'azure', 'gcp', 'vercel', 'netlify', 'cloudflare', 'docker', 'kubernetes'],
    ai: ['openai', 'anthropic', 'claude', 'gpt', 'langchain', 'vector database', 'embeddings'],
  };

  const found = new Set<string>();
  const lowerContent = content.toLowerCase();

  for (const category of Object.values(techKeywords)) {
    for (const tech of category) {
      if (lowerContent.includes(tech)) {
        found.add(tech.charAt(0).toUpperCase() + tech.slice(1));
      }
    }
  }

  return Array.from(found);
}

/**
 * Extract API endpoints from PRD content
 */
function extractAPIs(content: string): string[] {
  const apis: string[] = [];
  
  // Match REST API patterns: GET /api/..., POST /api/..., etc.
  const restPattern = /(GET|POST|PUT|DELETE|PATCH)\s+(\/[\w\/-]+)/gi;
  const matches = Array.from(content.matchAll(restPattern));
  
  for (const match of matches) {
    apis.push(`${match[1]} ${match[2]}`);
  }

  // Match API endpoint descriptions
  const endpointPattern = /(?:endpoint|route|api):\s*([\/\w-]+)/gi;
  const endpointMatches = Array.from(content.matchAll(endpointPattern));
  
  for (const match of endpointMatches) {
    if (!apis.some(api => api.includes(match[1]))) {
      apis.push(match[1]);
    }
  }

  return apis;
}

/**
 * Extract component names from PRD content
 */
function extractComponents(content: string): string[] {
  const components: string[] = [];
  
  // Match React/Vue component patterns: <ComponentName>, ComponentName.tsx, etc.
  const componentPattern = /<([A-Z][a-zA-Z]+)>|([A-Z][a-zA-Z]+)(?:Component|Page|View|Dialog|Modal|Panel)/g;
  const matches = Array.from(content.matchAll(componentPattern));
  
  for (const match of matches) {
    const component = match[1] || match[2];
    if (component && !components.includes(component)) {
      components.push(component);
    }
  }

  return components;
}

/**
 * Extract user stories from PRD content
 */
function extractUserStories(content: string): string[] {
  const stories: string[] = [];
  
  // Match "As a ... I want ... so that ..." pattern
  const storyPattern = /As\s+a[n]?\s+([^,]+),?\s+I\s+want\s+([^,]+),?\s+so\s+that\s+([^.\n]+)/gi;
  const matches = Array.from(content.matchAll(storyPattern));
  
  for (const match of matches) {
    stories.push(match[0].trim());
  }

  return stories;
}

/**
 * Extract requirements from PRD content
 */
function extractRequirements(content: string): string[] {
  const requirements: string[] = [];
  const lines = content.split('\n');
  
  let inRequirementsSection = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Detect requirements section
    if (trimmed.match(/^#{1,3}\s+(Requirements|Functional Requirements|Technical Requirements)/i)) {
      inRequirementsSection = true;
      continue;
    }
    
    // Exit requirements section on next heading
    if (inRequirementsSection && trimmed.match(/^#{1,3}\s+/)) {
      inRequirementsSection = false;
    }
    
    // Extract bullet points in requirements section
    if (inRequirementsSection && trimmed.match(/^[-*]\s+/)) {
      requirements.push(trimmed.replace(/^[-*]\s+/, ''));
    }
    
    // Also match MUST/SHOULD patterns anywhere
    if (trimmed.match(/^[-*]\s+(MUST|SHOULD|SHALL)/i)) {
      if (!requirements.includes(trimmed.replace(/^[-*]\s+/, ''))) {
        requirements.push(trimmed.replace(/^[-*]\s+/, ''));
      }
    }
  }

  return requirements;
}

/**
 * Extract security considerations
 */
function extractSecurity(content: string): string[] {
  const security: string[] = [];
  const lowerContent = content.toLowerCase();
  
  const securityKeywords = [
    'authentication', 'authorization', 'encryption', 'security',
    'privacy', 'gdpr', 'compliance', 'access control',
    'oauth', 'jwt', 'api key', 'rate limiting'
  ];

  const lines = content.split('\n');
  
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const keyword of securityKeywords) {
      if (lower.includes(keyword) && line.trim().match(/^[-*]/)) {
        security.push(line.trim().replace(/^[-*]\s+/, ''));
        break;
      }
    }
  }

  return security;
}

/**
 * Generate CLAUDE.md content from PRD
 */
export function generateClaudeMD(prd: PRDData): GeneratedClaudeMD {
  const techStack = extractTechStack(prd.content);
  const apis = extractAPIs(prd.content);
  const components = extractComponents(prd.content);
  const userStories = extractUserStories(prd.content);
  const requirements = extractRequirements(prd.content);
  const security = extractSecurity(prd.content);

  let content = `# ${prd.title} - Development Guidelines

## Project Overview

${prd.description || 'No description provided'}

**Generated from PRD**: This document provides AI-readable development guidelines extracted from the Product Requirements Document.

---

## Project Context

This document serves as a guide for AI assistants (like Claude) to help develop this feature. It extracts key technical details, requirements, and patterns from the PRD to ensure consistent implementation.

`;

  // Tech Stack Section
  if (techStack.length > 0) {
    content += `## Technology Stack

The following technologies were mentioned in the PRD:

`;
    techStack.forEach(tech => {
      content += `- ${tech}\n`;
    });
    content += '\n';
  } else {
    content += `## Technology Stack

⚠️ **No specific technologies mentioned** in the PRD. Consider defining:
- Frontend framework (React, Vue, etc.)
- Backend framework (Express, FastAPI, etc.)
- Database (PostgreSQL, MongoDB, etc.)
- Hosting platform (AWS, Vercel, etc.)

`;
  }

  // User Stories Section
  if (userStories.length > 0) {
    content += `## User Stories

The PRD defines the following user stories:

`;
    userStories.forEach((story, i) => {
      content += `${i + 1}. ${story}\n`;
    });
    content += `
**Development Guidance**: Implement features that directly address these user stories. Each story should map to testable functionality.

`;
  }

  // Requirements Section
  if (requirements.length > 0) {
    content += `## Functional Requirements

`;
    requirements.forEach((req, i) => {
      content += `${i + 1}. ${req}\n`;
    });
    content += `
**Implementation Notes**: These requirements are mandatory. Ensure each is implemented and tested.

`;
  }

  // API Endpoints Section
  if (apis.length > 0) {
    content += `## API Endpoints

The following API endpoints were identified:

\`\`\`
`;
    apis.forEach(api => {
      content += `${api}\n`;
    });
    content += `\`\`\`

**Development Guidelines**:
- Follow RESTful conventions
- Implement proper error handling (4xx, 5xx status codes)
- Add request validation
- Document with OpenAPI/Swagger if applicable
- Include authentication/authorization where needed

`;
  }

  // Components Section
  if (components.length > 0) {
    content += `## UI Components

The following components were mentioned:

`;
    components.forEach(comp => {
      content += `- \`${comp}\`: [Component purpose - extract from PRD context]\n`;
    });
    content += `
**Component Guidelines**:
- Use TypeScript for type safety
- Follow accessibility best practices (ARIA labels, keyboard navigation)
- Implement responsive design
- Add loading and error states
- Write component tests

`;
  }

  // Security Section
  if (security.length > 0) {
    content += `## Security & Privacy

`;
    security.forEach(item => {
      content += `- ${item}\n`;
    });
    content += `
**Security Checklist**:
- [ ] Input validation and sanitization
- [ ] Authentication and authorization
- [ ] Secure data transmission (HTTPS)
- [ ] Environment variables for secrets
- [ ] Rate limiting on APIs
- [ ] CSRF protection
- [ ] SQL injection prevention

`;
  }

  // Development Best Practices
  content += `## Development Best Practices

### Code Quality
- Write clean, self-documenting code
- Follow consistent naming conventions
- Add comments for complex logic
- Keep functions small and focused
- Use meaningful variable names

### Testing Strategy
- Write unit tests for business logic
- Add integration tests for API endpoints
- Include end-to-end tests for critical user flows
- Test edge cases and error scenarios
- Aim for >80% code coverage where practical

### Git Workflow
- Use feature branches
- Write descriptive commit messages
- Keep commits atomic and focused
- Request code reviews before merging
- Maintain a clean git history

### Performance Considerations
- Optimize database queries (use indexes, avoid N+1)
- Implement caching where appropriate
- Lazy load heavy resources
- Monitor bundle size for frontend
- Profile and optimize hot paths

`;

  // Architecture Guidance
  content += `## Architecture Guidance

### Folder Structure
\`\`\`
src/
├── components/     # Reusable UI components
├── pages/          # Page components
├── lib/            # Utility functions and helpers
├── hooks/          # Custom React hooks
├── api/            # API route handlers
├── types/          # TypeScript type definitions
└── styles/         # Global styles and themes
\`\`\`

### Design Patterns
- **Component Composition**: Break down UI into reusable components
- **State Management**: Use appropriate state management (Context, Zustand, etc.)
- **Error Boundaries**: Wrap components to catch and handle errors gracefully
- **Loading States**: Show spinners/skeletons during async operations
- **Optimistic Updates**: Update UI before server confirmation for better UX

`;

  // Full PRD Content
  content += `## Full PRD Content

For complete context, refer to the original PRD below:

---

${prd.content}

---

## AI Assistant Guidelines

When implementing this feature:

1. **Read the PRD carefully** - Understand the business goals and user needs
2. **Ask clarifying questions** - If requirements are ambiguous, ask before implementing
3. **Follow the tech stack** - Use the technologies mentioned in the PRD
4. **Implement incrementally** - Build in small, testable pieces
5. **Prioritize requirements** - Focus on MUST-haves before SHOULD-haves
6. **Write tests** - Ensure functionality works as expected
7. **Document decisions** - Explain non-obvious implementation choices
8. **Consider edge cases** - Handle errors, empty states, and boundary conditions

## Questions to Consider

Before implementing, ensure you can answer:

- What problem does this feature solve?
- Who are the primary users?
- What are the critical user flows?
- What are the technical constraints?
- How will this integrate with existing systems?
- What are the performance requirements?
- How will we measure success?

---

**Generated by NEXORA** - AI-Powered PRD Platform
*This CLAUDE.md file was automatically generated from the PRD to assist AI development tools.*
`;

  return {
    content,
    techStack,
    hasArchitecture: apis.length > 0 || components.length > 0,
    hasAPIs: apis.length > 0,
    hasComponents: components.length > 0,
  };
}
