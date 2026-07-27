// Domain presets: picking a domain at signup pre-loads sensible role keywords.
// Everything stays editable in Settings afterwards.
export const DOMAINS = {
  "Finance": {
    include: ["finance manager", "financial controller", "fp&a", "finance business partner",
      "financial analyst", "finance head", "chartered accountant", "treasury", "internal audit",
      "financial planning", "controller", "cfo"],
    profile: "Finance professional in India. [Describe your experience: FP&A, controllership, business partnering, audit, treasury, systems used, industries covered, team size managed.]"
  },
  "Sales": {
    include: ["sales manager", "business development", "account manager", "key accounts",
      "enterprise sales", "sales head", "regional sales", "territory manager", "inside sales",
      "sales director", "gtm"],
    profile: "Sales professional in India. [Describe your experience: industries sold into, deal sizes, quota performance, team leadership, notable accounts.]"
  },
  "Marketing": {
    include: ["marketing manager", "brand manager", "digital marketing", "growth marketing",
      "performance marketing", "product marketing", "content marketing", "marketing head",
      "demand generation", "seo"],
    profile: "Marketing professional in India. [Describe your experience: channels, budgets managed, campaigns, brands, metrics you moved.]"
  },
  "IT & Technology": {
    include: ["software engineer", "developer", "engineering manager", "devops", "data engineer",
      "data analyst", "qa", "product manager", "solution architect", "it manager",
      "cloud engineer", "full stack"],
    profile: "Technology professional in India. [Describe your experience: languages/stack, systems built, scale handled, certifications, team roles.]"
  },
  "Human Resources": {
    include: ["hr manager", "hr business partner", "talent acquisition", "recruiter",
      "hr generalist", "compensation", "learning and development", "hr head", "people operations"],
    profile: "HR professional in India. [Describe your experience: HRBP work, hiring volumes, policies, HRIS tools, employee relations.]"
  },
  "Operations": {
    include: ["operations manager", "program manager", "project manager", "supply chain",
      "process excellence", "operations head", "service delivery", "logistics", "procurement"],
    profile: "Operations professional in India. [Describe your experience: processes owned, teams run, cost/efficiency wins, tools and certifications.]"
  },
  "Customer Success & Support": {
    include: ["customer success", "customer support", "account management", "client servicing",
      "customer experience", "relationship manager", "service manager"],
    profile: "Customer success/support professional in India. [Describe your experience: portfolios handled, retention numbers, escalation management, tools.]"
  },
  "Consulting & Strategy": {
    include: ["consultant", "strategy", "business analyst", "transformation", "advisory",
      "engagement manager", "management consultant"],
    profile: "Consulting/strategy professional in India. [Describe your experience: practice areas, client industries, projects delivered, methodologies.]"
  }
};

export const COMMON_EXCLUDES = ["intern", "internship", "fresher", "apprentice"];

export const INDIA_HINTS = [
  "india", "bangalore", "bengaluru", "mumbai", "delhi", "gurgaon", "gurugram",
  "hyderabad", "pune", "chennai", "noida", "kolkata", "remote"
];

export function settingsForDomain(domain) {
  const d = DOMAINS[domain] || DOMAINS["Sales"];
  return {
    domain,
    includeKeywords: d.include,
    excludeKeywords: [...COMMON_EXCLUDES],
    indiaOnly: true,
    aiMatch: true,
    targetRoles: `${domain} roles in India at my level. [Edit this line to describe exactly what you're looking for.]`,
    profile: d.profile
  };
}
