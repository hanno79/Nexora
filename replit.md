# NEXORA - AI-Powered PRD Platform

## Overview

NEXORA is a modern SaaS platform for creating Product Requirement Documents (PRDs) with AI assistance. The platform combines intelligent content generation using Claude AI with seamless Linear integration, enabling product teams to create professional PRDs 10x faster. Key features include AI-powered content generation, template-based document creation, version control, multi-format export (PDF, Word, Markdown), direct Linear integration for issue/project management, real-time commenting system, and approval workflow for PRD review and sign-off.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build Tools**
- React 18 with TypeScript for type-safe component development
- Vite as the build tool for fast development and optimized production builds
- Wouter for lightweight client-side routing
- TanStack Query (React Query) for server state management and caching

**UI Component System**
- shadcn/ui components built on Radix UI primitives for accessible, composable UI
- Tailwind CSS for utility-first styling with custom design tokens
- Custom color system supporting dark/light modes with HSL color values
- Design inspired by Linear, Notion, and Stripe for a clean, professional aesthetic

**State Management Strategy**
- Server state managed through TanStack Query with infinite stale time
- Authentication state centralized through `useAuth` hook
- Local component state using React hooks
- No global client state management library (avoiding Redux/Zustand complexity)

### Backend Architecture

**Server Framework**
- Express.js server with TypeScript
- Session-based authentication using express-session with PostgreSQL store
- RESTful API design with JSON responses
- Development mode uses Vite middleware for HMR

**Authentication System**
- Replit OAuth integration via OpenID Connect (OIDC)
- Session management with PostgreSQL-backed session store (connect-pg-simple)
- Protected routes using `isAuthenticated` middleware
- User profile management with onboarding flow

**Database Layer**
- Drizzle ORM for type-safe database operations
- PostgreSQL via Neon serverless driver with WebSocket support
- Schema-first design with migrations in `/migrations` directory
- Tables: users, sessions, prds, templates, prdVersions, sharedPrds, comments, approvals

**Data Model Design**
- Users: Core authentication and profile information
- PRDs: Documents with title, description, content (JSON), status (draft, in-progress, review, pending-approval, approved, completed), template reference
- Templates: Reusable PRD structures (feature, epic, technical, product-launch categories)
- PRD Versions: Complete version history with snapshot content
- Shared PRDs: Team collaboration with permission levels
- Comments: Discussion threads on PRDs with user attribution, timestamps, and optional section linking
- Approvals: Workflow management with requester, reviewers list, status tracking, and completion audit trail

### AI Integration

**Claude AI Integration**
- Anthropic SDK for content generation
- Uses claude-sonnet-4-20250514 model (latest as of implementation)
- System prompt optimized for professional PRD content generation
- Supports both new content creation and iterative improvement
- 4000 token max output for comprehensive PRD sections

**Content Generation Strategy**
- Structured markdown output with proper headings and organization
- Context-aware improvements using existing content
- Template-based scaffolding combined with AI enhancement
- Professional PM language and actionable requirements focus

### Linear Integration

**Architecture**
- Linear SDK (@linear/sdk) for API interactions
- OAuth-based authentication via Replit Connectors
- Automatic token refresh when expired
- Direct export of PRDs as Linear issues/projects

**Implementation Pattern**
- Uncached client instances (tokens expire, must be recreated per request)
- Connection status checking before operations
- Title and description mapping from PRD to Linear issue

### Collaboration Features

**Comment System**
- Real-time commenting on PRDs with user attribution
- CommentsPanel component in Editor sidebar showing threaded discussions
- User avatars, timestamps with relative formatting (via date-fns)
- Optional section-level comments for inline discussions
- API endpoints: GET/POST /api/prds/:id/comments with user info enrichment

**Approval Workflow**
- Multi-reviewer approval requests with status tracking
- ApprovalDialog for reviewer selection and approval management
- Status states: pending, approved, rejected
- Automatic PRD status updates (pending-approval → approved/review)
- Reviewer authorization checks ensuring only designated reviewers can respond
- Complete audit trail with requester, reviewers, completion timestamps
- API endpoints: GET /api/prds/:id/approval, POST /api/prds/:id/approval/request, POST /api/prds/:id/approval/respond

### Export System

**Multi-Format Export**
- PDF export using jsPDF library with markdown parsing and proper formatting
- Word (.docx) export using docx library with structured document generation
- Markdown export as plain text download
- Export dropdown in Editor toolbar with all format options

**Export Architecture**
- Backend: POST /api/prds/:id/export endpoint handling all formats
- PDF/Word: Binary responses with appropriate MIME types and Content-Disposition headers
- Markdown: JSON response with content field
- Frontend: Blob creation and automatic download via temporary anchor elements
- Server-side utilities in exportUtils.ts for PDF/Word generation

**Content Processing**
- Markdown parsing for headings (H1, H2, H3), bullet points, and paragraphs
- Automatic page breaks in PDF generation
- Proper document structure in Word exports with heading levels
- Title and description formatting with distinct styling

## External Dependencies

### Third-Party Services

**Replit Platform**
- Replit Auth (OIDC) for user authentication
- Replit Connectors for Linear OAuth integration
- Environment variables: REPL_ID, REPL_IDENTITY, WEB_REPL_RENEWAL
- Development-only plugins: cartographer, dev-banner, runtime-error-modal

**Anthropic AI**
- Claude API for PRD content generation
- Requires ANTHROPIC_API_KEY environment variable
- Model: claude-sonnet-4-20250514

**Linear**
- Linear API for issue/project management
- OAuth authentication managed through Replit Connectors
- Requires Linear connector to be configured in Replit

### Database

**Neon PostgreSQL**
- Serverless PostgreSQL with WebSocket support
- Requires DATABASE_URL environment variable
- Connection pooling via @neondatabase/serverless
- Session storage table required for authentication

### UI Libraries

**Core UI Framework**
- @radix-ui/* components for accessible primitives (20+ component packages)
- shadcn/ui configuration with "new-york" style preset
- Tailwind CSS with custom design system variables
- Inter font for UI, JetBrains Mono for code content

**Supporting Libraries**
- date-fns for date formatting
- react-hook-form with zod resolvers for form validation
- cmdk for command palette patterns
- class-variance-authority for component variants
- jspdf for PDF document generation
- docx for Word document generation

### Development Tools

**Type Safety & Validation**
- TypeScript with strict mode enabled
- Zod for runtime validation and schema inference
- Drizzle Kit for database migrations and schema management

**Build & Development**
- Vite with React plugin
- tsx for TypeScript execution in development
- esbuild for production server bundling
- PostCSS with Tailwind CSS and Autoprefixer