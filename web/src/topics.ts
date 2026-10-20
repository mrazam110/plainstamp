import type { Settings } from "./storage";

export interface TopicQuestion { text: string; apply: Partial<Settings> }
export interface Topic { key: string; title: string; de: string; icon: string; questions: TopicQuestion[] }

const germany: Partial<Settings> = { mode: "germany" };

/** Landing-page cards. Questions that depend on the state leave the scope open, so the answer asks "Which state?". */
export const TOPICS: Topic[] = [
  { key: "moving", title: "Moving", de: "Umzug", icon: "M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6",
    questions: [
      { text: "How do I register my new flat (Anmeldung)?", apply: germany },
      { text: "I'm moving from Brandenburg to Berlin. What do I need to do?", apply: { mode: "move", fromState: "de-bb", toState: "de-be" } },
    ] },
  { key: "residence", title: "Residence & visas", de: "Aufenthalt", icon: "M4 5h16v14H4zM8 10a2 2 0 104 0 2 2 0 00-4 0M7 16c.6-1.6 2-2.4 3-2.4s2.4.8 3 2.4M15 10h3M15 13h3",
    questions: [
      { text: "How do I apply for a residence permit?", apply: germany },
      { text: "What is the EU Blue Card and who can get it?", apply: germany },
    ] },
  { key: "tax", title: "Tax", de: "Steuern", icon: "M5 4h14v16l-2.3-1.5L14.3 20 12 18.5 9.7 20l-2.4-1.5L5 20zM9 9h6M9 13h6",
    questions: [
      { text: "How do I get my tax ID (Steuer-ID)?", apply: germany },
      { text: "Do I have to pay the broadcasting fee (Rundfunkbeitrag)?", apply: germany },
    ] },
  { key: "health", title: "Health insurance", de: "Krankenversicherung", icon: "M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10zM12 9v5M9.5 11.5h5",
    questions: [
      { text: "Do I need health insurance in Germany?", apply: germany },
      { text: "How do I choose between public and private insurance?", apply: germany },
    ] },
  { key: "family", title: "Family & children", de: "Familie", icon: "M8 8a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0M4 20c.4-3.4 2.6-5 5.5-5s5.1 1.6 5.5 5M17 11a2 2 0 100-4M17 14.5c2 .2 3.4 1.6 3.8 4.5",
    questions: [
      { text: "How do I apply for child benefit (Kindergeld)?", apply: germany },
      { text: "How do I find a childcare place (Kita)?", apply: germany },
    ] },
  { key: "vehicles", title: "Cars & driving", de: "Auto & Führerschein", icon: "M4 15v-3l2-5h12l2 5v3M4 15h16M4 15v3h3v-3M17 15v3h3v-3M7 12h10",
    questions: [
      { text: "Can I use my foreign driving licence in Germany?", apply: germany },
      { text: "How do I register a car (Kfz-Zulassung)?", apply: germany },
    ] },
  { key: "documents", title: "Certificates", de: "Urkunden", icon: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6",
    questions: [
      { text: "How do I get a registration certificate (Meldebescheinigung)?", apply: germany },
      { text: "How do I get a birth certificate (Geburtsurkunde)?", apply: germany },
    ] },
  { key: "marriage", title: "Getting married", de: "Eheschließung", icon: "M9 15a4 4 0 100-8 4 4 0 000 8zM15 17a4 4 0 100-8M12 3l1 2 2 .3-1.5 1.4.4 2L12 7.7",
    questions: [
      { text: "What do I need to get married in Germany?", apply: germany },
      { text: "Is my foreign marriage recognised in Germany?", apply: germany },
    ] },
];

/** Rotating hints in the question box. German first, since that is what officials will say. */
export const PLACEHOLDERS = [
  "How do I register my new flat?",
  "Was ist eine Steuer-ID?",
  "Do I need a visa to work here?",
  "Wie melde ich ein Auto an?",
  "How do I get child benefit?",
];
