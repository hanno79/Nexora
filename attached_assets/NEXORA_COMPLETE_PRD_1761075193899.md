# 🚀 NEXORA Platform - Complete Product Requirements Document

**Version:** 1.0  
**Datum:** 21. Oktober 2025  
**Status:** Ready for AI Implementation  
**Ziel:** Vollständige Implementierung durch KI-Coding-Tools (Replit AI, Claude Code, Kilo Code)

---

## 📋 INHALTSVERZEICHNIS

1. [Executive Summary](#executive-summary)
2. [Produkt-Vision](#produkt-vision)
3. [Tech Stack](#tech-stack)
4. [Systemarchitektur](#systemarchitektur)
5. [Implementierungs-Roadmap](#implementierungs-roadmap)
6. [Detaillierte Feature-Spezifikationen](#detaillierte-feature-spezifikationen)
7. [Datenbank-Schema](#datenbank-schema)
8. [API-Spezifikationen](#api-spezifikationen)
9. [UI/UX-Spezifikationen](#uiux-spezifikationen)
10. [Testing-Strategie](#testing-strategie)
11. [Deployment-Strategie](#deployment-strategie)

---

## 1. EXECUTIVE SUMMARY

### 🎯 Produkt-Übersicht

**NEXORA** ist eine moderne SaaS-Plattform zur KI-gestützten Erstellung von Product Requirement Documents (PRDs). Die Plattform kombiniert intelligente Content-Generierung mit nahtloser Linear-Integration, um Product Managern und Entwicklungsteams die PRD-Erstellung zu revolutionieren.

### 🌟 Kern-Features

1. **KI-gestützte PRD-Erstellung** - Claude AI für intelligente Content-Generierung
2. **Template-System** - Vordefinierte und anpassbare PRD-Templates
3. **Linear-Integration** - Direkter Export zu Linear als Issues/Projects
4. **Collaboration** - Real-time Team-Zusammenarbeit
5. **Multi-Format Export** - PDF, Word, Markdown, Linear
6. **Version Control** - Vollständige PRD-Versionierung

### 📊 Projekt-Umfang

- **Gesamt-Tickets:** 50
- **Geschätzte Entwicklungszeit:** 8-12 Wochen
- **Team-Größe:** 1-3 Entwickler (oder KI-Tools)
- **Deployment:** Netlify (Frontend) + Supabase (Backend)

---

## 2. PRODUKT-VISION

### 🎨 Brand Identity: NEXORA

**Name-Bedeutung:**
- **NEX** = Next (Zukunft, Innovation)
- **ORA** = Oracle (Weisheit, Vorhersage)
- **Gesamt:** "The Next Oracle" - Die nächste Generation intelligenter Produktplanung

**Brand Values:**
- ⚡ **Speed** - Schnelle PRD-Erstellung
- 🎯 **Precision** - Präzise, strukturierte Dokumente
- 🤖 **Intelligence** - KI-gestützte Assistenz
- 🔗 **Integration** - Nahtlose Tool-Integration

**Zielgruppe:**
- Product Managers
- Startup-Gründer
- Entwicklungsteams
- Agile Teams mit Linear

### 🎯 Problem Statement

**Aktuelle Herausforderungen:**
1. PRD-Erstellung ist zeitaufwändig (4-8 Stunden pro PRD)
2. Inkonsistente Struktur und Qualität
3. Fehlende Integration mit Projektmanagement-Tools
4. Keine KI-Unterstützung für Content-Generierung
5. Schwierige Zusammenarbeit im Team

**NEXORA Lösung:**
1. ⚡ **10x schneller** - PRD in 30-60 Minuten statt Stunden
2. 📋 **Konsistente Qualität** - Template-basierte Struktur
3. 🔗 **Nahtlose Integration** - Direkter Linear-Export
4. 🤖 **KI-Assistenz** - Intelligente Content-Vorschläge
5. 👥 **Team-Collaboration** - Real-time Zusammenarbeit

---

## 3. TECH STACK

### Frontend
```
- Framework: React 18+ mit TypeScript
- Build Tool: Vite
- Styling: Tailwind CSS
- State Management: Zustand / React Context
- Forms: React Hook Form + Zod Validation
- Rich Text Editor: TipTap / Lexical
- UI Components: Radix UI / shadcn/ui
```

### Backend
```
- Platform: Supabase
- Database: PostgreSQL
- Authentication: Supabase Auth
- Storage: Supabase Storage
- Real-time: Supabase Realtime
- API: Supabase REST API + PostgreSQL Functions
```

### AI Integration
```
- Provider: Anthropic Claude API
- Model: Claude 3.5 Sonnet
- Use Cases:
  - Content Generation
  - Smart Suggestions
  - Auto-completion
  - Template Filling
```

### External APIs
```
- Linear API: Project/Issue Management
- Export: PDF (jsPDF), Word (docx), Markdown
```

### DevOps
```
- Hosting: Netlify
- CI/CD: GitHub Actions
- Monitoring: Sentry
- Analytics: PostHog / Plausible
```

---

## 4. SYSTEMARCHITEKTUR

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     NEXORA Platform                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Frontend   │───▶│   Supabase   │───▶│  PostgreSQL  │  │
│  │  React + TS  │    │   Backend    │    │   Database   │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                    │                               │
│         │                    │                               │
│         ▼                    ▼                               │
│  ┌──────────────┐    ┌──────────────┐                      │
│  │  Claude API  │    │  Linear API  │                      │
│  │ (AI Content) │    │  (Export)    │                      │
│  └──────────────┘    └──────────────┘                      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Datenfluss

```
User Input → React Form → Validation → Supabase API
                                            ↓
                                    PostgreSQL Storage
                                            ↓
                                    ┌───────┴────────┐
                                    ▼                ▼
                            Claude AI         Linear API
                            (Generate)        (Export)
                                    ↓                ↓
                                    └───────┬────────┘
                                            ▼
                                    User Dashboard
```

---

## 5. IMPLEMENTIERUNGS-ROADMAP

### 🎯 Phase 0: Foundation & Setup (Woche 1)

**Ziel:** Projekt-Infrastruktur aufsetzen

#### Sprint 0.1: Project Initialization
```
HRP-185: Brand Identity & Product Naming
HRP-184: Brand Guidelines Implementation
HRP-76: Netlify Project Setup
HRP-78: Supabase Project Setup
HRP-77: Environment Variables Configuration
```

**Deliverables:**
- ✅ Projekt-Repository erstellt
- ✅ Netlify-Deployment konfiguriert
- ✅ Supabase-Projekt initialisiert
- ✅ Environment Variables gesetzt
- ✅ Brand Assets integriert

---

### 🔐 Phase 1: Authentication System (Woche 2)

**Ziel:** Vollständiges Auth-System mit Supabase

#### Sprint 1.1: Basic Authentication
```
HRP-58: Supabase Auth Setup
HRP-87: Supabase Auth Implementation
HRP-59: Registration Form & Validation
HRP-60: Login Form & Session Management
```

**Implementierung:**

**HRP-58/87: Supabase Auth Setup**
```typescript
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Auth Helper Functions
export const authHelpers = {
  signUp: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`
      }
    })
    return { data, error }
  },
  
  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    return { data, error }
  },
  
  signOut: async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  },
  
  getSession: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }
}
```

**HRP-59: Registration Form**
```typescript
// src/components/auth/RegisterForm.tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const registerSchema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen haben'),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwörter stimmen nicht überein",
  path: ["confirmPassword"]
})

export function RegisterForm() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(registerSchema)
  })
  
  const onSubmit = async (data) => {
    const { error } = await authHelpers.signUp(data.email, data.password)
    if (error) {
      // Handle error
    } else {
      // Redirect to email verification page
    }
  }
  
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* Form fields */}
    </form>
  )
}
```

#### Sprint 1.2: Advanced Auth Features
```
HRP-61: Email Verification Flow
HRP-62: Password Reset Flow
HRP-63: Social Auth Integration (Google/GitHub)
HRP-66: Auth Guard & Protected Routes
```

**HRP-61: Email Verification**
```typescript
// src/pages/auth/VerifyEmail.tsx
export function VerifyEmailPage() {
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user.email_confirmed_at) {
          // Email verified, redirect to onboarding
          navigate('/onboarding')
        }
      }
    )
    return () => authListener.subscription.unsubscribe()
  }, [])
  
  return (
    <div>
      <h1>E-Mail-Bestätigung</h1>
      <p>Bitte überprüfen Sie Ihre E-Mails und klicken Sie auf den Bestätigungslink.</p>
    </div>
  )
}
```

**HRP-66: Auth Guard**
```typescript
// src/components/auth/AuthGuard.tsx
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
      }
    )
    
    return () => subscription.unsubscribe()
  }, [])
  
  if (loading) return <LoadingSpinner />
  if (!session) return <Navigate to="/login" />
  
  return <>{children}</>
}
```

#### Sprint 1.3: User Profile & Onboarding
```
HRP-64: Onboarding Wizard
HRP-65: User Profile Management
HRP-181: User Onboarding & First Experience
```

**Deliverables:**
- ✅ Vollständiges Auth-System
- ✅ Email-Verifizierung
- ✅ Password-Reset
- ✅ Social Login (Google/GitHub)
- ✅ Protected Routes
- ✅ Onboarding-Flow
- ✅ User Profile Management

---

### 🗄️ Phase 2: Database & API Foundation (Woche 3)

**Ziel:** Datenbank-Schema und API-Endpoints

#### Sprint 2.1: Database Schema
```
HRP-52: PRD Management API Endpoints
HRP-55: Storage Configuration
HRP-56: RLS Policies Implementation
```

**Datenbank-Schema:**

```sql
-- Users Table (erweitert Supabase Auth)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  company TEXT,
  role TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PRDs Table
CREATE TABLE prds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  template_id UUID REFERENCES templates(id),
  status TEXT DEFAULT 'draft', -- draft, in_progress, review, completed
  content JSONB NOT NULL DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  version INTEGER DEFAULT 1,
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Templates Table
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT, -- web_app, mobile_app, api, feature, etc.
  structure JSONB NOT NULL, -- Template structure definition
  is_system BOOLEAN DEFAULT false, -- System templates vs user templates
  user_id UUID REFERENCES profiles(id), -- NULL for system templates
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PRD Versions Table
CREATE TABLE prd_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prd_id UUID REFERENCES prds(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content JSONB NOT NULL,
  changes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(prd_id, version)
);

-- Collaborators Table
CREATE TABLE prd_collaborators (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prd_id UUID REFERENCES prds(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'viewer', -- owner, editor, viewer
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(prd_id, user_id)
);

-- Comments Table
CREATE TABLE prd_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prd_id UUID REFERENCES prds(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  section TEXT, -- Which section of PRD
  parent_id UUID REFERENCES prd_comments(id), -- For threaded comments
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Linear Exports Table
CREATE TABLE linear_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prd_id UUID REFERENCES prds(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  linear_project_id TEXT,
  linear_team_id TEXT,
  export_status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  issues_created INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- API Keys Table (for Linear integration)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  service TEXT NOT NULL, -- 'linear', 'claude', etc.
  encrypted_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(user_id, service)
);
```

**HRP-56: RLS Policies**
```sql
-- Enable RLS
ALTER TABLE prds ENABLE ROW LEVEL SECURITY;
ALTER TABLE prd_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prd_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE prd_comments ENABLE ROW LEVEL SECURITY;

-- PRDs Policies
CREATE POLICY "Users can view their own PRDs"
  ON prds FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view PRDs they collaborate on"
  ON prds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM prd_collaborators
      WHERE prd_id = prds.id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own PRDs"
  ON prds FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own PRDs"
  ON prds FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Editors can update PRDs"
  ON prds FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM prd_collaborators
      WHERE prd_id = prds.id 
      AND user_id = auth.uid() 
      AND role IN ('owner', 'editor')
    )
  );

-- Similar policies for other tables...
```

#### Sprint 2.2: API Endpoints
```
HRP-53: AI Processing API Endpoints
HRP-54: Export API Endpoints
HRP-57: API Testing Suite
```

**API Endpoints Specification:**

```typescript
// src/lib/api/prds.ts

export const prdApi = {
  // CRUD Operations
  create: async (data: CreatePRDInput) => {
    const { data: prd, error } = await supabase
      .from('prds')
      .insert({
        user_id: (await supabase.auth.getUser()).data.user?.id,
        ...data
      })
      .select()
      .single()
    return { prd, error }
  },
  
  getAll: async () => {
    const { data: prds, error } = await supabase
      .from('prds')
      .select('*, template:templates(*)')
      .order('updated_at', { ascending: false })
    return { prds, error }
  },
  
  getById: async (id: string) => {
    const { data: prd, error } = await supabase
      .from('prds')
      .select('*, template:templates(*), versions:prd_versions(*)')
      .eq('id', id)
      .single()
    return { prd, error }
  },
  
  update: async (id: string, data: UpdatePRDInput) => {
    const { data: prd, error } = await supabase
      .from('prds')
      .update(data)
      .eq('id', id)
      .select()
      .single()
    return { prd, error }
  },
  
  delete: async (id: string) => {
    const { error } = await supabase
      .from('prds')
      .delete()
      .eq('id', id)
    return { error }
  }
}
```

**Deliverables:**
- ✅ Vollständiges Datenbank-Schema
- ✅ RLS Policies implementiert
- ✅ API Endpoints für PRD CRUD
- ✅ Storage für File Uploads
- ✅ API Tests

---

### 🤖 Phase 3: AI Integration (Woche 4)

**Ziel:** Claude AI für Content-Generierung

#### Sprint 3.1: Claude API Setup
```
HRP-53: AI Processing API Endpoints
```

**Claude API Integration:**

```typescript
// src/lib/ai/claude.ts
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: import.meta.env.VITE_CLAUDE_API_KEY
})

export const claudeAI = {
  generateContent: async (prompt: string, context?: any) => {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
    return message.content[0].text
  },
  
  generatePRDSection: async (
    sectionType: string,
    projectContext: any,
    existingContent?: string
  ) => {
    const prompt = buildSectionPrompt(sectionType, projectContext, existingContent)
    return await claudeAI.generateContent(prompt)
  },
  
  improveSuggestion: async (content: string, improvementType: string) => {
    const prompt = `Improve the following ${improvementType}:\n\n${content}`
    return await claudeAI.generateContent(prompt)
  },
  
  autoComplete: async (partialContent: string, context: any) => {
    const prompt = `Continue this content naturally:\n\n${partialContent}`
    return await claudeAI.generateContent(prompt)
  }
}

function buildSectionPrompt(
  sectionType: string,
  projectContext: any,
  existingContent?: string
): string {
  const prompts = {
    'problem_statement': `
      Generate a clear problem statement for a product with these details:
      - Product Name: ${projectContext.productName}
      - Target Users: ${projectContext.targetUsers}
      - Main Goal: ${projectContext.mainGoal}
      
      ${existingContent ? `Existing content to improve:\n${existingContent}` : ''}
      
      Format: Clear, concise problem statement with user pain points.
    `,
    'solution_overview': `
      Generate a solution overview for:
      - Problem: ${projectContext.problem}
      - Product: ${projectContext.productName}
      - Key Features: ${projectContext.keyFeatures?.join(', ')}
      
      Format: High-level solution description with key benefits.
    `,
    // ... more section types
  }
  
  return prompts[sectionType] || ''
}
```

#### Sprint 3.2: AI Features Implementation
```
HRP-93 bis HRP-142: AI Content Generation Features
```

**AI Features:**

1. **Auto-Completion** (HRP-93-98)
```typescript
// src/hooks/useAIAutoComplete.ts
export function useAIAutoComplete() {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  
  const getSuggestions = async (content: string, context: any) => {
    setLoading(true)
    try {
      const suggestion = await claudeAI.autoComplete(content, context)
      setSuggestions([suggestion])
    } finally {
      setLoading(false)
    }
  }
  
  return { suggestions, loading, getSuggestions }
}
```

2. **Smart Suggestions** (HRP-99-104)
```typescript
// src/components/editor/SmartSuggestions.tsx
export function SmartSuggestions({ section, content }: Props) {
  const { suggestions, loading } = useAISmartSuggestions(section, content)
  
  return (
    <div className="suggestions-panel">
      <h3>💡 Smart Suggestions</h3>
      {loading ? (
        <LoadingSpinner />
      ) : (
        suggestions.map((suggestion, i) => (
          <SuggestionCard
            key={i}
            suggestion={suggestion}
            onApply={() => applySuggestion(suggestion)}
          />
        ))
      )}
    </div>
  )
}
```

3. **Template Generation** (HRP-105-110)
4. **Content Improvement** (HRP-111-116)
5. **Multi-language Support** (HRP-117-122)
6. **Tone & Style Adjustment** (HRP-123-128)
7. **Context-Aware Assistance** (HRP-129-134)
8. **Batch Processing** (HRP-135-142)

**Deliverables:**
- ✅ Claude API Integration
- ✅ Auto-Completion Feature
- ✅ Smart Suggestions
- ✅ Template Generation
- ✅ Content Improvement Tools
- ✅ Multi-language Support
- ✅ Tone & Style Controls

---

### 📝 Phase 4: PRD Editor & Management (Woche 5-6)

**Ziel:** Vollständiger PRD-Editor mit allen Features

#### Sprint 4.1: Core Editor
```
HRP-143: PRD Template System
HRP-144: PRD Editor Implementation
HRP-145: Version Control System
HRP-146: Auto-Save & Draft Management
```

**PRD Editor Implementation:**

```typescript
// src/components/editor/PRDEditor.tsx
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

export function PRDEditor({ prdId, initialContent }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start writing your PRD...'
      })
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      handleAutoSave(editor.getJSON())
    }
  })
  
  const handleAutoSave = useDebouncedCallback(async (content) => {
    await prdApi.update(prdId, { content })
  }, 2000)
  
  return (
    <div className="prd-editor">
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
      <AIAssistantPanel editor={editor} />
    </div>
  )
}
```

**Template System:**

```typescript
// src/lib/templates/index.ts
export const PRD_TEMPLATES = {
  web_app: {
    name: 'Web Application PRD',
    sections: [
      { id: 'overview', title: 'Product Overview', required: true },
      { id: 'problem', title: 'Problem Statement', required: true },
      { id: 'solution', title: 'Solution Overview', required: true },
      { id: 'features', title: 'Feature Specifications', required: true },
      { id: 'user_stories', title: 'User Stories', required: true },
      { id: 'technical', title: 'Technical Requirements', required: false },
      { id: 'design', title: 'Design Specifications', required: false },
      { id: 'metrics', title: 'Success Metrics', required: true },
      { id: 'timeline', title: 'Timeline & Milestones', required: true }
    ]
  },
  mobile_app: {
    name: 'Mobile App PRD',
    sections: [
      // Similar structure for mobile apps
    ]
  },
  api: {
    name: 'API PRD',
    sections: [
      // API-specific sections
    ]
  }
}
```

#### Sprint 4.2: Collaboration Features
```
HRP-147: Real-time Collaboration
HRP-148: Comments & Discussions
HRP-149: Change Tracking
HRP-183: Team Collaboration Features
```

**Real-time Collaboration:**

```typescript
// src/hooks/useRealtimeCollaboration.ts
export function useRealtimeCollaboration(prdId: string) {
  const [activeUsers, setActiveUsers] = useState<User[]>([])
  
  useEffect(() => {
    const channel = supabase.channel(`prd:${prdId}`)
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        setActiveUsers(Object.values(state).flat())
      })
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        updateCursor(payload)
      })
      .subscribe()
    
    return () => {
      supabase.removeChannel(channel)
    }
  }, [prdId])
  
  return { activeUsers }
}
```

#### Sprint 4.3: Export Features
```
HRP-81: PDF Export
HRP-82: Word Export
HRP-83: Markdown Export
HRP-84: Linear Export
HRP-54: Export API Endpoints
```

**Export Implementation:**

```typescript
// src/lib/export/pdf.ts
import jsPDF from 'jspdf'

export async function exportToPDF(prd: PRD) {
  const doc = new jsPDF()
  
  // Title
  doc.setFontSize(24)
  doc.text(prd.title, 20, 20)
  
  // Content sections
  let yPosition = 40
  for (const section of prd.content.sections) {
    doc.setFontSize(16)
    doc.text(section.title, 20, yPosition)
    yPosition += 10
    
    doc.setFontSize(12)
    const lines = doc.splitTextToSize(section.content, 170)
    doc.text(lines, 20, yPosition)
    yPosition += lines.length * 7 + 10
  }
  
  doc.save(`${prd.title}.pdf`)
}

// src/lib/export/linear.ts
export async function exportToLinear(prd: PRD, config: LinearExportConfig) {
  const linearClient = new LinearClient({ apiKey: config.apiKey })
  
  // Create project
  const project = await linearClient.createProject({
    name: prd.title,
    description: prd.description,
    teamId: config.teamId
  })
  
  // Create issues from PRD sections
  for (const section of prd.content.sections) {
    await linearClient.createIssue({
      title: section.title,
      description: section.content,
      projectId: project.id,
      teamId: config.teamId
    })
  }
  
  return project
}
```

**Deliverables:**
- ✅ Rich Text Editor
- ✅ Template System
- ✅ Version Control
- ✅ Auto-Save
- ✅ Real-time Collaboration
- ✅ Comments System
- ✅ PDF/Word/Markdown Export
- ✅ Linear Integration

---

### 🔗 Phase 5: Linear Integration (Woche 7)

**Ziel:** Vollständige Linear-Integration

#### Sprint 5.1: Linear API Client
```
HRP-67: Linear API Client Setup
HRP-68: API Key Management UI
HRP-69: Project Creation Logic
HRP-70: Issue Template Mapping
```

**Linear Integration:**

```typescript
// src/lib/linear/client.ts
import { LinearClient } from '@linear/sdk'

export class NexoraLinearClient {
  private client: LinearClient
  
  constructor(apiKey: string) {
    this.client = new LinearClient({ apiKey })
  }
  
  async createProjectFromPRD(prd: PRD, config: LinearExportConfig) {
    // Create project
    const project = await this.client.createProject({
      name: prd.title,
      description: prd.description,
      teamId: config.teamId,
      state: 'planned'
    })
    
    // Create labels
    const labels = await this.createLabels(config.teamId, prd.metadata.labels)
    
    // Create milestones
    const milestones = await this.createMilestones(project.id, prd.content.timeline)
    
    // Create issues
    const issues = await this.createIssuesFromSections(
      project.id,
      config.teamId,
      prd.content.sections,
      labels,
      milestones
    )
    
    return { project, issues }
  }
  
  private async createIssuesFromSections(
    projectId: string,
    teamId: string,
    sections: PRDSection[],
    labels: Label[],
    milestones: Milestone[]
  ) {
    const issues = []
    
    for (const section of sections) {
      // Map section to issue
      const issue = await this.client.createIssue({
        title: section.title,
        description: this.formatSectionForLinear(section),
        projectId,
        teamId,
        priority: this.mapPriority(section.priority),
        labelIds: this.mapLabels(section.tags, labels),
        // ... more mappings
      })
      
      issues.push(issue)
    }
    
    return issues
  }
}
```

#### Sprint 5.2: Export UI & Progress
```
HRP-71: Label & Milestone Creation
HRP-72: Team & Assignee Management
HRP-73: Export Progress UI
HRP-74: Error Handling & Retry
HRP-75: Linear Webhook Integration
```

**Deliverables:**
- ✅ Linear API Client
- ✅ API Key Management
- ✅ Project Creation
- ✅ Issue Mapping
- ✅ Label/Milestone Sync
- ✅ Export Progress UI
- ✅ Webhook Integration

---

### 🎨 Phase 6: UI/UX & Dashboard (Woche 8)

**Ziel:** Polierte Benutzeroberfläche

#### Sprint 6.1: Dashboard
```
HRP-187: User Dashboard & Home Screen
HRP-182: Smart Input Wizard
```

**Dashboard Implementation:**

```typescript
// src/pages/Dashboard.tsx
export function Dashboard() {
  const { prds, loading } = usePRDs()
  const { stats } = useDashboardStats()
  
  return (
    <div className="dashboard">
      <DashboardHeader />
      
      <div className="stats-grid">
        <StatCard
          title="Total PRDs"
          value={stats.totalPRDs}
          icon={<DocumentIcon />}
        />
        <StatCard
          title="In Progress"
          value={stats.inProgress}
          icon={<ClockIcon />}
        />
        <StatCard
          title="Completed"
          value={stats.completed}
          icon={<CheckIcon />}
        />
        <StatCard
          title="Exported to Linear"
          value={stats.exported}
          icon={<LinearIcon />}
        />
      </div>
      
      <div className="prds-section">
        <div className="section-header">
          <h2>Recent PRDs</h2>
          <Button onClick={() => navigate('/prds/new')}>
            + New PRD
          </Button>
        </div>
        
        <PRDGrid prds={prds} loading={loading} />
      </div>
    </div>
  )
}
```

#### Sprint 6.2: UX Enhancements
```
HRP-188: Error Handling & Recovery System
HRP-189: Help Center & Documentation
HRP-190: Notification System
HRP-191: User Settings & Profile
HRP-192: User Feedback System
```

**Deliverables:**
- ✅ Dashboard mit Stats
- ✅ PRD Grid/List Views
- ✅ Smart Input Wizard
- ✅ Error Handling UI
- ✅ Help Center
- ✅ Notifications
- ✅ Settings Page
- ✅ Feedback System

---

### 🚀 Phase 7: Advanced Features (Woche 9-10)

#### Sprint 7.1: Meta-Features
```
HRP-85: Template Selection UI
HRP-86: Meta-Template Implementation
HRP-186: CLAUDE.md / AGENT.md Generator
```

**CLAUDE.md Generator:**

```typescript
// src/lib/generators/claudemd.ts
export function generateClaudeMD(prd: PRD): string {
  return `
# ${prd.title} - Development Guidelines

## Project Overview
${prd.description}

## Tech Stack
${prd.metadata.techStack.join(', ')}

## Architecture
${prd.content.technical.architecture}

## Development Rules
1. Follow the PRD specifications exactly
2. Use TypeScript for type safety
3. Write tests for all features
4. Follow the component structure defined in the PRD

## File Structure
${generateFileStructure(prd)}

## API Endpoints
${generateAPIEndpoints(prd)}

## Component Guidelines
${generateComponentGuidelines(prd)}

## Testing Requirements
${generateTestingRequirements(prd)}
`
}
```

#### Sprint 7.2: DevOps & Monitoring
```
HRP-79: CI/CD Pipeline Setup
HRP-80: Monitoring & Logging Setup
```

**CI/CD Pipeline:**

```yaml
# .github/workflows/deploy.yml
name: Deploy to Netlify

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test
      - run: npm run lint
      - run: npm run type-check

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build
      - uses: netlify/actions/cli@master
        with:
          args: deploy --prod
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

**Deliverables:**
- ✅ Template Selection UI
- ✅ Meta-Templates
- ✅ CLAUDE.md Generator
- ✅ CI/CD Pipeline
- ✅ Monitoring Setup
- ✅ Error Tracking

---

## 6. DETAILLIERTE FEATURE-SPEZIFIKATIONEN

### 6.1 Authentication System

**Features:**
- Email/Password Registration
- Email Verification
- Password Reset
- Social Login (Google, GitHub)
- Session Management
- Protected Routes
- User Profile Management

**User Flows:**

```
Registration Flow:
1. User enters email + password
2. System validates input
3. Supabase creates user account
4. System sends verification email
5. User clicks verification link
6. System confirms email
7. User redirected to onboarding

Login Flow:
1. User enters credentials
2. System validates
3. Supabase creates session
4. User redirected to dashboard

Password Reset Flow:
1. User requests reset
2. System sends reset email
3. User clicks reset link
4. User enters new password
5. System updates password
6. User redirected to login
```

### 6.2 PRD Editor

**Features:**
- Rich Text Editing (TipTap)
- Template-based Structure
- Auto-Save (every 2 seconds)
- Version History
- Real-time Collaboration
- AI Assistance Panel
- Export Options

**Editor Components:**

```typescript
interface EditorProps {
  prdId: string
  initialContent: PRDContent
  template: Template
  readOnly?: boolean
}

interface PRDContent {
  sections: Section[]
  metadata: {
    version: number
    lastModified: Date
    author: User
  }
}

interface Section {
  id: string
  type: SectionType
  title: string
  content: string
  aiGenerated: boolean
  comments: Comment[]
}
```

### 6.3 AI Features

**Capabilities:**

1. **Auto-Completion**
   - Trigger: User types, pauses for 1 second
   - Action: Generate next 1-2 sentences
   - UI: Inline suggestion (gray text)

2. **Smart Suggestions**
   - Trigger: User selects text or section
   - Action: Generate 3-5 improvement suggestions
   - UI: Side panel with suggestion cards

3. **Template Generation**
   - Trigger: User selects template + provides context
   - Action: Generate complete PRD structure
   - UI: Progress modal with section-by-section generation

4. **Content Improvement**
   - Trigger: User clicks "Improve" button
   - Action: Enhance clarity, grammar, structure
   - UI: Show before/after comparison

### 6.4 Linear Integration

**Export Process:**

```
1. User clicks "Export to Linear"
2. System shows export configuration modal
3. User selects:
   - Target team
   - Project name
   - Issue mapping strategy
   - Labels/Milestones
4. System validates Linear API key
5. System creates project in Linear
6. System creates issues from PRD sections
7. System shows progress (X of Y issues created)
8. System saves export record
9. User sees success message with Linear project link
```

**Issue Mapping:**

```typescript
interface IssueMappingStrategy {
  type: 'section' | 'feature' | 'user_story'
  priority: 'auto' | 'manual'
  labels: 'auto' | 'manual'
  assignees: 'none' | 'auto' | 'manual'
}

// Example: Section-based mapping
PRD Section "User Authentication" →
  Linear Issue "Implement User Authentication"
  - Description: Full section content
  - Priority: Based on section priority
  - Labels: ["authentication", "backend"]
  - Subtasks: Individual features as subtasks
```

---

## 7. DATENBANK-SCHEMA

### 7.1 Core Tables

**Siehe Phase 2 für vollständiges Schema**

### 7.2 Indexes

```sql
-- Performance indexes
CREATE INDEX idx_prds_user_id ON prds(user_id);
CREATE INDEX idx_prds_status ON prds(status);
CREATE INDEX idx_prds_updated_at ON prds(updated_at DESC);
CREATE INDEX idx_prd_versions_prd_id ON prd_versions(prd_id);
CREATE INDEX idx_prd_collaborators_prd_id ON prd_collaborators(prd_id);
CREATE INDEX idx_prd_collaborators_user_id ON prd_collaborators(user_id);
CREATE INDEX idx_prd_comments_prd_id ON prd_comments(prd_id);
```

### 7.3 Functions

```sql
-- Function to create new PRD version
CREATE OR REPLACE FUNCTION create_prd_version()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO prd_versions (prd_id, version, content, created_by)
  VALUES (
    NEW.id,
    NEW.version,
    NEW.content,
    NEW.user_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-create version on PRD update
CREATE TRIGGER on_prd_update
  AFTER UPDATE ON prds
  FOR EACH ROW
  WHEN (OLD.content IS DISTINCT FROM NEW.content)
  EXECUTE FUNCTION create_prd_version();
```

---

## 8. API-SPEZIFIKATIONEN

### 8.1 REST API Endpoints

```
Authentication:
POST   /auth/register
POST   /auth/login
POST   /auth/logout
POST   /auth/reset-password
GET    /auth/verify-email

PRDs:
GET    /api/prds
POST   /api/prds
GET    /api/prds/:id
PUT    /api/prds/:id
DELETE /api/prds/:id
GET    /api/prds/:id/versions
POST   /api/prds/:id/versions

Templates:
GET    /api/templates
POST   /api/templates
GET    /api/templates/:id

AI:
POST   /api/ai/generate
POST   /api/ai/suggest
POST   /api/ai/improve
POST   /api/ai/complete

Export:
POST   /api/export/pdf
POST   /api/export/word
POST   /api/export/markdown
POST   /api/export/linear

Linear:
POST   /api/linear/validate-key
GET    /api/linear/teams
POST   /api/linear/export
GET    /api/linear/export/:id/status
```

### 8.2 WebSocket Events

```typescript
// Real-time collaboration events
interface CollaborationEvents {
  'user:join': { userId: string, userName: string }
  'user:leave': { userId: string }
  'cursor:move': { userId: string, position: Position }
  'content:update': { sectionId: string, content: string }
  'comment:add': { commentId: string, comment: Comment }
}
```

---

## 9. UI/UX-SPEZIFIKATIONEN

### 9.1 Design System

**Colors:**
```css
:root {
  /* Primary */
  --primary-50: #f0f9ff;
  --primary-500: #3b82f6;
  --primary-600: #2563eb;
  --primary-700: #1d4ed8;
  
  /* Neutral */
  --gray-50: #f9fafb;
  --gray-100: #f3f4f6;
  --gray-500: #6b7280;
  --gray-900: #111827;
  
  /* Semantic */
  --success: #10b981;
  --warning: #f59e0b;
  --error: #ef4444;
  --info: #3b82f6;
}
```

**Typography:**
```css
/* Headings */
h1 { font-size: 2.5rem; font-weight: 700; }
h2 { font-size: 2rem; font-weight: 600; }
h3 { font-size: 1.5rem; font-weight: 600; }

/* Body */
body { font-size: 1rem; line-height: 1.5; }
.text-sm { font-size: 0.875rem; }
.text-xs { font-size: 0.75rem; }
```

**Spacing:**
```css
/* 8px base unit */
--space-1: 0.5rem;  /* 8px */
--space-2: 1rem;    /* 16px */
--space-3: 1.5rem;  /* 24px */
--space-4: 2rem;    /* 32px */
--space-6: 3rem;    /* 48px */
--space-8: 4rem;    /* 64px */
```

### 9.2 Component Library

**Key Components:**
- Button (Primary, Secondary, Ghost, Danger)
- Input (Text, Email, Password, Textarea)
- Select / Dropdown
- Modal / Dialog
- Toast / Notification
- Card
- Table
- Tabs
- Accordion
- Progress Bar
- Spinner / Loading
- Avatar
- Badge
- Tooltip

### 9.3 Responsive Design

```css
/* Breakpoints */
--mobile: 640px;
--tablet: 768px;
--desktop: 1024px;
--wide: 1280px;

/* Layout */
.container {
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 1rem;
}

@media (min-width: 768px) {
  .container { padding: 0 2rem; }
}
```

---

## 10. TESTING-STRATEGIE

### 10.1 Unit Tests

```typescript
// Example: PRD API Tests
describe('PRD API', () => {
  it('should create a new PRD', async () => {
    const prd = await prdApi.create({
      title: 'Test PRD',
      template_id: 'web_app'
    })
    expect(prd).toBeDefined()
    expect(prd.title).toBe('Test PRD')
  })
  
  it('should update PRD content', async () => {
    const updated = await prdApi.update(prdId, {
      content: { sections: [...] }
    })
    expect(updated.content).toEqual(expect.objectContaining({
      sections: expect.any(Array)
    }))
  })
})
```

### 10.2 Integration Tests

```typescript
// Example: Auth Flow Test
describe('Authentication Flow', () => {
  it('should complete full registration flow', async () => {
    // Register
    const { user } = await authHelpers.signUp(email, password)
    expect(user).toBeDefined()
    
    // Verify email (mock)
    await verifyEmail(user.id)
    
    // Login
    const { session } = await authHelpers.signIn(email, password)
    expect(session).toBeDefined()
  })
})
```

### 10.3 E2E Tests

```typescript
// Example: Playwright E2E Test
test('user can create and export PRD', async ({ page }) => {
  // Login
  await page.goto('/login')
  await page.fill('[name="email"]', 'test@example.com')
  await page.fill('[name="password"]', 'password123')
  await page.click('button[type="submit"]')
  
  // Create PRD
  await page.click('text=New PRD')
  await page.fill('[name="title"]', 'Test PRD')
  await page.click('text=Web Application')
  await page.click('text=Create')
  
  // Edit content
  await page.fill('.editor', 'Test content')
  await page.waitForTimeout(2000) // Wait for auto-save
  
  // Export to PDF
  await page.click('text=Export')
  await page.click('text=PDF')
  
  // Verify download
  const download = await page.waitForEvent('download')
  expect(download.suggestedFilename()).toContain('.pdf')
})
```

---

## 11. DEPLOYMENT-STRATEGIE

### 11.1 Environment Setup

```bash
# .env.example
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_CLAUDE_API_KEY=your-claude-key
VITE_LINEAR_CLIENT_ID=your-linear-client-id
VITE_LINEAR_CLIENT_SECRET=your-linear-secret
```

### 11.2 Netlify Configuration

```toml
# netlify.toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[build.environment]
  NODE_VERSION = "18"
```

### 11.3 Supabase Migrations

```sql
-- migrations/001_initial_schema.sql
-- (See Phase 2 for full schema)

-- migrations/002_add_indexes.sql
-- (See Database Schema section)

-- migrations/003_add_functions.sql
-- (See Database Schema section)
```

### 11.4 Deployment Checklist

```markdown
Pre-Deployment:
- [ ] All tests passing
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] RLS policies tested
- [ ] API keys validated
- [ ] Build successful locally

Deployment:
- [ ] Deploy to Netlify
- [ ] Verify deployment URL
- [ ] Test authentication flow
- [ ] Test PRD creation
- [ ] Test AI features
- [ ] Test Linear export
- [ ] Monitor error logs

Post-Deployment:
- [ ] Set up monitoring alerts
- [ ] Configure backup schedule
- [ ] Document deployment process
- [ ] Update team on new features
```

---

## 12. ERFOLGS-METRIKEN

### 12.1 Technical Metrics

```
Performance:
- Page Load Time: < 2s
- Time to Interactive: < 3s
- API Response Time: < 500ms
- AI Generation Time: < 10s

Quality:
- Test Coverage: > 80%
- TypeScript Coverage: 100%
- Zero Critical Bugs
- Lighthouse Score: > 90

Reliability:
- Uptime: > 99.9%
- Error Rate: < 0.1%
- Successful Deployments: > 95%
```

### 12.2 User Metrics

```
Engagement:
- Daily Active Users (DAU)
- PRDs Created per User
- AI Features Usage Rate
- Linear Exports per Week

Satisfaction:
- User Onboarding Completion: > 80%
- Feature Adoption Rate: > 60%
- User Retention (30 days): > 50%
- NPS Score: > 40
```

---

## 13. ANHANG

### 13.1 Alle Linear Tickets (Referenz)

**Phase 0: Foundation**
- HRP-185: Brand Identity & Product Naming
- HRP-184: Brand Guidelines
- HRP-76: Netlify Setup
- HRP-78: Supabase Setup
- HRP-77: Environment Variables

**Phase 1: Authentication**
- HRP-58/87: Supabase Auth Setup
- HRP-59: Registration Form
- HRP-60: Login Form
- HRP-61: Email Verification
- HRP-62: Password Reset
- HRP-63: Social Auth
- HRP-64: Onboarding Wizard
- HRP-65: User Profile
- HRP-66: Auth Guards
- HRP-181: User Onboarding

**Phase 2: Database & API**
- HRP-52: PRD Management API
- HRP-53: AI Processing API
- HRP-54: Export API
- HRP-55: Storage Configuration
- HRP-56: RLS Policies
- HRP-57: API Testing

**Phase 3: AI Integration**
- HRP-93-98: Auto-Completion Features
- HRP-99-104: Smart Suggestions
- HRP-105-110: Template Generation
- HRP-111-116: Content Improvement
- HRP-117-122: Multi-language Support
- HRP-123-128: Tone & Style
- HRP-129-134: Context-Aware Assistance
- HRP-135-142: Batch Processing

**Phase 4: PRD Editor**
- HRP-143: Template System
- HRP-144: Editor Implementation
- HRP-145: Version Control
- HRP-146: Auto-Save
- HRP-147: Real-time Collaboration
- HRP-148: Comments
- HRP-149: Change Tracking
- HRP-183: Team Collaboration

**Phase 5: Export & Linear**
- HRP-81: PDF Export
- HRP-82: Word Export
- HRP-83: Markdown Export
- HRP-84: Linear Export
- HRP-67: Linear API Client
- HRP-68: API Key Management
- HRP-69: Project Creation
- HRP-70: Issue Mapping
- HRP-71: Labels & Milestones
- HRP-72: Team Management
- HRP-73: Export Progress UI
- HRP-74: Error Handling
- HRP-75: Webhook Integration

**Phase 6: UI/UX**
- HRP-187: Dashboard
- HRP-182: Smart Input Wizard
- HRP-188: Error Handling System
- HRP-189: Help Center
- HRP-190: Notification System
- HRP-191: User Settings
- HRP-192: Feedback System

**Phase 7: Advanced**
- HRP-85: Template Selection UI
- HRP-86: Meta-Templates
- HRP-186: CLAUDE.md Generator
- HRP-79: CI/CD Pipeline
- HRP-80: Monitoring & Logging
- HRP-179: Dependency Map
- HRP-180: User Journey Documentation

### 13.2 Glossar

```
PRD: Product Requirements Document
RLS: Row Level Security
CRUD: Create, Read, Update, Delete
AI: Artificial Intelligence
API: Application Programming Interface
UI: User Interface
UX: User Experience
CI/CD: Continuous Integration/Continuous Deployment
MVP: Minimum Viable Product
SaaS: Software as a Service
```

---

## 🎯 ZUSAMMENFASSUNG FÜR KI-TOOLS

### Für Replit AI / Claude Code / Kilo Code:

**Dieses Dokument enthält:**
1. ✅ Vollständige Feature-Spezifikationen für alle 50 Tickets
2. ✅ Detaillierte Code-Beispiele für jede Phase
3. ✅ Datenbank-Schema mit SQL
4. ✅ API-Spezifikationen
5. ✅ UI/UX-Guidelines
6. ✅ Testing-Strategie
7. ✅ Deployment-Anweisungen

**Implementierungs-Reihenfolge:**
1. Phase 0: Foundation (1 Woche)
2. Phase 1: Authentication (1 Woche)
3. Phase 2: Database & API (1 Woche)
4. Phase 3: AI Integration (1 Woche)
5. Phase 4: PRD Editor (2 Wochen)
6. Phase 5: Linear Integration (1 Woche)
7. Phase 6: UI/UX (1 Woche)
8. Phase 7: Advanced Features (2 Wochen)

**Geschätzte Gesamt-Zeit:** 8-12 Wochen

**Tech Stack:**
- Frontend: React + TypeScript + Vite + Tailwind
- Backend: Supabase (PostgreSQL + Auth + Storage)
- AI: Claude API
- Deployment: Netlify
- Integration: Linear API

**Nächster Schritt:**
Beginnen Sie mit Phase 0 (Foundation) und arbeiten Sie sich sequenziell durch die Phasen.

---

**Dokument-Version:** 1.0  
**Erstellt:** 21. Oktober 2025  
**Für:** KI-gestützte Implementierung  
**Status:** ✅ Ready for Implementation
