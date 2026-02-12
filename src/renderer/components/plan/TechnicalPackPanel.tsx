import type { JSX } from "react";
import type { TechnicalPack } from "@shared/types";
import { UCard } from "../ui";
import styles from "./TechnicalPackPanel.module.css";

export interface TechnicalPackPanelProps {
  technicalPack: TechnicalPack;
}

/**
 * TechnicalPackPanel -- shows architecture notes, risks, dependencies,
 * and test strategy from a plan's technical pack.
 *
 * Uses a two-column grid layout for the four sections.
 */
export function TechnicalPackPanel({ technicalPack }: TechnicalPackPanelProps): JSX.Element {
  return (
    <UCard title="Technical Pack" className={styles.panel}>
      <div className={styles.grid}>
        <Section title="Architecture" items={technicalPack.architecture_notes} />
        <Section title="Risks" items={technicalPack.risks} />
        <Section title="Dependencies" items={technicalPack.dependencies} />
        <Section title="Test Strategy" items={technicalPack.test_strategy} />
      </div>
    </UCard>
  );
}

/* ── Internal Section helper ────────────────────────────── */

interface SectionProps {
  title: string;
  items: string[];
}

function Section({ title, items }: SectionProps): JSX.Element {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {items.length > 0 ? (
        <ul className={styles.sectionList}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.emptyNote}>No items.</p>
      )}
    </div>
  );
}
