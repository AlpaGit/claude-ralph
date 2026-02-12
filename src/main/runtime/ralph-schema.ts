import { z } from "zod";

export const technicalChecklistItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(3),
  description: z.string().min(10),
  dependencies: z.array(z.string()),
  acceptanceCriteria: z.array(z.string().min(3)).min(1),
  technicalNotes: z.string().min(5)
});

export const technicalPackSchema = z.object({
  summary: z.string().min(30),
  architecture_notes: z.array(z.string().min(3)).min(1),
  files_expected: z.array(z.string().min(1)).min(1),
  dependencies: z.array(z.string().min(1)),
  risks: z.array(z.string().min(3)).min(1),
  assumptions: z.array(z.string().min(3)).min(1),
  acceptance_criteria: z.array(z.string().min(3)).min(1),
  test_strategy: z.array(z.string().min(3)).min(1),
  effort_estimate: z.string().min(3),
  checklist: z.array(technicalChecklistItemSchema).min(1)
});

export type TechnicalPackOutput = z.infer<typeof technicalPackSchema>;

export const technicalPackJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    architecture_notes: {
      type: "array",
      items: { type: "string" }
    },
    files_expected: {
      type: "array",
      items: { type: "string" }
    },
    dependencies: {
      type: "array",
      items: { type: "string" }
    },
    risks: {
      type: "array",
      items: { type: "string" }
    },
    assumptions: {
      type: "array",
      items: { type: "string" }
    },
    acceptance_criteria: {
      type: "array",
      items: { type: "string" }
    },
    test_strategy: {
      type: "array",
      items: { type: "string" }
    },
    effort_estimate: { type: "string" },
    checklist: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          dependencies: {
            type: "array",
            items: { type: "string" }
          },
          acceptanceCriteria: {
            type: "array",
            items: { type: "string" }
          },
          technicalNotes: { type: "string" }
        },
        required: [
          "id",
          "title",
          "description",
          "dependencies",
          "acceptanceCriteria",
          "technicalNotes"
        ]
      }
    }
  },
  required: [
    "summary",
    "architecture_notes",
    "files_expected",
    "dependencies",
    "risks",
    "assumptions",
    "acceptance_criteria",
    "test_strategy",
    "effort_estimate",
    "checklist"
  ]
} as const;

