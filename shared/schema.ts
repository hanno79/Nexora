import { sql, relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table - required for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table - required for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  company: varchar("company"),
  role: varchar("role"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Templates table for PRD templates
export const templates = pgTable("templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  description: text("description"),
  category: varchar("category").notNull(), // 'feature', 'epic', 'technical', 'product-launch', 'custom'
  content: text("content").notNull(), // JSON string with template structure
  isDefault: varchar("is_default").default('false'), // 'true' or 'false'
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }), // null for default templates
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Template = typeof templates.$inferSelect;
export type InsertTemplate = typeof templates.$inferInsert;

// PRDs table
export const prds = pgTable("prds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  templateId: varchar("template_id").references(() => templates.id),
  title: varchar("title").notNull(),
  description: text("description"),
  content: text("content").notNull(), // JSON string with PRD sections
  status: varchar("status").notNull().default('draft'), // 'draft', 'in-progress', 'review', 'pending-approval', 'approved', 'completed'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Prd = typeof prds.$inferSelect;

export const insertPrdSchema = createInsertSchema(prds, {
  title: z.string().min(1, "Title is required"),
  content: z.string(),
  status: z.enum(['draft', 'in-progress', 'review', 'pending-approval', 'approved', 'completed']).default('draft'),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPrd = z.infer<typeof insertPrdSchema>;

// PRD Versions table for version control
export const prdVersions = pgTable("prd_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  prdId: varchar("prd_id").notNull().references(() => prds.id, { onDelete: 'cascade' }),
  versionNumber: varchar("version_number").notNull(),
  title: varchar("title").notNull(),
  content: text("content").notNull(),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PrdVersion = typeof prdVersions.$inferSelect;
export type InsertPrdVersion = typeof prdVersions.$inferInsert;

// Shared PRDs table for collaboration
export const sharedPrds = pgTable("shared_prds", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  prdId: varchar("prd_id").notNull().references(() => prds.id, { onDelete: 'cascade' }),
  sharedWith: varchar("shared_with").notNull().references(() => users.id, { onDelete: 'cascade' }),
  permission: varchar("permission").notNull().default('view'), // 'view', 'edit'
  createdAt: timestamp("created_at").defaultNow(),
});

export type SharedPrd = typeof sharedPrds.$inferSelect;
export type InsertSharedPrd = typeof sharedPrds.$inferInsert;

// Comments table for PRD discussions
export const comments = pgTable("comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  prdId: varchar("prd_id").notNull().references(() => prds.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text("content").notNull(),
  sectionId: varchar("section_id"), // Optional: for inline comments on specific sections
  createdAt: timestamp("created_at").defaultNow(),
});

export type Comment = typeof comments.$inferSelect;

export const insertCommentSchema = createInsertSchema(comments, {
  content: z.string().min(1, "Comment cannot be empty"),
}).omit({
  id: true,
  createdAt: true,
});

export type InsertComment = z.infer<typeof insertCommentSchema>;

// Define relations
export const usersRelations = relations(users, ({ many }) => ({
  prds: many(prds),
  prdVersions: many(prdVersions),
  sharedPrds: many(sharedPrds),
  comments: many(comments),
}));

export const prdsRelations = relations(prds, ({ one, many }) => ({
  user: one(users, {
    fields: [prds.userId],
    references: [users.id],
  }),
  template: one(templates, {
    fields: [prds.templateId],
    references: [templates.id],
  }),
  versions: many(prdVersions),
  shares: many(sharedPrds),
  comments: many(comments),
}));

export const templatesRelations = relations(templates, ({ many }) => ({
  prds: many(prds),
}));

export const prdVersionsRelations = relations(prdVersions, ({ one }) => ({
  prd: one(prds, {
    fields: [prdVersions.prdId],
    references: [prds.id],
  }),
  createdBy: one(users, {
    fields: [prdVersions.createdBy],
    references: [users.id],
  }),
}));

export const sharedPrdsRelations = relations(sharedPrds, ({ one }) => ({
  prd: one(prds, {
    fields: [sharedPrds.prdId],
    references: [prds.id],
  }),
  sharedWith: one(users, {
    fields: [sharedPrds.sharedWith],
    references: [users.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  prd: one(prds, {
    fields: [comments.prdId],
    references: [prds.id],
  }),
  user: one(users, {
    fields: [comments.userId],
    references: [users.id],
  }),
}));
