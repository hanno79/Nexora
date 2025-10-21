// Initialize default templates if they don't exist
import { db } from "./db";
import { templates } from "@shared/schema";
import { eq } from "drizzle-orm";

const defaultTemplates = [
  {
    name: "Feature PRD",
    description: "Standard template for feature development with user stories, requirements, and success metrics",
    category: "feature",
    isDefault: "true",
    content: JSON.stringify({
      sections: [
        { title: "Overview", content: "Brief description of the feature" },
        { title: "Goals & Objectives", content: "What we aim to achieve" },
        { title: "User Stories", content: "As a [user], I want [goal] so that [benefit]" },
        { title: "Requirements", content: "Functional and non-functional requirements" },
        { title: "Success Metrics", content: "How we measure success" },
        { title: "Timeline", content: "Key milestones and deadlines" },
      ]
    }),
  },
  {
    name: "Epic PRD",
    description: "Large initiative template spanning multiple features and teams",
    category: "epic",
    isDefault: "true",
    content: JSON.stringify({
      sections: [
        { title: "Executive Summary", content: "High-level overview of the epic" },
        { title: "Vision & Strategy", content: "Long-term vision and strategic alignment" },
        { title: "Scope", content: "What's included and what's not" },
        { title: "Features", content: "Breakdown of individual features" },
        { title: "Dependencies", content: "Team and technical dependencies" },
        { title: "Success Metrics", content: "KPIs and success criteria" },
        { title: "Roadmap", content: "Phased delivery plan" },
      ]
    }),
  },
  {
    name: "Technical PRD",
    description: "Technical specification for infrastructure, architecture, or platform work",
    category: "technical",
    isDefault: "true",
    content: JSON.stringify({
      sections: [
        { title: "Problem Statement", content: "Technical problem we're solving" },
        { title: "Proposed Solution", content: "Technical approach and architecture" },
        { title: "Architecture Diagram", content: "System design and components" },
        { title: "Implementation Details", content: "Detailed technical specifications" },
        { title: "Testing Strategy", content: "How we'll validate the solution" },
        { title: "Performance Considerations", content: "Scalability and optimization" },
        { title: "Rollout Plan", content: "Deployment strategy" },
      ]
    }),
  },
  {
    name: "Product Launch PRD",
    description: "Comprehensive template for product launches with go-to-market strategy",
    category: "product-launch",
    isDefault: "true",
    content: JSON.stringify({
      sections: [
        { title: "Product Overview", content: "What we're launching and why" },
        { title: "Target Audience", content: "Who we're building for" },
        { title: "Value Proposition", content: "Unique value and competitive advantage" },
        { title: "Features & Capabilities", content: "Complete feature list" },
        { title: "Go-to-Market Strategy", content: "Marketing and launch plan" },
        { title: "Success Metrics", content: "Launch KPIs and goals" },
        { title: "Timeline & Milestones", content: "Launch schedule" },
        { title: "Risks & Mitigation", content: "Potential issues and solutions" },
      ]
    }),
  },
];

export async function initializeTemplates() {
  try {
    const existingTemplates = await db.select().from(templates);
    
    if (existingTemplates.length === 0) {
      console.log("Initializing default templates...");
      await db.insert(templates).values(defaultTemplates);
      console.log("Default templates initialized!");
    }
  } catch (error) {
    console.error("Error initializing templates:", error);
    // Don't throw - let the server start anyway
  }
}
