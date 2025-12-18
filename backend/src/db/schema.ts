import { pgTable, text, timestamp, boolean, integer, real, jsonb, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const patients = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  patientId: text("patient_id").notNull(),
  patientName: text("patient_name"),
  dateOfBirth: text("date_of_birth"),
  gender: text("gender"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const studies = pgTable("studies", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").references(() => patients.id, { onDelete: "set null" }),
  studyInstanceUid: text("study_instance_uid"),
  studyDate: text("study_date"),
  studyTime: text("study_time"),
  accessionNumber: text("accession_number"),
  studyDescription: text("study_description"),
  modalityType: text("modality_type"),
  referringPhysician: text("referring_physician"),
  problemStatement: text("problem_statement"),
  status: text("status").$type<"processing" | "completed" | "failed">().default("processing"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const series = pgTable("series", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: uuid("study_id")
    .notNull()
    .references(() => studies.id, { onDelete: "cascade" }),
  seriesInstanceUid: text("series_instance_uid"),
  seriesNumber: integer("series_number"),
  seriesDescription: text("series_description"),
  modality: text("modality"),
  bodyPartExamined: text("body_part_examined"),
  frameCount: integer("frame_count").default(0),
  sliceThickness: real("slice_thickness"),
  pixelSpacing: jsonb("pixel_spacing").$type<number[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const analysisSessions = pgTable("analysis_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  studyId: uuid("study_id").references(() => studies.id, { onDelete: "cascade" }),
  problemStatement: text("problem_statement"),
  videoFilename: text("video_filename"),
  frameCount: integer("frame_count").default(0),
  summary: text("summary"),
  recommendations: jsonb("recommendations").$type<string[]>(),
  urgency: text("urgency").$type<"low" | "medium" | "high">(),
  status: text("status").$type<"processing" | "completed" | "failed">().default("processing"),
  promptTemplateId: uuid("prompt_template_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const analysisFrames = pgTable("analysis_frames", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => analysisSessions.id, { onDelete: "cascade" }),
  seriesId: uuid("series_id").references(() => series.id, { onDelete: "set null" }),
  frameNumber: integer("frame_number").notNull(),
  timestamp: real("timestamp"),
  analysis: text("analysis"),
  confidence: real("confidence"),
  findings: jsonb("findings").$type<string[]>(),
  storagePath: text("storage_path"),
  storageUrl: text("storage_url"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: uuid("study_id")
    .notNull()
    .references(() => studies.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  clinicalIndication: text("clinical_indication"),
  technique: text("technique"),
  comparison: text("comparison"),
  findings: jsonb("findings").$type<Record<string, string[]>>(),
  impressions: jsonb("impressions").$type<string[]>(),
  recommendations: jsonb("recommendations").$type<string[]>(),
  urgency: text("urgency").$type<"low" | "medium" | "high">(),
  status: text("status").$type<"draft" | "final" | "amended">().default("draft"),
  editedBy: text("edited_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const promptTemplates = pgTable("prompt_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  modalityType: text("modality_type"),
  bodyPart: text("body_part"),
  systemPrompt: text("system_prompt").notNull(),
  isDefault: boolean("is_default").default(false),
  isPublic: boolean("is_public").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;
export type Study = typeof studies.$inferSelect;
export type NewStudy = typeof studies.$inferInsert;
export type Series = typeof series.$inferSelect;
export type NewSeries = typeof series.$inferInsert;
export type AnalysisSession = typeof analysisSessions.$inferSelect;
export type NewAnalysisSession = typeof analysisSessions.$inferInsert;
export type AnalysisFrame = typeof analysisFrames.$inferSelect;
export type NewAnalysisFrame = typeof analysisFrames.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type NewPromptTemplate = typeof promptTemplates.$inferInsert;
