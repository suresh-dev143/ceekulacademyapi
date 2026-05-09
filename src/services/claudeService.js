'use strict';

/**
 * Claude Service — wraps Anthropic SDK for all AI agent calls.
 *
 * Agents:
 *   co_teacher           — personalised tutoring during/after lecture
 *   content_optimizer    — refines lecture segments from engagement data
 *   ad_generator         — contextual, educational ad copy
 *   innovation_coach     — guides idea → deployed pipeline
 *   twin_summary         — refreshes digital twin AI summary
 *   research_mapper      — maps new research to existing content
 *   --- ADAPTIVE ENGINE ---
 *   micro_hook_generator — generates 1–2 sentence attention triggers for atoms
 *   cinematic_writer     — writes narrative + key-frame scripts for cinematic mode
 *   hypothesis_generator — generates research hypotheses + open questions from atom content
 *   atom_quality_writer  — AI-enriches a full ContentAtom from a core concept
 */

const Anthropic  = require('@anthropic-ai/sdk');
const AgentTask  = require('../models/agentTaskModel');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = 'claude-opus-4-6';

// Cost estimate: input $3/M tokens, output $15/M tokens → mapped to Neurons
const COST_PER_TOKEN = 0.000009;

// ── 1. AI Co-Teacher ─────────────────────────────────────────────────────────

async function runCoTeacher({ userId, sessionId, userMessage, contentContext, twinContext }) {
  const level   = twinContext?.cognitiveProfile?.level ?? 'beginner';
  const topics  = twinContext?.skills?.slice(0, 5).map(s => `${s.topic} (${s.mastery}%)`).join(', ') || 'none yet';

  const system = `You are a personalised AI co-teacher on the Ceekul platform.

Learner level: ${level}
Known topics (mastery %): ${topics}
Current content: "${contentContext?.title || 'general'}" — ${contentContext?.category || ''}

Your rules:
- Adapt explanation depth to the learner's level automatically.
- Beginner → use analogies and everyday language.
- Intermediate → introduce proper terminology with brief definitions.
- Advanced/Expert → engage with nuance, edge cases, and open problems.
- Never give an answer without explaining the underlying concept first.
- Keep responses ≤ 200 words unless the learner explicitly asks for detail.
- End every response with ONE of: a guiding question, a micro-challenge, or a "Try this:" prompt.
- If the learner seems confused (uses "I don't understand", "what?", "huh"), first ask what specific part is unclear.`;

  return _invoke({ agentType: 'co_teacher', userId, sessionId, system, userMessage });
}

// ── 2. Content Optimizer ─────────────────────────────────────────────────────

async function runContentOptimizer({ lectureId, triggerMetrics, segmentSummaries }) {
  const system = `You are a content optimization agent for an online learning platform.

You receive engagement analytics for a lecture and produce specific, actionable segment improvements.

Output ONLY valid JSON matching this exact schema — no markdown, no explanation outside JSON:
{
  "changeType": "prompt_refined|segment_reordered|difficulty_adjusted|example_added",
  "changeReason": "string",
  "changes": [
    {
      "segmentOrder": <number>,
      "action": "rewrite|add_example|simplify|add_visual_description|split",
      "detail": "string — specific instruction for this segment"
    }
  ],
  "expectedImpact": "string"
}

Rules:
- Target the segment with the lowest watch ratio OR where quiz score drops.
- Be specific — name the exact concept or minute range to fix.
- Never suggest removing content, only restructuring or enriching it.`;

  const userMessage = `Lecture ID: ${lectureId}
Metrics:
- Avg watch ratio: ${triggerMetrics.avgWatchRatio}
- Avg quiz score: ${triggerMetrics.avgQuizScore}%
- Drop-off at segment: ${triggerMetrics.dropOffSegment}
- Completion rate: ${triggerMetrics.completionRate}%

Segments:
${segmentSummaries.map((s, i) => `${i+1}. [${s.type}] ${s.title} — watch ratio: ${s.watchRatio ?? 'n/a'}`).join('\n')}

Produce improvement instructions.`;

  return _invoke({
    agentType: 'content_optimizer',
    userId:    null,
    sessionId: `lecture_${lectureId}`,
    system,
    userMessage,
    parseJson: true
  });
}

// ── 3. Contextual Ad Generator ───────────────────────────────────────────────

async function runAdGenerator({ userId, contentContext, twinContext, adCriteria }) {
  const system = `You are a contextual ad copy generator for an educational platform.

Generate SHORT, relevant ad content that feels like a micro-learning invitation, not an interruption.

Output ONLY valid JSON:
{
  "headline": "string — max 10 words",
  "body": "string — max 30 words",
  "cta": "Explore|Simulate|Join Project|Learn More|Try It",
  "relevanceReason": "string — one sentence explaining why this fits the learner"
}

Rules:
- The ad must connect to what the learner is currently studying.
- Frame as an invitation to explore, never as a sales pitch.
- Match the learner's cognitive level — simpler language for beginners.`;

  const userMessage = `Learner is watching: "${contentContext?.title}" (${contentContext?.category})
Learner level: ${twinContext?.cognitiveProfile?.level ?? 'beginner'}
Top interests: ${twinContext?.cognitiveProfile?.strongCategories?.join(', ') || 'general'}
Ad criteria: category=${adCriteria?.categories?.join('/')} theme=${adCriteria?.themes?.join('/')}

Generate contextual ad.`;

  return _invoke({
    agentType: 'ad_generator',
    userId,
    sessionId: `adgen_${userId}_${Date.now()}`,
    system,
    userMessage,
    parseJson: true
  });
}

// ── 4. Innovation Coach ──────────────────────────────────────────────────────

async function runInnovationCoach({ userId, idea, currentStage, stageHistory }) {
  const system = `You are an innovation coach helping students move ideas from concept to reality on the Ceekul platform.

Pipeline stages: idea → validation → research → simulation → prototype → deployed

Your coaching at each stage:
- idea:        Sharpen the problem statement, target user, and core hypothesis.
- validation:  Assess feasibility (0-10), novelty (0-10), impact (0-10), and market fit.
- research:    Identify existing work, knowledge gaps, and recommended sources.
- simulation:  Define what to model, success metrics, and tools to use.
- prototype:   Suggest minimum viable features and appropriate tech stack.
- deployed:    Plan launch strategy, feedback loops, and first iteration criteria.

Output ONLY valid JSON:
{
  "stageAssessment": "string",
  "strengths": ["string"],
  "gaps": ["string"],
  "nextActions": [{ "action": "string", "why": "string" }],
  "readyForNextStage": boolean,
  "nextStageRequirements": ["string"],
  "feasibility": <0-10 or null>,
  "novelty": <0-10 or null>,
  "impact": <0-10 or null>
}`;

  const historyText = stageHistory.map(s =>
    `${s.stage} (entered: ${s.enteredAt?.toISOString?.() ?? 'unknown'}): ${s.notes || 'no notes'}`
  ).join('\n');

  const userMessage = `Idea: "${idea.title}"
Description: ${idea.description}
Current stage: ${currentStage}
Tags: ${idea.tags?.join(', ') || 'none'}

Stage history:
${historyText}

Coach this student.`;

  return _invoke({
    agentType: 'innovation_coach',
    userId,
    sessionId: `innovation_${idea._id}`,
    system,
    userMessage,
    parseJson: true
  });
}

// ── 5. Digital Twin Summary ───────────────────────────────────────────────────

async function runTwinSummary({ twin }) {
  const system = `You are a learner analytics agent that summarises a student's digital twin.

Output ONLY valid JSON:
{
  "strengths": ["string"],
  "gaps": ["string"],
  "nextRecommended": ["topic-slug-1", "topic-slug-2", "topic-slug-3"],
  "learningStyle": "string",
  "encouragement": "string — one personalized, warm sentence"
}

Rules:
- Be specific, not generic. Reference actual topics from the data.
- nextRecommended must be actionable topic slugs (lowercase, hyphenated).
- Encouragement must feel personal, not templated.`;

  const topSkills = (twin.skills || [])
    .sort((a, b) => b.mastery - a.mastery)
    .slice(0, 10)
    .map(s => `${s.topic}: ${s.mastery}%`);

  const weakSkills = (twin.skills || [])
    .filter(s => s.mastery < 40)
    .slice(0, 5)
    .map(s => s.topic);

  const userMessage = `Learner profile:
Top skills: ${topSkills.join(', ') || 'none yet'}
Weak areas: ${weakSkills.join(', ') || 'none identified'}
Avg quiz score: ${twin.avgQuizScore ?? 0}%
Total watch time: ${twin.totalWatchMinutes ?? 0} min
Streak: ${twin.streakDays ?? 0} days
Preferred content: ${twin.preferences?.preferredContentTypes?.join(', ') || 'video'}
Cognitive level: ${twin.cognitiveProfile?.level ?? 'beginner'}

Generate the learner summary.`;

  return _invoke({
    agentType: 'twin_summary',
    userId:    twin.userId,
    sessionId: `twin_${twin.userId}`,
    system,
    userMessage,
    parseJson: true
  });
}

// ── 6. Research Mapper ────────────────────────────────────────────────────────

async function runResearchMapper({ lectureTitle, lectureCategory, existingSegments, researchTitle, researchAbstract }) {
  const system = `You are a research integration agent for an educational content platform.

Your job: decide which segments of a lecture should be updated given a new research paper.

Output ONLY valid JSON:
{
  "relevanceScore": <0-10>,
  "affectedSegments": [<segment order numbers>],
  "suggestedChanges": [
    {
      "segmentOrder": <number>,
      "changeType": "add_citation|update_explanation|add_example|flag_outdated",
      "detail": "string"
    }
  ],
  "researchSummary": "string — 2-3 sentence plain-language summary for learners",
  "whatChanged": "string — one sentence explaining how this research shifts understanding"
}`;

  const userMessage = `Lecture: "${lectureTitle}" (${lectureCategory})

Existing segments:
${existingSegments.map((s, i) => `${i+1}. [${s.type}] ${s.title}`).join('\n')}

New research paper:
Title: ${researchTitle}
Abstract: ${researchAbstract}

Determine which segments should be updated and how.`;

  return _invoke({
    agentType: 'research_mapper',
    userId:    null,
    sessionId: `research_${Date.now()}`,
    system,
    userMessage,
    parseJson: true
  });
}

// ── 7. Live Edit Assistant ────────────────────────────────────────────────────

/**
 * Real-time suggestion engine for the live collaborative editor.
 *
 * suggestionType:
 *   'explain'   — plain-language explanation of the selected text
 *   'example'   — concrete, relatable example for the concept
 *   'visual'    — description of a diagram / visual aid that would help
 *   'simplify'  — rewrite the selection in simpler language
 *   'expand'    — add more depth, detail, and nuance
 *   'question'  — generate a Socratic question that tests understanding
 *
 * Returns JSON so the Angular client can render suggestion + diff cleanly.
 */
async function runLiveEditAssistant({
  userId, lectureTitle, segmentTitle, segmentContent,
  selectedText, suggestionType, cognitiveTarget
}) {
  const system = `You are a real-time teaching assistant embedded in a live lecture editing tool.

A teacher has selected text from their lecture and requested a suggestion.
Your role: provide a short, immediately usable suggestion that the teacher can accept with one click.

Suggestion types and your behaviour for each:
- explain:   Write a concise (≤ 80 words) plain-language explanation of the selected concept.
- example:   Provide ONE concrete, relatable real-world example (≤ 60 words).
- visual:    Describe a specific diagram, chart, or visual aid (≤ 70 words) that would clarify the concept.
- simplify:  Rewrite ONLY the selected text in simpler language, preserving the meaning.
- expand:    Add 1-2 sentences of depth, nuance, or advanced context after the selected text.
- question:  Write ONE Socratic question (≤ 25 words) that directly tests understanding of the selection.

Cognitive target: ${cognitiveTarget ?? 'intermediate'}
Adapt language complexity, examples, and depth to this level automatically.

Output ONLY valid JSON — no markdown, no text outside JSON:
{
  "type": "${suggestionType}",
  "suggestion": "string — the actual suggestion text",
  "insertionHint": "before|after|replace",
  "rationale": "string — one sentence explaining why this helps (shown to teacher)"
}`;

  const userMessage = `Lecture: "${lectureTitle}"
Segment: "${segmentTitle}"

Full segment content:
${segmentContent}

Selected text (teacher's focus):
"${selectedText}"

Suggestion requested: ${suggestionType}

Generate suggestion.`;

  return _invoke({
    agentType:  'live_edit_assistant',
    userId,
    sessionId:  `liveedit_${userId}_${Date.now()}`,
    system,
    userMessage,
    parseJson:  true
  });
}

// ── 8. Multimedia Enricher ────────────────────────────────────────────────────

/**
 * Given a single segment's text content, Claude generates:
 *  - Accessible alt-text for each image concept mentioned
 *  - Short video clip labels and timestamps
 *  - Interactive element configs (quiz, drag-drop, simulation)
 *  - Animation cue definitions
 */
async function runMultimediaEnricher({ lectureTitle, segment }) {
  const system = `You are a multimedia content enrichment agent for an adaptive learning platform.

Given a lecture segment's text, generate structured multimedia assets that enhance learning across:
- Visual learners (images with alt text)
- Kinaesthetic learners (interactive elements)
- Auditory/video learners (video clip suggestions)
- All learners (animation cues that draw attention to key concepts)

Output ONLY valid JSON matching this exact schema — no markdown, no text outside JSON:
{
  "images": [
    {
      "concept": "string — what this image should depict",
      "alt": "string — detailed accessible alt text (≤ 120 chars)",
      "caption": "string — display caption (≤ 60 chars)",
      "order": <number — 1-indexed position within segment>
    }
  ],
  "videoClips": [
    {
      "label": "string — short description of what the clip demonstrates",
      "startSec": <suggested start second in a parent lecture video>,
      "endSec":   <suggested end second>,
      "purpose":  "demonstration|worked_example|real_world|historical"
    }
  ],
  "interactiveElements": [
    {
      "elementType": "quiz|drag-drop|simulation|code-sandbox|poll",
      "prompt": "string — the question or instruction shown to learner",
      "config": { <element-specific config object> }
    }
  ],
  "animationCues": [
    {
      "triggerWord": "string — exact word/phrase from segment content",
      "cueType": "highlight|zoom|transition|tooltip",
      "target": "string — CSS selector or descriptive label"
    }
  ]
}

Rules:
- Generate 1-3 images for concept segments; 0 for quiz segments.
- Generate at most 1 interactive element per segment; make it directly test the segment's core idea.
- Animation cues must reference exact words from the content.
- Keep configs minimal and valid JSON — no circular references.`;

  const userMessage = `Lecture: "${lectureTitle}"

Segment #${segment.order} — [${segment.type}] "${segment.title}"
Cognitive target: ${segment.cognitiveTarget || 'intermediate'}

Content:
${segment.content}

Generate multimedia assets.`;

  return _invoke({
    agentType: 'multimedia_enricher',
    userId:    null,
    sessionId: `enrich_${Date.now()}`,
    system,
    userMessage,
    parseJson: true
  });
}

// ── 8. Quality Checker ────────────────────────────────────────────────────────

/**
 * Analyses a segment's content for grammar errors, clarity issues,
 * excessive jargon, and ambiguous phrasing. Returns scores + issue list.
 */
async function runQualityChecker({ segment }) {
  const system = `You are an educational content quality assurance agent.

Evaluate the provided lecture segment content for:
1. Grammar accuracy       (0–100)
2. Clarity and readability (0–100) — appropriate for the stated cognitive level
3. Specific issues: grammar errors, ambiguous sentences, unexplained jargon, passive-voice overuse

Output ONLY valid JSON:
{
  "grammarScore": <0-100>,
  "clarityScore": <0-100>,
  "overallVerdict": "pass|needs_review|fail",
  "issues": [
    {
      "issueType": "grammar|ambiguity|jargon|passive_voice|structure",
      "location": "string — short excerpt from the content showing the issue",
      "suggestion": "string — specific correction or rewording"
    }
  ],
  "revisedContent": "string — full revised content with all issues fixed (only if overallVerdict is not pass)"
}

Scoring guide:
- grammarScore < 60 → fail
- clarityScore < 60 → fail
- Both ≥ 80 → pass without revision
- Either between 60–79 → needs_review

Rules:
- Be precise: quote the exact problematic text in "location".
- "revisedContent" must be the complete revised segment text, not just the fix.
- If verdict is "pass", set revisedContent to null.`;

  const userMessage = `Segment #${segment.order} — [${segment.type}] "${segment.title}"
Cognitive target: ${segment.cognitiveTarget || 'intermediate'}

Content to evaluate:
${segment.content}

Run quality analysis.`;

  return _invoke({
    agentType: 'quality_checker',
    userId:    null,
    sessionId: `quality_${Date.now()}`,
    system,
    userMessage,
    parseJson: true
  });
}

// ── 9. Chat Moderator ─────────────────────────────────────────────────────────

/**
 * Real-time moderation of a single chat message.
 * Returns: { status, score, flags, reason, isQuestion, sentiment, keywords }
 */
async function runChatModerator({ message, authorName, lectureContext }) {
  const system = `You are a real-time chat moderator for an educational live lecture platform.

Your role: assess each chat message quickly and accurately.

Status rules:
- "approved"  — educational, respectful, on-topic OR reasonable off-topic social interaction
- "flagged"   — borderline: mild rudeness, spam-like repetition, distracting off-topic
- "blocked"   — hate speech, harassment, explicit content, severe spam, personal attacks

Output ONLY valid JSON — no markdown, no text outside JSON:
{
  "status":      "approved|flagged|blocked",
  "score":       <0.0-1.0 — toxicity/violation probability>,
  "flags":       ["array of violated categories, empty if approved"],
  "reason":      "one sentence human-readable explanation",
  "isQuestion":  <boolean — is this a genuine educational question?>,
  "sentiment":   "positive|neutral|negative",
  "keywords":    ["up to 5 keywords extracted from the message"]
}`;

  const userMessage = `Lecture context: ${lectureContext || 'General educational content'}
Author: ${authorName}
Message: "${message}"

Moderate this message.`;

  return _invoke({
    agentType:  'chat_moderator',
    userId:     null,
    sessionId:  `moderation_${Date.now()}`,
    system,
    userMessage,
    parseJson:  true
  });
}

// ── 10. Chat Summarizer ───────────────────────────────────────────────────────

/**
 * Summarises the last N chat messages into key points, questions, and themes.
 * Returns: { summary, keyQuestions, themes, sentiment }
 */
async function runChatSummarizer({ messages, lectureTitle, segmentTitle }) {
  const formatted = messages
    .map(m => `[${m.role}] ${m.authorName}: ${m.content}`)
    .join('\n');

  const system = `You are an AI assistant that summarises live lecture chat sessions for teachers.

Output ONLY valid JSON — no markdown, no text outside JSON:
{
  "summary":      "2-3 sentence overview of chat activity and discussion topics",
  "keyQuestions": ["up to 5 most important questions students asked"],
  "themes":       ["up to 4 recurring themes or discussion topics"],
  "sentiment":    "positive|neutral|negative|mixed"
}`;

  const userMessage = `Lecture: "${lectureTitle}"
${segmentTitle ? `Current segment: "${segmentTitle}"` : ''}

Chat messages (${messages.length} total):
${formatted}

Generate the chat summary.`;

  return _invoke({
    agentType:  'chat_summarizer',
    userId:     null,
    sessionId:  `summary_${Date.now()}`,
    system,
    userMessage,
    parseJson:  true
  });
}

// ── 11. Insight Extractor ─────────────────────────────────────────────────────

/**
 * Extracts pedagogical insights from chat messages — confusion points,
 * engagement signals, and concrete recommendations for the teacher.
 * Returns: { insights, confusionPoints, engagementLevel, recommendedActions, questionCount, participationRate }
 */
async function runInsightExtractor({ messages, lectureTitle }) {
  const formatted = messages
    .map(m => `[${m.role}] ${m.authorName}: ${m.content}`)
    .join('\n');

  const uniqueAuthors = new Set(messages.map(m => m.authorId)).size;
  const totalStudents = messages.filter(m => m.role === 'student').length;

  const system = `You are an educational analytics AI that extracts pedagogical insights from live lecture chat.

Your insights help teachers make real-time adjustments to improve learning outcomes.

Output ONLY valid JSON — no markdown, no text outside JSON:
{
  "insights":            ["up to 6 key pedagogical observations about understanding, confusion, or engagement"],
  "confusionPoints":     ["specific concepts or topics where students showed confusion"],
  "engagementLevel":     "low|medium|high",
  "recommendedActions":  ["up to 3 concrete actions the teacher should take right now"],
  "questionCount":       <integer — number of genuine educational questions in the chat>,
  "participationRate":   <integer 0-100 — estimated % of unique participants who sent messages>
}`;

  const userMessage = `Lecture: "${lectureTitle}"
Unique participants: ${uniqueAuthors}
Messages analysed: ${messages.length}

Chat messages:
${formatted}

Extract pedagogical insights.`;

  return _invoke({
    agentType:  'insight_extractor',
    userId:     null,
    sessionId:  `insights_${Date.now()}`,
    system,
    userMessage,
    parseJson:  true
  });
}

// ── Core runner ───────────────────────────────────────────────────────────────

async function _invoke({ agentType, userId, sessionId, system, userMessage, parseJson = false, maxTokens = 1024 }) {
  const t0 = Date.now();

  const task = await AgentTask.create({
    agentType, userId, sessionId,
    prompt: userMessage,
    context: { system: system.slice(0, 200) },
    status: 'running'
  });

  try {
    const msg = await client.messages.create({
      model:      MODEL,
      max_tokens: maxTokens,
      system,
      messages:   [{ role: 'user', content: userMessage }]
    });

    const text      = msg.content[0].text.trim();
    const latencyMs = Date.now() - t0;
    const cost      = (msg.usage.input_tokens + msg.usage.output_tokens) * COST_PER_TOKEN;

    await AgentTask.findByIdAndUpdate(task._id, {
      response:    text,
      tokensIn:    msg.usage.input_tokens,
      tokensOut:   msg.usage.output_tokens,
      latencyMs,
      costNeurons: cost,
      status:      'done'
    });

    if (!parseJson) return text;

    // Strip markdown code fences if Claude wraps JSON in them
    const clean = text.replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'').trim();
    return JSON.parse(clean);

  } catch (err) {
    await AgentTask.findByIdAndUpdate(task._id, {
      status: 'failed',
      error:  err.message
    });
    throw err;
  }
}

// ── ADAPTIVE ENGINE AGENTS ────────────────────────────────────────────────────

// ── A1. Micro-Hook Generator ──────────────────────────────────────────────────

async function runMicroHookGenerator({ atomTitle, coreConcept, keywords = [], difficulty = 2, animationType = 'pulse' }) {
  const system = `You are an attention-trigger copywriter for an adaptive learning platform.

Your job: write a powerful 1–2 sentence micro-hook for a content atom that will instantly grab a learner's attention and make them curious to learn more.

Rules:
- Exactly 1–2 sentences. No more.
- Open with a surprising fact, a provocative question, or a counter-intuitive statement.
- The hook must be directly relevant to the concept — no bait-and-switch.
- Avoid generic openers ("Did you know...", "Have you ever wondered...").
- Difficulty ${difficulty}/5 — adjust vocabulary accordingly (1=very simple, 5=expert).
- End with subtle momentum toward exploration, not a direct command.

Output ONLY valid JSON:
{
  "text": "the 1-2 sentence hook",
  "animationType": "${animationType}",
  "colorScheme": "indigo|emerald|amber|rose|cyan",
  "audioTone": "calm|dramatic|curious|energetic",
  "durationMs": 7000
}`;

  const userMessage = `Concept: "${atomTitle}"
Summary: ${coreConcept}
Keywords: ${keywords.join(', ')}`;

  return _invoke({ agentType: 'micro_hook_generator', userId: null, sessionId: `hook_${Date.now()}`, system, userMessage, parseJson: true });
}

// ── A2. Cinematic Writer ──────────────────────────────────────────────────────

async function runCinematicWriter({ atomTitle, coreConcept, formalDefinition, difficulty = 2, targetDuration = 120 }) {
  const system = `You are a cinematic education scriptwriter for an adaptive learning platform.

Write a compelling narrative explanation of a concept suitable for cinematic/film-mode delivery.
The explanation should feel like a high-quality documentary — vivid, structured, story-driven.

Structure:
- Open with a real-world hook scene (20%)
- Build to core concept reveal (40%)
- Concrete examples + analogies (30%)
- Close with an implication or open question (10%)

Difficulty ${difficulty}/5.

Output ONLY valid JSON:
{
  "narrative": "full narrative text ≤ 400 words",
  "textSections": [
    { "heading": "section title", "body": "section content", "visualHint": "description of ideal visual" }
  ],
  "keyFrames": [
    { "secondsIn": 0, "visual": "visual description", "narration": "narration text", "transition": "fade|slide|zoom|dissolve|cut" }
  ],
  "totalDuration": ${targetDuration},
  "audioTone": "calm|dramatic|curious|inspiring"
}`;

  const userMessage = `Title: "${atomTitle}"
Concept: ${coreConcept}
Definition: ${formalDefinition || 'not provided'}`;

  return _invoke({ agentType: 'cinematic_writer', userId: null, sessionId: `cin_${Date.now()}`, system, userMessage, parseJson: true });
}

// ── A3. Hypothesis Generator ──────────────────────────────────────────────────

async function runHypothesisGenerator({ atomTitle, coreConcept, existingQuestions = [], relatedPapers = [] }) {
  const system = `You are a research ideation agent for an adaptive learning platform.

Given a core educational concept, generate intellectually stimulating:
1. Open research questions (unsolved, thought-provoking)
2. Testable hypotheses (specific, falsifiable)
3. Future research directions (innovative, forward-looking)

The output should inspire curious learners to think like researchers.

Output ONLY valid JSON:
{
  "openQuestions": ["3–5 open questions"],
  "hypotheses": ["2–4 falsifiable hypotheses"],
  "futureDirections": ["2–3 future research directions"],
  "researchDifficulty": "undergraduate|graduate|expert"
}`;

  const existingStr = existingQuestions.length
    ? `Existing questions (avoid duplicates): ${existingQuestions.slice(0, 5).join('; ')}`
    : '';
  const papersStr = relatedPapers.length
    ? `Related papers: ${relatedPapers.map(p => p.title).slice(0, 3).join(', ')}`
    : '';

  const userMessage = `Concept: "${atomTitle}"
Summary: ${coreConcept}
${existingStr}
${papersStr}`;

  return _invoke({ agentType: 'hypothesis_generator', userId: null, sessionId: `hyp_${Date.now()}`, system, userMessage, parseJson: true });
}

// ── A4. Atom Quality Writer ───────────────────────────────────────────────────
// Given a bare-bones atom (title + core concept), fills all 6 layers via AI.

async function runAtomQualityWriter({ atomTitle, coreConcept, topicId, difficulty = 2, keywords = [] }) {
  const system = `You are an expert educational content architect.

Given a core concept, produce a complete ContentAtom for an adaptive learning system.
You must fill all content layers with high-quality, accurate, engaging content.

Output ONLY valid JSON matching this structure exactly:
{
  "microHook": {
    "text": "1-2 sentence attention hook",
    "animationType": "pulse|float|reveal|zoom|particle|glitch|typewriter|none",
    "colorScheme": "indigo|emerald|amber|rose|cyan",
    "durationMs": 7000
  },
  "cinematicExplanation": {
    "narrative": "full narrative ≤ 300 words",
    "textSections": [{ "heading": "", "body": "", "visualHint": "" }],
    "keyFrames": [{ "secondsIn": 0, "visual": "", "narration": "", "transition": "fade" }],
    "totalDuration": 120
  },
  "simulation": {
    "simType": "graph|drag-drop|physics|code-sandbox|quiz-flow|decision-tree|slider-params",
    "config": {},
    "objective": "what the learner should discover",
    "successCriteria": "how success is measured",
    "difficulty": ${difficulty},
    "hints": ["hint 1", "hint 2"]
  },
  "xr": {
    "sceneType": "3d-model|spatial-diagram|vr-lab|ar-overlay|micro-world|data-viz",
    "interactionPoints": ["point 1", "point 2"],
    "lightingPreset": "warm|cool|dramatic|neutral|neon",
    "annotations": [{ "label": "", "position": {}, "content": "" }]
  },
  "researchExtension": {
    "openQuestions": ["3 questions"],
    "hypotheses": ["2 hypotheses"],
    "futureDirections": ["2 directions"]
  },
  "tags": ["3-5 tags"],
  "qualityScore": 0
}`;

  const userMessage = `Title: "${atomTitle}"
TopicId: ${topicId}
Core concept: ${coreConcept}
Keywords: ${keywords.join(', ')}
Difficulty: ${difficulty}/5`;

  return _invoke({ agentType: 'atom_quality_writer', userId: null, sessionId: `atom_${Date.now()}`, system, userMessage, parseJson: true, maxTokens: 2048 });
}

// ── 12. Workshop Generator ────────────────────────────────────────────────────

/**
 * Generates a complete 3-hour workshop plan from a topic + audience config.
 * Returns structured JSON ready for the create-workshop form.
 */
async function runWorkshopGenerator({ topic, audience, language, mode }) {
  const system = `You are an expert educator and instructional designer.

Generate a complete, practical 3-hour workshop plan.

Output ONLY valid JSON — no markdown fences, no text outside the JSON object.

Required JSON schema (use exactly these keys):
{
  "workshopTitle": "string — concise, engaging title (max 80 chars)",
  "shortDescription": "string — 1-2 sentences",
  "longDescription": "string — 3-5 sentences describing outcomes, prerequisites, and value (max 800 chars)",
  "learningObjectives": ["5-7 specific, measurable objective strings"],
  "hour1": {
    "title": "string — descriptive title for the concept-teaching hour",
    "explanation": "string — detailed explanation, 150-200 words",
    "keyConcepts": ["3-5 key concept strings"],
    "examples": ["2-3 concrete example strings"],
    "visualSuggestions": ["2-3 slide/diagram/visual aid ideas"]
  },
  "hour2": {
    "title": "Hands-on",
    "practicalExercises": ["2-3 hands-on exercise descriptions"],
    "stepByStepTasks": ["3-5 numbered task step strings"],
    "realWorldUseCase": "string — one real-world scenario tying it together"
  },
  "hour3": {
    "title": "Open Discussion",
    "discussionQuestions": ["3-5 thought-provoking discussion questions"],
    "caseStudies": ["1-2 brief case study descriptions"],
    "qaPrompts": ["2-3 Q&A starter prompts"]
  },
  "quiz": [
    { "question": "string", "answer": "string" }
  ],
  "assignment": "string — clear post-workshop assignment description",
  "requiredMaterials": ["3-5 materials/tools/prerequisites"],
  "adsPlacementNote": "string — suggested 10-min break placement context"
}`;

  const userMessage = `Topic: ${topic}
Target Audience: ${audience}
Language: ${language}
Mode: ${mode}

Generate the complete workshop plan now.`;

  return _invoke({
    agentType: 'workshop_generator',
    userId:    null,
    sessionId: `workshop_gen_${Date.now()}`,
    system,
    userMessage,
    parseJson: true,
    maxTokens: 4096
  });
}

// ── PLAYBACK OVERLAY AGENTS ───────────────────────────────────────────────────

// ── O1. Overlay Summarizer ────────────────────────────────────────────────────
/**
 * Generates a concise segment-summary overlay for a specific timestamp
 * in an immutable recording. The source content is never modified.
 */
async function runOverlaySummarizer({ sourceId, sourceTitle, timestamp, segmentText }) {
  const system = `You are an AI overlay generator for an immutable educational video platform.

Your role: generate a concise SEGMENT SUMMARY overlay shown to learners at a specific playback timestamp.
The video content is immutable — your overlay is a transparent reading layer on top.

Output ONLY valid JSON — no markdown, no text outside JSON:
{
  "headline": "string — max 8 words, captures the key idea at this moment",
  "body": "string — 2-3 sentences summarising what was just covered",
  "concepts": ["array", "of", "key", "terms", "max 4"],
  "difficulty": "beginner | intermediate | advanced"
}

Rules:
- headline must be a noun phrase or curiosity-driving question — NOT a full sentence.
- body must be self-contained so a learner who paused here understands the core idea.
- Never start body with "In this segment", "This section covers", or "Here we see".
- concepts must be exact domain terms, not phrases.`;

  const userMessage = `Source: "${sourceTitle}" (ID: ${sourceId})
Timestamp: ${timestamp}s
Segment notes/transcript: ${segmentText || 'No transcript — infer from the timestamp context.'}

Generate a segment summary overlay.`;

  return _invoke({
    agentType:  'overlay_summarizer',
    userId:     null,
    sessionId:  `overlay_sum_${sourceId}_${timestamp}`,
    system,
    userMessage,
    parseJson:  true
  });
}

// ── CONTENT VALIDATION ENGINE ─────────────────────────────────────────────────

const VALIDATOR_MODEL = 'claude-opus-4-7';

// Cached system prompt block — reused across all validation calls
const VALIDATOR_SYSTEM = [
  {
    type: 'text',
    text: `You are an AI content moderation engine for the Ceekul community platform.
Ceekul is a positive, community-focused learning and civic participation platform.

Evaluate submitted content across three dimensions and return a strict JSON object.

Dimensions:
1. category_match_score (0-100): How well the content fits the declared category. 100 = perfect match, 0 = completely wrong category.
2. safety_score (0-100): Appropriateness and safety. 100 = fully safe, 0 = extremely harmful/offensive.
3. quality_score (0-100): Content quality, coherence, and value. 100 = excellent, 0 = spam/gibberish.

Decision rules (apply in order):
- REJECTED: safety_score < 40 — content is harmful, abusive, or dangerous
- REJECTED: quality_score < 20 — pure spam or gibberish
- NEEDS_REVIEW: any score in [40, 69] — borderline, requires human review
- APPROVED: all scores >= 70 — publish immediately

Categories on Ceekul: education, health, community, justice, environment, culture, innovation, entrepreneurship, governance.

Hard rejections (always REJECTED):
- Content promoting violence, self-harm, or harm to others
- Sexual content of any kind
- Hate speech targeting any group
- Spam, scams, or commercial solicitation unrelated to community purpose

Output ONLY valid JSON — no markdown, no text outside the JSON object:
{
  "status": "APPROVED",
  "reason": "one concise sentence explaining the decision",
  "category_match_score": 85,
  "safety_score": 95,
  "quality_score": 78
}`,
    cache_control: { type: 'ephemeral' }
  }
];

async function runContentValidator({ userId, title, description, category }) {
  const t0 = Date.now();

  const userMessage = `Category declared: ${category}
Title: ${title}
Description: ${description}

Evaluate this content submission.`;

  const task = await AgentTask.create({
    agentType:  'content_validator',
    userId,
    sessionId:  `validate_${Date.now()}`,
    prompt:     userMessage,
    context:    { category, title: title.slice(0, 100) },
    status:     'running'
  });

  try {
    const msg = await client.messages.create({
      model:      VALIDATOR_MODEL,
      max_tokens: 512,
      thinking:   { type: 'adaptive' },
      system:     VALIDATOR_SYSTEM,
      messages:   [{ role: 'user', content: userMessage }]
    });

    // Skip thinking blocks — find the text block
    const textBlock = msg.content.find(b => b.type === 'text');
    const text = textBlock?.text?.trim() ?? '';

    const latencyMs = Date.now() - t0;
    const cost = (msg.usage.input_tokens + msg.usage.output_tokens) * COST_PER_TOKEN;

    await AgentTask.findByIdAndUpdate(task._id, {
      response:    text,
      tokensIn:    msg.usage.input_tokens,
      tokensOut:   msg.usage.output_tokens,
      latencyMs,
      costNeurons: cost,
      status:      'done'
    });

    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    await AgentTask.findByIdAndUpdate(task._id, { status: 'failed', error: err.message });
    throw err;
  }
}

// ── O2. Personalized Explainer ────────────────────────────────────────────────
/**
 * Generates a learner-adapted concept explanation at a specific timestamp.
 * Adapts depth and vocabulary to the learner's proficiency level.
 */
async function runPersonalizedExplainer({ userId, sessionId, concept, timestamp, sourceTitle, proficiencyLevel }) {
  const levelMap = {
    beginner:     'Use everyday language and strong analogies. Avoid jargon. Prioritise intuition.',
    intermediate: 'Introduce domain terminology with inline definitions. Balance intuition with precision.',
    advanced:     'Engage with nuance, edge-cases, and open problems. Skip basic definitions.'
  };
  const levelGuide = levelMap[proficiencyLevel] || levelMap.intermediate;

  const system = `You are a personalized AI explainer for an immutable educational video platform.

A learner paused playback at a specific timestamp and needs a concept explained at their proficiency level.
The video is immutable — your explanation is an adaptive overlay layer, not a modification.

Proficiency: ${proficiencyLevel || 'intermediate'}
Guidance: ${levelGuide}

Output ONLY valid JSON — no markdown, no text outside JSON:
{
  "headline": "string — concept name or guiding question, max 8 words",
  "body": "string — 3-4 sentence personalised explanation",
  "analogy": "string — one concrete analogy (empty string if not applicable)",
  "tryThis": "string — one micro-challenge or reflection prompt",
  "concepts": ["related", "domain", "terms"]
}

Rules:
- headline must orient the learner immediately — what is being explained.
- analogy must use a familiar, everyday situation — not another technical concept.
- tryThis must be completable within 2 minutes without external resources.`;

  const userMessage = `Concept to explain: "${concept}"
Timestamp: ${timestamp}s in "${sourceTitle}"
Learner proficiency: ${proficiencyLevel || 'intermediate'}

Generate a personalised explanation overlay.`;

  return _invoke({
    agentType:  'personalized_explainer',
    userId,
    sessionId:  sessionId || `overlay_exp_${userId}_${timestamp}`,
    system,
    userMessage,
    parseJson:  true
  });
}

// ── Content Evaluator (Share / Send gate) ─────────────────────────────────────
// Uses Haiku for low cost — output is max ~256 tokens of strict JSON.

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

async function runContentEvaluator({ userId, title, subtitle, snippet }) {
  const t0 = Date.now();

  const userMessage = `Title: ${title}
Subtitle: ${subtitle || '(none)'}
Content Snippet: ${snippet || '(none)'}`;

  const system = `You are a strict content evaluation system for an educational platform.

Tasks:
1. Safety Check: detect abusive/hateful language, explicit adult/sexual content, religious or politically sensitive content.
2. Classification: classify as exactly one of: safe | sensitive | adult | abusive
3. Relevance: score 0–1 for how well content body matches title and subtitle.
4. Category Hint: suggest best fit from: Course, Workshop, Project, Research, Advertisement, Entertainment
5. Routing: adult content may only appear in adult-enabled zones; abusive is never allowed.

Output STRICT JSON only — no markdown fences, no explanation:
{
  "status": "allow|review|restrict",
  "classification": "safe|sensitive|adult|abusive",
  "relevance": 0.0,
  "category": "Course|Workshop|Project|Research|Advertisement|Entertainment",
  "issues": [],
  "routing": { "allowed": true, "reason": "" }
}

Rules:
- safe → status allow
- sensitive → status review
- adult → status restrict (routing.allowed=false) unless explicitly noted as adult-enabled
- abusive → status restrict always`;

  const task = await AgentTask.create({
    agentType: 'content_evaluator', userId, sessionId: `eval_${userId}_${Date.now()}`,
    prompt: userMessage, context: { system: system.slice(0, 200) }, status: 'running'
  });

  try {
    const msg = await client.messages.create({
      model: HAIKU_MODEL, max_tokens: 256, system,
      messages: [{ role: 'user', content: userMessage }]
    });

    const text      = msg.content[0].text.trim();
    const latencyMs = Date.now() - t0;
    const cost      = (msg.usage.input_tokens + msg.usage.output_tokens) * COST_PER_TOKEN;

    await AgentTask.findByIdAndUpdate(task._id, {
      response: text, tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens,
      latencyMs, costNeurons: cost, status: 'done'
    });

    // Strip possible markdown fences if model slips up
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(clean);
  } catch (err) {
    await AgentTask.findByIdAndUpdate(task._id, { status: 'error', error: err.message });
    throw err;
  }
}

// ── Session Post-Processor ────────────────────────────────────────────────────
/**
 * Called after a workshop session ends. Generates a summary, key topics,
 * and learner insights from the session metadata.
 * Returns: { summary, keyTopics: string[], insights: string[] }
 */
async function runSessionPostProcessor({ sessionCid, title, totalSecs, peakParticipants, totalMessages }) {
  const mins = Math.round(totalSecs / 60);

  const system = `You are a post-session intelligence agent for an educational live-session platform.

Given session metadata, generate a concise, useful session record.

Output ONLY valid JSON:
{
  "summary": "string — 2-3 sentence summary of what the session covered and its value",
  "keyTopics": ["3-6 topic strings discussed"],
  "insights": ["2-4 actionable insight strings for the host to improve future sessions"]
}

Rules:
- summary must mention the session title and participation level.
- keyTopics should be specific, not generic (e.g., "React useState hook" not "programming").
- insights must be concrete and actionable, not platitudes.`;

  const userMessage = `Session CID: ${sessionCid}
Title: "${title}"
Duration: ${mins} minutes
Peak participants: ${peakParticipants}
Total chat messages: ${totalMessages}

Generate session record.`;

  return _invoke({
    agentType: 'chat_summarizer',
    userId:    null,
    sessionId: `session_post_${sessionCid}`,
    system,
    userMessage,
    parseJson: true,
    maxTokens: 512
  });
}

// ── DQRG Content-Bound Intelligence ──────────────────────────────────────────

const DQRG_OUTPUT_RULES = `
HARD COST RULES (obey strictly):
1. Check the interaction history first — if the answer already exists, compress and return it; do NOT regenerate.
2. Prefer retrieval over generation, summarisation over explanation, structure over verbosity.
3. Never repeat reasoning that appeared in a prior turn.
4. If the learner's intent is ambiguous, respond with ONE clarifying question only — do not guess.
5. Never answer about topics outside the active content CID.

MANDATORY OUTPUT FORMAT — every reply must follow this exact structure:
Key Insight: [1–3 lines — the essential answer, drawn only from the active content]
CID Reference: [one term or concept from the active content that anchors this insight — omit line if not applicable]
Next Action: [one concrete follow-up for the learner — omit line if not applicable]

No long explanations. No storytelling. No repetition. Speak less, deliver more.`;

const DQRG_SYSTEM = {
  DISCUSS: `You are a content-attached AI tutor operating within the Ceekul DQRG Intelligence Layer.
This chat exists ONLY for the content currently active in the learner's panel (identified by CID).

Mode: DISCUSS — deep understanding via minimal, precise explanation.
- Explain the concept using the content itself; draw analogies only from within the content.
- Layer minimally: give the simplest correct insight first, extend only if the learner asks.
- End with ONE guiding question or "Try this:" micro-challenge — never skip this.
- If the learner seems confused, ask what specific part is unclear before explaining further.
${DQRG_OUTPUT_RULES}`,

  QUESTION: `You are a structured question-decomposition engine operating within the Ceekul DQRG Intelligence Layer.
This chat exists ONLY for the content currently active in the learner's panel (identified by CID).

Mode: QUESTION — break down, do not answer in full.
- Decompose the learner's question into 2–3 sub-questions mapped to concepts in the content.
- For each sub-question, give a one-line pointer to where the content addresses it.
- Suggest 1 exploration path within the content — nothing external.
- Use numbered sub-questions for clarity.
${DQRG_OUTPUT_RULES}`,

  RESEARCH: `You are a collaborative knowledge-synthesis agent operating within the Ceekul DQRG Intelligence Layer.
This chat exists ONLY for the content currently active in the learner's panel (identified by CID).

Mode: RESEARCH — synthesise delta knowledge only.
- Combine the learner's input with the active content to produce only NEW insight (delta).
- Highlight connections the learner may have missed — cite the content concept, not external sources.
- Avoid raw answers; favour structured synthesis with clear reasoning chains (max 3 bullets).
- Encourage incremental discovery — do not hand everything at once.
${DQRG_OUTPUT_RULES}`,

  GRADE: `You are an evaluation engine operating within the Ceekul DQRG Intelligence Layer.
This chat exists ONLY for the content currently active in the learner's panel (identified by CID).

Mode: GRADE — evaluate against content rubric, return structured score only.
- Assess the learner's expressed understanding against the active content.
- Score: Strong / Developing / Needs Work — one word, no hedging.
- State exactly which content concept their reasoning addresses and which it misses.
- End with ONE specific improvement suggestion tied to the content.
${DQRG_OUTPUT_RULES}`
};

async function runDqrg({ userId, sessionId, cid, cidVersion, dqrgMode, userMessage, contentContext, interactionHistory = [] }) {
  const mode   = DQRG_SYSTEM[dqrgMode] ? dqrgMode : 'DISCUSS';
  const system = `${DQRG_SYSTEM[mode]}

Active Content:
CID: ${cid}${cidVersion ? ` v${cidVersion}` : ''}
Title: ${contentContext?.title || 'Untitled'}
Category: ${contentContext?.category || 'General'}
${contentContext?.summary ? `Summary: ${contentContext.summary}` : ''}

CRITICAL: Every response must be grounded in this content. If asked about something outside it, redirect the learner back to the content.`;

  // Keep last 6 messages (3 turns) to control token cost
  const historyMessages = interactionHistory.slice(-6).map(h => ({
    role:    h.role,
    content: h.content
  }));

  const t0   = Date.now();
  const task = await AgentTask.create({
    agentType: 'dqrg',
    userId,
    sessionId,
    prompt:  userMessage,
    context: { mode, cid, system: system.slice(0, 200) },
    status:  'running'
  });

  try {
    const msg = await client.messages.create({
      model:      HAIKU_MODEL,
      max_tokens: 320,
      system,
      messages:   [...historyMessages, { role: 'user', content: userMessage }]
    });

    const text      = msg.content[0].text.trim();
    const latencyMs = Date.now() - t0;
    const cost      = (msg.usage.input_tokens + msg.usage.output_tokens) * COST_PER_TOKEN;

    await AgentTask.findByIdAndUpdate(task._id, {
      response: text, tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens,
      latencyMs, costNeurons: cost, status: 'done'
    });

    return { reply: text, mode, cid };
  } catch (err) {
    await AgentTask.findByIdAndUpdate(task._id, { status: 'failed', error: err.message });
    throw err;
  }
}

module.exports = {
  runWorkshopGenerator,
  runCoTeacher,
  runContentOptimizer,
  runAdGenerator,
  runInnovationCoach,
  runTwinSummary,
  runResearchMapper,
  runLiveEditAssistant,
  runMultimediaEnricher,
  runQualityChecker,
  runChatModerator,
  runChatSummarizer,
  runInsightExtractor,
  // Adaptive Engine agents
  runMicroHookGenerator,
  runCinematicWriter,
  runHypothesisGenerator,
  runAtomQualityWriter,
  // Playback Overlay agents
  runOverlaySummarizer,
  runPersonalizedExplainer,
  // Content Validation Engine
  runContentValidator,
  // Share / Send gate
  runContentEvaluator,
  // DQRG Content-Bound Intelligence
  runDqrg,
  // Session lifecycle post-processor
  runSessionPostProcessor
};
