import type { Track } from '../shared/types'

// Starter question bank for senior enterprise-sales interviews in India.
// ic = Enterprise Account Director track; leader = Head/VP Sales, Regional /
// National Sales Head, Country Manager / Business Head. `why` is what the
// panel is really testing — the thing a strong answer has to prove.
interface Seed { text: string; category: string; tracks: Track[]; why: string }
const B: Track[] = ['ic', 'leader']
const IC: Track[] = ['ic']
const L: Track[] = ['leader']

// What AI-first and tech-led companies probe when hiring enterprise sellers.
// Added in data version 2 — merged into existing question banks once.
export const AI_GTM_QUESTIONS: Seed[] = [
  { category: 'AI & tech GTM', tracks: B, text: 'Why AI, and why now? What makes you credible selling AI rather than traditional software?', why: 'Is this a genuine conviction backed by hands-on exposure, or a trend-chaser? They want proof you have used, built with or sold AI already.' },
  { category: 'AI & tech GTM', tracks: B, text: 'Explain what our product does, and how it works, to a bank CXO in two minutes.', why: 'Can you translate technology into business value without jargon — and without over-promising what the model can do?' },
  { category: 'AI & tech GTM', tracks: B, text: 'A CIO at a large bank says: “We can’t send customer data to an AI model — RBI, data residency, hallucinations.” How do you respond?', why: 'Handling the real objections in regulated Indian enterprises: data residency and sovereignty, deployment options, security reviews, human-in-the-loop, and evaluation evidence.' },
  { category: 'AI & tech GTM', tracks: B, text: 'Walk me through how you would take a customer from an AI pilot to a production contract.', why: 'Pilot purgatory is the biggest risk in AI sales. Do you define success criteria, an executive sponsor, a data plan and a commercial path before the pilot starts?' },
  { category: 'AI & tech GTM', tracks: B, text: 'A customer’s pilot showed weaker accuracy than promised. What do you do?', why: 'Honesty under pressure, working with product and engineering on evals and fixes, resetting expectations while keeping the deal alive.' },
  { category: 'AI & tech GTM', tracks: B, text: 'How would you price and package a usage-based AI platform for Indian enterprises?', why: 'Commercial fluency beyond seat licences: consumption, commits, credits, predictability for procurement, and margin awareness on compute.' },
  { category: 'AI & tech GTM', tracks: B, text: 'Build or buy? A customer’s IT team wants to build on open-source models themselves. How do you win?', why: 'Competing with “we’ll do it ourselves” — total cost, time-to-value, talent, maintenance and risk — without dismissing their team.' },
  { category: 'AI & tech GTM', tracks: B, text: 'How do you work with solution engineers, forward-deployed engineers and researchers to win a deal?', why: 'AI deals are won by a pod. Do you orchestrate technical teams well, and know when to put them in front of the customer?' },
  { category: 'AI & tech GTM', tracks: B, text: 'Which AI products do you use yourself, and what have you built or tried with them?', why: 'Hands-on curiosity. Sellers who use the tools daily sell them more credibly — they will probe for specifics.' },
  { category: 'AI & tech GTM', tracks: B, text: 'How would you build an Indian GSI and SI partner motion for an AI platform?', why: 'Route-to-market through Infosys/TCS/Wipro/Accenture and boutique SIs: incentives, co-selling, certification and avoiding channel conflict.' },
  { category: 'AI & tech GTM', tracks: L, text: 'We are early in India. How would you build the first enterprise book of business from zero?', why: 'Zero-to-one execution: picking beachhead verticals and lighthouse logos, the first hires, and what you would not do in year one.' },
  { category: 'AI & tech GTM', tracks: B, text: 'Tell me about the most technical product you have sold. How deep did you go?', why: 'Technical depth and learning speed — can you hold a credible conversation with a CTO and know when to bring in experts?' },
  { category: 'AI & tech GTM', tracks: B, text: 'This is a startup — ambiguity, little process, fast change. Why will you thrive here after a large company?', why: 'Culture fit for a fast AI company: ownership without a support structure, comfort with ambiguity, and evidence you have done it before.' }
]

export const SEED_QUESTIONS: Seed[] = [
  // Story & motivation
  { category: 'Story & motivation', tracks: B, text: 'Walk me through your career so far.', why: 'Can you tell a crisp 2-minute story with a clear through-line to this role, instead of reading out your CV?' },
  { category: 'Story & motivation', tracks: B, text: 'Why are you looking to move now?', why: 'Are you running toward something or away from something? Any red flags about your current situation?' },
  { category: 'Story & motivation', tracks: B, text: 'Why this company, and why this role?', why: 'Have you done real homework on the business, the product and the India opportunity — or is this one of fifty applications?' },
  { category: 'Story & motivation', tracks: B, text: 'What is the achievement you are proudest of?', why: 'What do you value, and can you prove scale and impact with numbers?' },
  { category: 'Story & motivation', tracks: B, text: 'Why should we pick you over the other finalists?', why: 'Do you know your differentiated edge, and can you say it with conviction without sounding arrogant?' },
  { category: 'Story & motivation', tracks: B, text: 'Where do you see yourself in three years?', why: 'Is your ambition aligned with the growth path here, and will you stay long enough to matter?' },
  { category: 'Story & motivation', tracks: IC, text: 'You could manage a team — why do you want a senior individual-contributor role?', why: 'Is the IC path a deliberate choice or a fallback? Will you be content without a team?' },
  { category: 'Story & motivation', tracks: L, text: 'What kind of leader are you, and how would your team describe you?', why: 'Self-awareness, leadership style, and whether it fits their culture.' },

  // Deal execution
  { category: 'Deal execution', tracks: B, text: 'Walk me through the largest deal you have closed, from first meeting to signature.', why: 'Complex-deal mastery: stakeholder mapping, business case, competition, negotiation, timeline, your personal role versus the team’s.' },
  { category: 'Deal execution', tracks: B, text: 'Tell me about a big deal you lost. What happened and what did you change afterwards?', why: 'Honesty, root-cause thinking and learning — not blaming product or pricing.' },
  { category: 'Deal execution', tracks: IC, text: 'How do you break into a strategic account where you have no relationship?', why: 'Hunting craft: research, point of view, multi-threading, using partners and existing customers.' },
  { category: 'Deal execution', tracks: B, text: 'How do you navigate a buying committee with CXO, IT, finance and procurement all involved?', why: 'Can you sell at the C-level and manage competing agendas, or do you get stuck at one champion?' },
  { category: 'Deal execution', tracks: IC, text: 'How do you qualify a deal, and when do you walk away?', why: 'Pipeline discipline — MEDDPICC or similar — and the courage to disqualify.' },
  { category: 'Deal execution', tracks: B, text: 'A deal has stalled for two months. What do you do?', why: 'Diagnosing the real blocker, creating urgency with a compelling event, re-engaging the economic buyer.' },
  { category: 'Deal execution', tracks: B, text: 'The customer is demanding a 30% discount at the last minute. How do you handle it?', why: 'Value-based negotiation, trading rather than conceding, protecting margin while closing.' },
  { category: 'Deal execution', tracks: IC, text: 'Tell me about growing an existing account significantly.', why: 'Land-and-expand: mapping white space, earning the right to expand, cross-sell and upsell.' },
  { category: 'Deal execution', tracks: B, text: 'How do you build a business case or ROI story for a CFO?', why: 'Selling outcomes rather than features; financial fluency.' },
  { category: 'Deal execution', tracks: IC, text: 'How do you work with presales, partners and your internal team to win a deal?', why: 'Orchestrating the virtual team — enterprise sellers win through others.' },
  { category: 'Deal execution', tracks: IC, text: 'How do you plan and prioritise across a portfolio of strategic accounts?', why: 'Account planning rigour and time allocation between hunting, farming and renewals.' },
  { category: 'Deal execution', tracks: B, text: 'How do you win against an entrenched competitor or an incumbent vendor?', why: 'Competitive strategy: finding the wedge, reframing the decision, de-risking the switch.' },

  // Numbers & forecasting
  { category: 'Numbers & forecasting', tracks: B, text: 'What was your quota and attainment over the last three years?', why: 'Hard evidence of consistent performance. Vagueness here is an instant red flag.' },
  { category: 'Numbers & forecasting', tracks: B, text: 'What are your typical deal size, sales cycle and win rate?', why: 'Do you know your own metrics, and does your motion match theirs?' },
  { category: 'Numbers & forecasting', tracks: B, text: 'How do you forecast, and how accurate have you been?', why: 'Commit discipline — leaders need numbers they can take to the board.' },
  { category: 'Numbers & forecasting', tracks: B, text: 'How much pipeline do you need to hit your number, and how do you build it?', why: 'Coverage math, pipeline generation sources, not relying on marketing alone.' },
  { category: 'Numbers & forecasting', tracks: L, text: 'Walk me through how you would build a plan to hit an annual number for this region.', why: 'Top-down and bottom-up planning: capacity, productivity, ramp, attrition, coverage.' },
  { category: 'Numbers & forecasting', tracks: L, text: 'Which metrics do you run your business on each week?', why: 'Operating cadence and the leading indicators you actually trust.' },

  // Team leadership
  { category: 'Team leadership', tracks: L, text: 'How do you build a high-performing enterprise sales team from scratch?', why: 'Hiring profile, sequencing, onboarding, culture, and how fast you get to productivity.' },
  { category: 'Team leadership', tracks: L, text: 'What do you look for when hiring enterprise sellers, and how do you test for it?', why: 'Hiring judgement — the single biggest lever a sales leader has.' },
  { category: 'Team leadership', tracks: L, text: 'Tell me about turning around an underperforming team or region.', why: 'Diagnosis, tough decisions, speed of impact, and measurable results.' },
  { category: 'Team leadership', tracks: L, text: 'A good rep is missing quota for the second quarter running. What do you do?', why: 'Coaching versus performance management, and fairness with firmness.' },
  { category: 'Team leadership', tracks: L, text: 'Your top performer is damaging team culture. How do you handle it?', why: 'Values versus numbers — will you protect culture when it costs revenue?' },
  { category: 'Team leadership', tracks: L, text: 'Tell me about a time you had to let someone go.', why: 'Decisiveness, empathy and process.' },
  { category: 'Team leadership', tracks: L, text: 'How do you set quotas and carve territories fairly?', why: 'Operational fairness, data-driven planning and motivation.' },
  { category: 'Team leadership', tracks: L, text: 'How do you drive accountability without micromanaging?', why: 'Leadership maturity and the operating rhythm you run.' },
  { category: 'Team leadership', tracks: L, text: 'How do you develop first-line sales managers?', why: 'Scaling through leaders — essential for regional and national roles.' },
  { category: 'Team leadership', tracks: L, text: 'How do you retain your best people when competitors come calling?', why: 'Career pathing, recognition and the environment you create.' },

  // Strategy, GTM & P&L
  { category: 'Strategy, GTM & P&L', tracks: L, text: 'What would your first 90 days in this role look like?', why: 'Structured thinking: listen, diagnose, early wins, plan — and not arriving with fixed answers.' },
  { category: 'Strategy, GTM & P&L', tracks: L, text: 'How would you shape our go-to-market strategy for India?', why: 'Market understanding, segmentation, channels, pricing and realism about India buying behaviour.' },
  { category: 'Strategy, GTM & P&L', tracks: L, text: 'Tell me about owning a P&L. Which levers did you pull?', why: 'Business-head thinking beyond revenue: margin, cost, investment trade-offs.' },
  { category: 'Strategy, GTM & P&L', tracks: L, text: 'Direct sales, channel partners or both — how do you decide in India?', why: 'Route-to-market judgement and partner-ecosystem experience.' },
  { category: 'Strategy, GTM & P&L', tracks: B, text: 'Which industry verticals would you prioritise for us, and why?', why: 'Commercial judgement and evidence you have studied their market.' },
  { category: 'Strategy, GTM & P&L', tracks: L, text: 'How do you balance growth against profitability?', why: 'Maturity about unit economics — especially relevant in today’s funding climate.' },
  { category: 'Strategy, GTM & P&L', tracks: L, text: 'How do you work with marketing to generate enterprise pipeline?', why: 'Account-based marketing, shared targets, and not blaming marketing.' },
  { category: 'Strategy, GTM & P&L', tracks: L, text: 'How would you represent the India business to a global leadership team that doubts it?', why: 'Managing up, building credibility with HQ, and securing investment.' },

  // Stakeholders & cross-functional
  { category: 'Stakeholders & influence', tracks: B, text: 'Tell me about a conflict with a peer or senior leader and how you resolved it.', why: 'Emotional intelligence and influencing without authority.' },
  { category: 'Stakeholders & influence', tracks: B, text: 'How do you bring customer feedback into the product roadmap?', why: 'Partnering with product without making promises you can’t keep.' },
  { category: 'Stakeholders & influence', tracks: B, text: 'Tell me about a time you had to say no to an important customer.', why: 'Integrity and protecting the company while keeping the relationship.' },
  { category: 'Stakeholders & influence', tracks: B, text: 'How do you work with customer success to protect renewals and grow accounts?', why: 'Owning the full lifecycle, not just the first signature.' },
  { category: 'Stakeholders & influence', tracks: B, text: 'Tell me about a time you escalated a critical customer issue. What did you do?', why: 'Ownership under pressure and how you mobilise internal resources.' },

  // Behavioural
  { category: 'Behavioural', tracks: B, text: 'Tell me about a significant failure and what you learned.', why: 'Self-awareness and accountability. A “failure” that is really a humblebrag loses points.' },
  { category: 'Behavioural', tracks: B, text: 'Tell me about a decision you made with incomplete information.', why: 'Judgement, bias for action, and how you manage risk.' },
  { category: 'Behavioural', tracks: B, text: 'Describe a time you changed your mind because of data or feedback.', why: 'Openness and intellectual honesty.' },
  { category: 'Behavioural', tracks: B, text: 'Tell me about an ethical grey area you faced in sales.', why: 'Integrity — a non-negotiable at senior levels.' },
  { category: 'Behavioural', tracks: B, text: 'Tell me about a time you went well beyond your role to win.', why: 'Ownership and entrepreneurial drive.' },
  { category: 'Behavioural', tracks: L, text: 'What is the biggest mistake you have made as a leader?', why: 'Humility and growth; how you have changed your leadership as a result.' },

  // Closing & logistics
  { category: 'Closing & logistics', tracks: B, text: 'What questions do you have for us?', why: 'Curiosity, depth of preparation, and how you evaluate them — this is part of the interview.' },
  { category: 'Closing & logistics', tracks: B, text: 'What are your compensation expectations?', why: 'Negotiation poise: anchoring on value and range without underselling or pricing yourself out.' },
  { category: 'Closing & logistics', tracks: B, text: 'Are you interviewing elsewhere, and what is your notice period?', why: 'Your market value and how hard they need to move, handled honestly and confidently.' },
  { category: 'Closing & logistics', tracks: B, text: 'Is there anything we haven’t covered that you want us to know?', why: 'Your last chance to land your single strongest differentiator.' },
  ...AI_GTM_QUESTIONS
]
