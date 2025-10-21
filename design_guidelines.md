# NEXORA Platform - Design Guidelines

## Design Approach

**Reference-Based Design** drawing from:
- **Primary**: Linear - Clean, modern productivity aesthetic with precise typography and subtle interactions
- **Secondary**: Notion - Content-focused layouts with clear hierarchy and spacious editing areas
- **Tertiary**: Stripe - Restrained color usage and professional polish

**Design Principles:**
- **Precision First**: Clear hierarchy, generous whitespace, and purposeful layouts
- **Speed Perception**: Minimal animations, instant feedback, optimistic UI updates
- **Intelligence Indicators**: Subtle AI suggestions without overwhelming the interface
- **Professional Trust**: Clean, polished aesthetic that conveys reliability

---

## Core Design Elements

### A. Color Palette

**Dark Mode (Primary)**
- Background: 220 15% 8% (Deep slate, professional)
- Surface: 220 15% 12% (Elevated cards/panels)
- Border: 220 10% 18% (Subtle separation)
- Text Primary: 220 5% 95% (High contrast white)
- Text Secondary: 220 5% 65% (Muted gray)

**Light Mode**
- Background: 0 0% 100% (Pure white)
- Surface: 220 15% 98% (Slight warm gray)
- Border: 220 10% 92% (Subtle borders)
- Text Primary: 220 15% 10% (Near black)
- Text Secondary: 220 10% 45% (Medium gray)

**Brand Colors**
- Primary: 250 75% 60% (Vibrant purple - represents "Oracle" intelligence)
- Primary Hover: 250 75% 55%
- Success: 142 76% 45% (Green for completion)
- Warning: 38 92% 50% (Amber for review status)
- Accent: 200 85% 55% (Cyan for AI highlights)

### B. Typography

**Font Stack:**
- Primary: Inter (clean, modern sans-serif for UI)
- Editor: System UI Stack (native feel for content editing)
- Code: JetBrains Mono (for technical content)

**Scale:**
- Display (Hero): text-5xl font-bold (48px)
- H1: text-3xl font-semibold (30px)
- H2: text-2xl font-semibold (24px)
- H3: text-xl font-medium (20px)
- Body: text-base (16px)
- Small: text-sm (14px)
- Micro: text-xs (12px)

**Weights:**
- Regular: 400 (body text)
- Medium: 500 (labels, buttons)
- Semibold: 600 (headings, emphasis)
- Bold: 700 (rare, only for strong emphasis)

### C. Layout System

**Spacing Primitives:**
Core units: 2, 4, 6, 8, 12, 16, 24 (Tailwind scale)
- Tight spacing: gap-2, p-2 (8px) - buttons, badges
- Standard spacing: gap-4, p-4 (16px) - cards, forms
- Generous spacing: gap-6, p-6 (24px) - sections
- Major spacing: gap-8, py-12 (48px) - page sections

**Grid System:**
- Dashboard: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 for PRD cards
- Editor: Single column max-w-4xl for optimal reading
- Settings: 2-column layout (sidebar + content)

**Container Widths:**
- Full width: max-w-7xl (dashboard, lists)
- Content width: max-w-4xl (editor, forms)
- Narrow: max-w-2xl (authentication, onboarding)

### D. Component Library

**Navigation**
- Top bar: Sticky header with logo, search, profile (h-14, bg-surface, border-b)
- Sidebar: Collapsible navigation (w-64 expanded, w-16 collapsed)
- Breadcrumbs: For editor navigation (text-sm, text-secondary)

**Cards & Panels**
- PRD Cards: Rounded corners (rounded-lg), subtle shadow, hover elevation
- Editor Panel: Full-height, minimal borders, focus on content
- Status badges: Small, rounded-full, color-coded (draft=gray, in-progress=blue, review=amber, completed=green)

**Forms**
- Input fields: Consistent height (h-10), rounded-md, border on focus
- Labels: text-sm font-medium mb-2
- Validation: Inline error messages (text-red-500 text-xs)
- AI suggestions: Floating panel with subtle glow effect

**Buttons**
- Primary: bg-primary hover:bg-primary-hover, rounded-md, h-10
- Secondary: variant="outline", transparent bg with border
- Ghost: variant="ghost" for tertiary actions
- Icon buttons: Square (w-10 h-10), rounded-md

**Editor Components**
- Toolbar: Sticky top bar with formatting options (bold, italic, headings)
- AI assist button: Floating bottom-right with gradient glow
- Version indicator: Small badge showing last save time
- Template selector: Grid of cards with preview thumbnails

**Data Display**
- Tables: Minimal borders, row hover states, sortable headers
- Empty states: Centered with illustration + CTA
- Loading states: Skeleton loaders matching content structure

**Modals & Overlays**
- Dialog: Centered, max-w-2xl, backdrop blur
- Drawer: Slide from right for settings/properties
- Tooltips: Small, rounded, subtle shadow

### E. Animations

**Minimal & Purposeful:**
- Page transitions: None (instant navigation)
- Hover states: Only opacity/color changes (no transforms)
- Modal entry: Fade + subtle scale (duration-200)
- AI suggestions: Gentle slide-in from bottom
- Success feedback: Brief checkmark animation

**Avoid:**
- Loading spinners (use skeleton loaders)
- Elaborate transitions
- Scroll-triggered animations

---

## Page-Specific Guidelines

### Authentication Pages
- Centered card (max-w-md) on neutral background
- NEXORA logo at top
- Single column form with clear CTAs
- Social login buttons with icons
- Minimal illustration or gradient background

### Dashboard
- Top bar with search, filters, new PRD button
- Grid of PRD cards (3 columns desktop, 1 mobile)
- Each card shows: title, description preview, status badge, last edited time
- Hover reveals action buttons (edit, duplicate, delete)
- Empty state: "Create your first PRD" with template suggestions

### PRD Editor
- Clean, distraction-free layout
- Sticky toolbar at top
- Full-width editor (max-w-4xl centered)
- Right sidebar for: Template, AI assist, Export options (collapsible)
- Bottom bar: Auto-save indicator, version history, share button
- AI suggestions appear as inline highlights or floating cards

### Templates Library
- Grid of template cards with preview images
- Categories: Feature, Epic, Technical, Product Launch
- Each card shows: Name, description, "Use Template" button
- Preview modal shows full template structure

### Settings
- 2-column: Sidebar navigation + content area
- Sections: Profile, Linear Integration, AI Settings, Team
- Form-based inputs with clear save states
- Linear connection status with OAuth button

---

## Images

**Hero Images:** Not applicable for this productivity tool - focus on UI clarity

**Template Previews:** 
- Screenshot-style thumbnails of each template (800x600px)
- Clean, professional mockups showing filled content
- Placement: Template selector cards and preview modals

**Empty States:**
- Simple, minimal illustrations (not photographs)
- Muted colors matching brand palette
- Placement: Empty dashboard, no search results, disconnected integrations

**Profile/Avatars:**
- User avatars: Circular, 40x40px default, initials fallback
- Team member avatars in collaboration features

---

## Brand Expression

**NEXORA Identity:**
- Logo: Modern wordmark with subtle oracle/crystal motif
- Accent usage: Purple gradient for AI-powered features
- Voice: Professional, confident, helpful (not playful)
- Micro-interactions: Precise, minimal, purposeful

**Consistency:**
- Maintain 8px grid throughout
- Use design tokens for all colors/spacing
- Component reusability over custom designs
- Prioritize clarity over decoration