# NEXORA - AI-Powered PRD Platform

## Overview

NEXORA is a SaaS platform designed to accelerate Product Requirement Document (PRD) creation using AI. It integrates Claude AI for intelligent content generation and Linear for project management, enabling product teams to produce professional PRDs up to 10 times faster. Key capabilities include AI-driven content generation, template-based document creation, version control, multi-format export (PDF, Word, Markdown, CLAUDE.md), direct Linear integration, real-time commenting, approval workflows, and intelligent CLAUDE.md generation for AI development guidelines. The platform aims to streamline the PRD process, enhance collaboration, and improve product development efficiency.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React 18 and TypeScript, using Vite for fast development and optimized builds. Wouter handles client-side routing, and TanStack Query manages server state. The UI utilizes shadcn/ui components (based on Radix UI) and Tailwind CSS for styling, featuring a custom HSL color system and dark/light modes. The design is inspired by Linear, Notion, and Stripe, emphasizing a clean and professional aesthetic. It is fully responsive across mobile, tablet, and desktop viewports, with specific UX considerations for the editor and dashboard. State management primarily uses TanStack Query for server state and React hooks for local component state, avoiding complex global state libraries. The system supports internationalization (i18n) with separate UI and content language settings, allowing users to configure interface language independently from PRD generation language.

### Backend Architecture

The backend runs on Express.js with TypeScript, providing a RESTful API. Authentication is session-based, using Replit OAuth via OpenID Connect (OIDC) and a PostgreSQL-backed session store. Drizzle ORM provides type-safe database interactions with PostgreSQL (Neon serverless driver), following a schema-first design with migrations. The data model includes users, PRDs, templates, versions, shared PRDs, comments, and approvals.

### AI Integration

NEXORA employs a Dual-AI System (HRP-17) primarily through OpenRouter, providing access to over 400 LLM models with tiered configurations (Development, Production, Premium) and an intelligent fallback system. Users can choose between three AI-powered PRD generation workflows:

*   **Simple Mode (Default)**: A single iteration cycle where a Generator creates content, a Reviewer analyzes it, and the Generator refines it.
*   **Iterative Mode (Advanced)**: Multi-iteration refinement (2-5 user-configurable iterations) where a Generator creates content and asks clarifying questions, and an Answerer provides expert responses. An optional Final Reviewer performs a quality check. This mode aims for deep requirement analysis and significant content expansion.
*   **Guided Mode (Interactive)**: A user-involved workflow that asks 3-5 non-technical, feature-focused questions with multiple-choice answers (inspired by Claude Code's question pattern). Users can select from predefined options or provide custom text. The workflow runs up to the user-configured number of question rounds (1-10, default 3, with skip option) and generates a comprehensive PRD incorporating user preferences. Each question is guaranteed to have at least 2 meaningful options plus an "Other" option. Key files: `server/guidedAiService.ts`, `server/guidedAiPrompts.ts`, `client/src/components/GuidedAiDialog.tsx`.

The platform also supports legacy Anthropic Claude AI integration (claude-sonnet-4-20250514) for single-model content generation. AI usage is tracked for cost analysis. Content generation focuses on structured markdown output, context-aware improvements, and template-based scaffolding with professional product management language. All prompts are designed to be feature-focused and non-technical, with testable acceptance criteria for every feature.

### Linear Integration

Integration with Linear uses the @linear/sdk and Replit Connectors for OAuth-based authentication. It allows direct export of PRDs as Linear issues or projects, mapping PRD titles and descriptions. Export mutations automatically invalidate TanStack Query cache to ensure UI reflects updated linkage metadata (linearIssueId, linearIssueUrl).

### Dart AI Integration

Integration with Dart AI enables direct export of PRDs as Dart AI documents for enhanced collaboration and documentation. The integration uses:

*   **Authentication**: Bearer token authentication via `DART_AI_API_KEY` environment variable (stored in Replit Secrets).
    *   Header format: `Authorization: Bearer ${token}` (required despite `dsa_` token prefix)
*   **API Client**: `server/dartHelper.ts` provides `exportToDart()`, `checkDartConnection()`, `getDartDoc()`, and `getDartboards()` functions.
    *   Request format: `{ item: { title, text, folder } }` (uses `item` wrapper object)
    *   Response format: `{ item: { id, htmlUrl, title, folder, text } }`
*   **Backend Routes**: 
    *   `POST /api/dart/export`: Exports PRD to Dart AI with user-selected folder and persists `dartDocId`, `dartDocUrl`, and `dartFolder` to the database.
    *   `GET /api/dart/dartboards`: Fetches available dartboards and folders from user's Dart AI workspace (requires authentication).
    *   `GET /api/dart/status`: Checks Dart AI connection status.
*   **Frontend Integration**: 
    *   Export button in Editor UI (desktop and mobile)
    *   DartExportDialog component with dartboard/folder selection dropdown
    *   Loading states, error handling, and helpful hints for missing dartboards
    *   Connection status display in Settings page
    *   All strings localized via `t.integrations.dart.*` (English/German)
    *   Export mutations automatically invalidate TanStack Query cache to ensure UI reflects updated linkage metadata (dartDocId, dartDocUrl, dartFolder).
*   **Database Fields**: PRDs table includes `dartDocId` (varchar), `dartDocUrl` (varchar), and `dartFolder` (varchar) fields for tracking exported documents and their location.
*   **Dartboard Selection Workflow**: 
    *   User clicks "Export to Dart AI" → DartExportDialog opens
    *   Dialog fetches available folders via `/api/dart/dartboards`
    *   User selects target folder/dartboard from dropdown
    *   Export proceeds with selected folder parameter
    *   If no folders exist, helpful hint guides user to create one in Dart AI
*   **Status**: ✅ Fully functional with dartboard selection workflow (E2E verified November 16, 2025)

The Dart AI integration follows the same architectural pattern as Linear integration, ensuring consistency across external service integrations. The dartboard selection workflow provides organized project structure by allowing users to manually create spaces/dartboards in Dart AI and then select them during export.

### Collaboration Features

*   **Comment System**: Real-time commenting on PRDs with user attribution, timestamps, and optional section-level linking, displayed in an Editor sidebar panel.
*   **Approval Workflow**: A multi-reviewer approval process with status tracking (pending, approved, rejected), reviewer selection, and an audit trail. PRD statuses update automatically based on approval actions.

### Export System

NEXORA supports multi-format export for PRDs:

*   **PDF**: Generated using jsPDF with markdown parsing and formatting.
*   **Word (.docx)**: Generated using the docx library for structured documents.
*   **Markdown**: Plain text download.
*   **CLAUDE.md**: An intelligent generator extracts technical details (tech stack, architecture, APIs, components, user stories) from the PRD to create structured development guidelines for AI agents.

Export functionality is handled server-side, providing binary or JSON responses for download.

### Error Tracking & Monitoring

Frontend errors are captured by `ErrorBoundary` and logged to the backend. The system includes enhanced error handling for external services like OpenRouter, Anthropic Claude, and Linear, providing detailed, actionable messages for common issues such as rate limits, authentication failures, and API errors.

## External Dependencies

### Third-Party Services

*   **Replit Platform**: Replit Auth (OIDC) for user authentication and Replit Connectors for Linear OAuth.
*   **OpenRouter**: Primary AI service for the Dual-AI system, providing access to various LLMs via a single API key (requires `OPENROUTER_API_KEY`).
*   **Anthropic AI**: Legacy AI service for Claude API (requires `ANTHROPIC_API_KEY`).
*   **Linear**: Issue/project management API integrated via Replit Connectors.
*   **Dart AI**: Collaboration and documentation platform integrated via Bearer token authentication (requires `DART_AI_API_KEY`).

### Database

*   **Neon PostgreSQL**: Serverless PostgreSQL database (requires `DATABASE_URL`).

### UI Libraries

*   **@radix-ui/**: Accessible UI primitives.
*   **shadcn/ui**: Component library built on Radix UI.
*   **Tailwind CSS**: Utility-first CSS framework.
*   **date-fns**: Date formatting utilities.
*   **react-hook-form** & **zod**: Form validation.
*   **jspdf**: PDF generation.
*   **docx**: Word document generation.

### Development Tools

*   **TypeScript**: For type safety.
*   **Zod**: Runtime validation.
*   **Drizzle Kit**: Database migrations.
*   **Vite**: Build tool.