// The names the editor gives a project the user hasn't named, and a test for
// them: anything that wants the user's own name for their app (Director's
// title) must not mistake one of these for it.

const ADJECTIVES = [
  'Creative', 'Modern', 'Sleek', 'Bold', 'Elegant', 'Dynamic', 'Fresh', 'Vibrant',
  'Minimal', 'Classic', 'Artistic', 'Professional', 'Stylish', 'Innovative', 'Clean',
  'Bright', 'Cool', 'Warm', 'Sharp', 'Smooth',
];

const NOUNS = [
  'Design', 'Project', 'Studio', 'Canvas', 'Vision', 'Concept', 'Layout', 'Draft',
  'Sketch', 'Mockup', 'Template', 'Framework', 'Blueprint', 'Creation', 'Work',
  'Portfolio', 'Collection', 'Gallery', 'Showcase', 'Board',
];

/** A name for a new project nobody has named yet, such as "Sleek Canvas 412". */
export function randomProjectName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(Math.random() * 1000) + 1;
  return `${adjective} ${noun} ${number}`;
}

const RANDOM_NAME = new RegExp(`^(${ADJECTIVES.join('|')}) (${NOUNS.join('|')}) \\d{1,4}$`);

/**
 * True for a name the editor made up: "Untitled Project", a random name, or a
 * template's copy ("Blank Canvas Copy", "<template> Copy", named after the
 * template's made-up app).
 */
export function isMadeUpProjectName(name: string): boolean {
  const trimmed = name.trim();
  return !trimmed || /^untitled project$/i.test(trimmed) || RANDOM_NAME.test(trimmed) || / Copy$/.test(trimmed);
}
