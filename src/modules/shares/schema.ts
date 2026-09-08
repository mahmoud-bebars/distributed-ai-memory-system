export type ShareStatus =
  | { active: false }
  | { active: true; token: string; url: string };
