/*
Author: rahn
Datum: 08.03.2026
Version: 1.0
Beschreibung: Zentrale Zod-Schemas fuer API-Validierung.
*/

// ÄNDERUNG 08.03.2026: Kommentar-Body-Schema fuer PRD-Kommentarrouten ergänzt.

import { z } from "zod";

export const updateUserSchema = z.object({
  firstName: z.string().max(100).nullish(),
  lastName: z.string().max(100).nullish(),
  company: z.string().max(200).nullish(),
  role: z.string().max(100).nullish(),
});

export const createTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).nullish(),
  category: z.string().max(50).default('custom'),
  content: z.string().min(1, "Content is required"),
});

export const updatePrdSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullish(),
  content: z.string().optional(),
  status: z.enum(['draft', 'in-progress', 'review', 'pending-approval', 'approved', 'completed']).optional(),
  language: z.string().max(10).optional(),
}).passthrough(); // Allow structuredContent, structuredAt, iterationLog, etc.

export const requestApprovalSchema = z.object({
  reviewers: z.array(z.string()).min(1, "At least one reviewer is required").max(20),
});

export const respondApprovalSchema = z.object({
  approved: z.boolean(),
});

export const commentSchema = z.object({
  content: z.string().max(50000).refine((value) => value.trim().length > 0, {
    message: 'Comment content is required',
  }),
  sectionId: z.string().nullish(),
});

export const sharePrdSchema = z.object({
  email: z.string().trim().email("Valid email is required").transform((value) => value.toLowerCase()),
  permission: z.enum(["view", "edit"]).default("view"),
});
