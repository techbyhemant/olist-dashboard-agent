/**
 * Golden operator questions used by the LLM-as-judge layer (evals/judge.test.ts).
 * `expectWidgetTypes` is a soft signal the judge can sanity-check against; the
 * judge scores answer-fit, not exact shape (wording/columns vary by run).
 */
export interface GoldenQuestion {
  id: string;
  question: string;
  expectWidgetTypes: string[];
}

export const GOLDEN_QUESTIONS: GoldenQuestion[] = [
  {
    id: 'top-categories',
    question: 'What are my top product categories by revenue?',
    expectWidgetTypes: ['chart'],
  },
  {
    id: 'monthly-trend',
    question: 'How has monthly revenue trended over time?',
    expectWidgetTypes: ['chart'],
  },
  {
    id: 'state-delivery',
    question: 'Which states have the slowest deliveries and lowest review scores?',
    expectWidgetTypes: ['table'],
  },
];
