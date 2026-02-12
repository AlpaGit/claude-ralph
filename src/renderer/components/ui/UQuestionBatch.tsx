import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import type { DiscoveryQuestion } from "@shared/types";
import type { AnswerMap } from "../../stores/discoveryStore";
import { UOptionCard, OTHER_OPTION_VALUE } from "./UOptionCard";
import { UButton } from "./UButton";
import styles from "./UQuestionBatch.module.css";

/* ── Public types ──────────────────────────────────────── */

export interface UQuestionBatchProps {
  /** The current batch of questions (typically 3). */
  questions: DiscoveryQuestion[];
  /** Map of questionId -> answer string (or JSON-stringified string[] for multi). */
  answers: AnswerMap;
  /** Set of question IDs that were explicitly skipped. */
  skippedQuestions: string[];
  /** Callback to update an answer for a question. */
  onAnswer: (questionId: string, answer: string | string[]) => void;
  /** Callback to skip a question by its ID. */
  onSkip: (questionId: string) => void;
  /** Callback to submit the entire batch. */
  onSubmitBatch: () => void;
  /** Whether a batch submission is currently in flight. */
  isSubmitting: boolean;
  /** Additional CSS class names appended to the root element. */
  className?: string;
}

/* ── Helpers ───────────────────────────────────────────── */

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Parse the answer-map value into an array of selected option values.
 * Multi-select answers are stored as JSON-stringified arrays in the store.
 */
function parseSelectedOptions(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    } catch {
      /* fall through — treat as plain string */
    }
  }
  return [raw];
}

/* ── Per-question sub-component ───────────────────────── */

interface QuestionBlockProps {
  question: DiscoveryQuestion;
  index: number;
  rawAnswer: string;
  isSkipped: boolean;
  isSubmitting: boolean;
  otherText: string;
  onAnswer: (questionId: string, answer: string | string[]) => void;
  onSkip: (questionId: string) => void;
  onOtherTextChange: (questionId: string, text: string) => void;
}

function QuestionBlock({
  question,
  index,
  rawAnswer,
  isSkipped,
  isSubmitting,
  otherText,
  onAnswer,
  onSkip,
  onOtherTextChange,
}: QuestionBlockProps): JSX.Element {
  const selected = useMemo(() => parseSelectedOptions(rawAnswer), [rawAnswer]);

  /* Determine if "Other" is currently selected */
  const isOtherSelected = useMemo(() => {
    if (question.selectionMode === "single") {
      // "Other" is selected when the current answer doesn't match any predefined option
      return rawAnswer.length > 0 && !question.options.includes(rawAnswer);
    }
    return selected.some((v) => v === OTHER_OPTION_VALUE || v.startsWith("other:"));
  }, [rawAnswer, question.options, question.selectionMode, selected]);

  /* ── Option select handler ──────────────────────────── */
  const handleOptionSelect = useCallback(
    (optionValue: string) => {
      if (question.selectionMode === "single") {
        if (optionValue === OTHER_OPTION_VALUE) {
          // Select "Other" — seed with existing other text or empty
          onAnswer(question.id, otherText || "");
        } else {
          onAnswer(question.id, optionValue);
        }
      } else {
        // Multi-select: toggle the option
        if (optionValue === OTHER_OPTION_VALUE) {
          const hasOther = selected.some((v) => v === OTHER_OPTION_VALUE || v.startsWith("other:"));
          if (hasOther) {
            onAnswer(
              question.id,
              selected.filter((v) => v !== OTHER_OPTION_VALUE && !v.startsWith("other:")),
            );
          } else {
            onAnswer(question.id, [...selected, OTHER_OPTION_VALUE]);
          }
        } else {
          const already = selected.includes(optionValue);
          if (already) {
            onAnswer(
              question.id,
              selected.filter((v) => v !== optionValue),
            );
          } else {
            onAnswer(question.id, [...selected, optionValue]);
          }
        }
      }
    },
    [question, selected, onAnswer, otherText],
  );

  /* ── "Other" free-text handler ──────────────────────── */
  const handleOtherText = useCallback(
    (text: string) => {
      onOtherTextChange(question.id, text);

      if (question.selectionMode === "single") {
        onAnswer(question.id, text);
      } else {
        // Replace any existing "other:" entry with the new text
        const withoutOther = selected.filter(
          (v) => v !== OTHER_OPTION_VALUE && !v.startsWith("other:"),
        );
        onAnswer(question.id, [...withoutOther, text ? `other:${text}` : OTHER_OPTION_VALUE]);
      }
    },
    [question, selected, onAnswer, onOtherTextChange],
  );

  /* ── Build options list with "Other" appended ───────── */
  const optionsWithOther = useMemo(
    () => [
      ...question.options.map((opt) => ({
        value: opt,
        label: opt,
        isRecommended: opt === question.recommendedOption,
      })),
      {
        value: OTHER_OPTION_VALUE,
        label: "Other (type your own answer)",
        isRecommended: false,
      },
    ],
    [question.options, question.recommendedOption],
  );

  return (
    <div className={cn(styles.questionItem, isSkipped && styles.skipped)}>
      {/* Header: question text + number badge */}
      <div className={styles.questionHeader}>
        <p className={styles.questionText}>{question.question}</p>
        <span className={styles.questionNumber}>Q{index + 1}</span>
      </div>

      {/* Reason */}
      <p className={styles.questionReason}>Why this matters: {question.reason}</p>

      {/* Selection mode hint */}
      <p className={styles.selectionHint}>
        {question.selectionMode === "single" ? "Select one" : "Select all that apply"}
      </p>

      {/* Options grid */}
      <div className={styles.optionsGrid} role="listbox" aria-label={question.question}>
        {optionsWithOther.map((opt) => {
          const isOther = opt.value === OTHER_OPTION_VALUE;
          const optSelected = isOther
            ? isOtherSelected
            : question.selectionMode === "single"
              ? rawAnswer === opt.value
              : selected.includes(opt.value);

          return (
            <UOptionCard
              key={opt.value}
              value={opt.value}
              label={opt.label}
              isRecommended={opt.isRecommended}
              isSelected={optSelected}
              selectionMode={question.selectionMode}
              onSelect={handleOptionSelect}
              onOtherText={isOther ? handleOtherText : undefined}
              disabled={isSkipped || isSubmitting}
            />
          );
        })}
      </div>

      {/* Skip row */}
      <div className={styles.skipRow}>
        {isSkipped ? (
          <span className={styles.skippedBadge}>Skipped</span>
        ) : (
          <button
            type="button"
            className={styles.skipBtn}
            onClick={() => onSkip(question.id)}
            disabled={isSubmitting}
          >
            Skip this question
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────── */

/**
 * UQuestionBatch — renders all questions in the current batch simultaneously,
 * each with an option grid (UOptionCard), per-question skip buttons, and a
 * Submit Batch footer. Staggered slide-left entrance animation per question.
 * This is the primary orchestration component that replaces the old question list.
 */
export function UQuestionBatch({
  questions,
  answers,
  skippedQuestions,
  onAnswer,
  onSkip,
  onSubmitBatch,
  isSubmitting,
  className,
}: UQuestionBatchProps): JSX.Element {
  // Track free-text "Other" inputs per question (local state, not in store)
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});

  const handleOtherTextChange = useCallback((questionId: string, text: string) => {
    setOtherTexts((prev) => ({ ...prev, [questionId]: text }));
  }, []);

  // ── Derived counts ────────────────────────────────────
  const answeredCount = useMemo(
    () =>
      questions.filter(
        (q) => !skippedQuestions.includes(q.id) && (answers[q.id] ?? "").trim().length > 0,
      ).length,
    [questions, answers, skippedQuestions],
  );

  const skippedCount = useMemo(
    () => questions.filter((q) => skippedQuestions.includes(q.id)).length,
    [questions, skippedQuestions],
  );

  // ── Empty state ───────────────────────────────────────
  if (questions.length === 0) {
    return (
      <div className={cn(styles.root, className)}>
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>
            No more questions right now. The draft is likely ready for planning.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────
  return (
    <div className={cn(styles.root, className)}>
      {questions.map((question, index) => (
        <QuestionBlock
          key={question.id}
          question={question}
          index={index}
          rawAnswer={answers[question.id] ?? ""}
          isSkipped={skippedQuestions.includes(question.id)}
          isSubmitting={isSubmitting}
          otherText={otherTexts[question.id] ?? ""}
          onAnswer={onAnswer}
          onSkip={onSkip}
          onOtherTextChange={handleOtherTextChange}
        />
      ))}

      {/* Submit batch footer */}
      <div className={styles.batchFooter}>
        <p className={styles.batchHint}>
          {answeredCount}/{questions.length} answered
          {skippedCount > 0 ? ` · ${skippedCount} skipped` : ""}
        </p>
        <UButton
          variant="primary"
          onClick={onSubmitBatch}
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Submitting…" : "Submit Batch"}
        </UButton>
      </div>
    </div>
  );
}
