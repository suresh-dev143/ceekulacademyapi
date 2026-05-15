'use strict';

/**
 * Architecture Prompt Runner
 *
 * Runs all 10 Ceekul Mission architecture prompts through the
 * architectureQueryService cost stack:
 *
 *   Run 1 (cold):  Opus 4.6 called per prompt, responses cached in UCRS
 *   Run 2+ (warm): All 10 prompts return O(1) from UCRS dedup gate, zero AI cost
 *
 * Each prompt uses only the specRefs it actually needs — no prompt embeds
 * the full knowledge base inline. Anthropic's prompt cache covers the static
 * KB; only the unique query text is billed at full rate.
 *
 * Usage:
 *   node src/scripts/runArchitecturePrompts.js
 *   node src/scripts/runArchitecturePrompts.js --prompt 3   (run single prompt)
 *   node src/scripts/runArchitecturePrompts.js --dry-run    (show cost estimate only)
 *
 * Run seedArchitectureKb.js first if the KB specs are not yet committed.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { connectToDatabase } = require('../../connection');
const { query } = require('../services/architectureQueryService');

const OWNER_ID = process.env.SYSTEM_OWNER_ID || 'system';

// ── The 10 Prompts — restructured for UCRS compatibility ─────────────────────
// Each prompt:
//   - queryText: ONLY the unique question (not repeated context)
//   - specRefs: ONLY the KB specs this prompt actually needs
//   - parentCid: set at runtime from the previous prompt's queryCid

const PROMPTS = [

  {
    promptId: 'prompt-00-master',
    title:    'Master Architecture Overview',
    specRefs: ['ceekul-mission-dna', 'organizational-genome', 'role-definitions',
               'cg-page-architecture', 'd-score-framework', 'ucrs-entity-mapping'],
    queryText: `Design the COMPLETE architecture of Ceekul Mission across these 26 dimensions.
For each dimension provide: core concept, architecture diagram (structured text), implementation logic, future evolution path, and critical design decisions.

Dimensions:
1. Functional architecture and system boundaries
2. Database entity model and relationships
3. Permission hierarchy and access control matrix
4. Role-based workflow state machines
5. AI integration layer
6. District ↔ Village real-time synchronization protocol
7. Volunteer activity propagation system
8. Manager accountability architecture
9. Advisor innovation ecosystem
10. Human development coordination model (D Score engine)
11. UI/UX architecture
12. CG Page structure (village and district variants)
13. Notification and event propagation system
14. Real-time collaboration models
15. Public participation mechanisms
16. Local-to-global support workflows
17. Judiciary and administration interaction flows
18. Circular economy collaboration architecture
19. Ancient knowledge reinvention layer
20. CG ID distributed allocation and federation model
21. Scalability architecture (village → district → state → national → global)
22. Security and governance architecture
23. Federation protocol between independent Ceekul portals
24. Offline-to-online synchronization
25. AI-assisted district intelligence systems
26. Expansion roadmap into state/national/global Ceekul grids`,
  },

  {
    promptId: 'prompt-01-governance',
    title:    'Governance and Permission Architecture',
    specRefs: ['organizational-genome', 'role-definitions', 'ucrs-entity-mapping'],
    queryText: `Design the complete governance and permission architecture for Ceekul Mission.

Deliver all of the following in full detail:
A. PERMISSION MATRIX — what each role (Advisor, Director, Manager, Volunteer, Citizen) can READ/WRITE/APPROVE/ESCALATE/OVERRIDE across Personal, Village CG Page, District CG Page, National Layer, AI Systems scope. Include explicit DENY rules.
B. ELECTION ARCHITECTURE — Director election logic, Advisor election logic, Manager village-level democratic process, recall mechanism, D Score threshold for election eligibility.
C. TERM & TENURE SYSTEM — term lengths, cooling-off periods, re-election limits, interim provisions.
D. ACCOUNTABILITY CHAINS — who holds each role accountable, failure consequences at each level.
E. GOVERNANCE FAILURE PROTOCOLS — Manager absence, Director misconduct, CG Page inactivity, emergency governance.
F. ANTI-CAPTURE MECHANISMS — how the system prevents elite capture of Advisor positions and Manager roles.

Map every permission concept directly to UCRS relations (owner/admin/editor/member/viewer/auditor) and UCRS actions (read/write/allocate/delegate/invoke/observe/audit/admin).`,
  },

  {
    promptId: 'prompt-02-cg-system',
    title:    'CG Page and CG ID System Architecture',
    specRefs: ['cg-page-architecture', 'organizational-genome', 'ucrs-entity-mapping'],
    queryText: `Design the complete CG Page and CG ID system for Ceekul Mission.

Deliver in full detail:
1. CG ID ALLOCATION PROTOCOL — block assignment, who assigns, new portal request process, block exhaustion, reservation for special IDs (district, state, national).
2. CG PAGE DATA ARCHITECTURE — complete entity schema for Village CG Page, complete entity schema for District CG Page, shared vs. type-specific fields, versioning, relationship model.
3. VILLAGE CG PAGE FUNCTIONAL SPEC — all sections with data models, grievance lifecycle, activity log, community discussion, public vs. member content, voting and solution validation, campaign integration, local economy board, knowledge library.
4. DISTRICT CG PAGE FUNCTIONAL SPEC — intelligence aggregation from village CG Pages, Advisor innovation board, Director coordination tools, cross-village initiative architecture, institutional connection directory, AI intelligence panel.
5. CG PAGE LIFECYCLE — creation, dormancy, merge/split, archive/sunset.
6. FEDERATION BETWEEN PORTALS — inter-portal synchronization protocol, shared vs. local data, conflict resolution, the inter-portal protocol design.
7. OFFLINE-FIRST CG PAGE — offline operation model, sync protocol, conflict resolution, SMS/USSD fallback.

Every entity must map to a UCRS entity type (CG = governance, CR = resource, CB = citizen, etc.).`,
  },

  {
    promptId: 'prompt-03-ai-layer',
    title:    'AI Integration Layer',
    specRefs: ['ceekul-mission-dna', 'role-definitions', 'd-score-framework', 'ucrs-entity-mapping'],
    queryText: `Design the complete AI integration layer for Ceekul Mission across all governance levels.

For each AI system below, define: inputs, outputs, feedback loops, minimum data to activate, improvement trajectory as network grows, failure mode and fallback, human oversight mechanism.

Systems to design:
1. VILLAGE-LEVEL AI ASSISTANT — grievance categorization, solution suggestion engine, escalation recommendation, volunteer-to-grievance matching, activity impact estimation, sentiment analysis, early warning system, voice/vernacular interface.
2. MANAGER AI COMPANION — workload prioritization, escalation letter drafting, villager sentiment aggregation, volunteer performance summary, deadline tracker, outcome prediction, village benchmark comparison.
3. DIRECTOR AI INTELLIGENCE SYSTEM — district pattern recognition, resource allocation optimization, cross-village initiative design, Advisor idea synthesis, institutional connection recommender, district health score, predictive welfare modeling.
4. ADVISOR AI RESEARCH PARTNER — ancient knowledge retrieval and modern mapping, circular economy opportunity detector, women empowerment program designer, future scenario modeler, global best-practice importer, innovation diffusion tracker.
5. D SCORE AI ENGINE — activity verification, fraud detection, cross-dimension impact weighting, comparative benchmarking, semester-end computation with audit trail, narrative generation.
6. NETWORK INTELLIGENCE LAYER — cross-portal pattern detection, national welfare signal aggregation, crisis propagation prediction, success story amplification.
7. AI ETHICS AND GOVERNANCE — bias detection, transparency logs, human override mechanisms, differential privacy, model governance.

Specify which Claude model (Haiku/Sonnet/Opus) is appropriate for each sub-function and why.`,
  },

  {
    promptId: 'prompt-04-database',
    title:    'Database and Entity Architecture',
    specRefs: ['cg-page-architecture', 'organizational-genome', 'role-definitions',
               'd-score-framework', 'ucrs-entity-mapping'],
    queryText: `Design the complete database and entity architecture for Ceekul Mission.

Deliver structured schema definitions for every entity listed below. For each entity: all fields (name, type, constraints, indexes), relationships, soft/hard delete strategy, versioning strategy, partitioning strategy.

Core entities:
CgPage, CgId, CeebrainUser, Role, RoleAssignment, Grievance, GrievanceSolution, GrievanceComment, GrievanceAction, Activity, ActivityImpact, DScore, DScoreDimension, Campaign, CampaignContribution, KnowledgeEntry, CircularEconomyListing, InstitutionalContact, Election, ElectionCandidate, Vote, Notification, AuditLog, Portal, PortalCgIdBlock, FederationSync.

Also deliver:
- PERMISSION DATA MODEL — RBAC vs ABAC vs hybrid decision, scope-binding implementation, time-bound permission enforcement, permission change audit.
- EVENT SOURCING ARCHITECTURE — event schema and projection model OR audit log and CDC strategy.
- SEARCH ARCHITECTURE — grievance search, knowledge search, full-text vs. vector, geo-spatial indexing.
- TIME-SERIES DATA — activity streams, D Score evolution, village health metrics — efficient billion-record storage.
- MULTI-TENANCY MODEL — per-portal isolation strategy, cross-portal federation query architecture.
- DATA SOVEREIGNTY — what data belongs to the village, aggregation consent model.`,
  },

  {
    promptId: 'prompt-05-dscore',
    title:    'D Score — Dignity Score System Architecture',
    specRefs: ['d-score-framework', 'role-definitions', 'ucrs-entity-mapping'],
    queryText: `Design the complete Dignity Score (D Score) system for Ceekul Mission.

Deliver in full detail:
1. SCORING PHILOSOPHY — absolute vs. relative, time decay, role-differentiated logic, negative act handling, fraud resistance.
2. ACTIVITY → POINTS MAPPING — complete activity taxonomy per dimension, point assignment logic, impact verification chain, maximum points per activity, cascading impact measurement.
3. WEIGHT ARCHITECTURE — dimension weights per role, static vs. context-adaptive, geography-differentiated weights.
4. COMPUTATION ENGINE — real-time vs. semester-end vs. on-demand, exact formula, audit trail, dispute resolution.
5. VERIFICATION SYSTEM — multi-layer verification protocol, who can verify, community testimony capture.
6. D SCORE AS GOVERNANCE CREDENTIAL — thresholds for each election, interaction with term limits, external credential use.
7. D SCORE TRANSPARENCY — visibility rules, public vs. private breakdown, narrative generation, CB ID display.
8. ANTI-GAMING ARCHITECTURE — sybil resistance, collusion detection, activity saturation limits, AI anomaly detection, community flagging.
9. EVOLUTION OF D SCORE — how weights change over time, governance of score changes, historical score preservation.

Design D Score as if it will become the global standard for measuring human transformation impact.`,
  },

  {
    promptId: 'prompt-06-activity-propagation',
    title:    'Volunteer Activity Propagation System',
    specRefs: ['role-definitions', 'cg-page-architecture', 'd-score-framework', 'ucrs-entity-mapping'],
    queryText: `Design the complete Volunteer Activity Propagation System for Ceekul Mission.

Every volunteer action must: appear on their CB ID activity log, appear on the village CG Page, be visible under Manager's feed, feed the D Score engine, and potentially aggregate into district intelligence. Volunteers CANNOT access district governance or gain authority beyond their joined villages.

Deliver in full detail:
1. ACTIVITY EVENT SCHEMA — complete data model, timestamping, geo-tagging, CG Page/Grievance/Campaign linkage, D Score dimension linkage.
2. PROPAGATION PIPELINE — capture → validation → enrichment → storage → publication → notification → aggregation (step-by-step, with data flow).
3. MANAGER VISIBILITY ARCHITECTURE — Manager view of all village activity, verification/endorsement effect on D Score, absent Manager handling.
4. CG PAGE ACTIVITY LOG — real-time vs. batch, visibility rules, activity clustering, privacy options.
5. CROSS-VILLAGE ACTIVITY SIGNALS — multi-village volunteer activity routing, primary village determination, conflict resolution.
6. AI ENRICHMENT — auto-classification, impact estimation, fraud detection, exceptional activity amplification.
7. ACTIVITY AGGREGATION INTO DISTRICT INTELLIGENCE — threshold logic for district-level signals, attribution preservation.
8. HISTORICAL ACTIVITY ARCHITECTURE — 10-year storage, searchability, AI training use, preservation on user exit.
9. REAL-TIME COLLABORATION EVENTS — joint activity credit splitting, simultaneous contribution attribution.`,
  },

  {
    promptId: 'prompt-07-ux-architecture',
    title:    'UI/UX Architecture and Page Design System',
    specRefs: ['role-definitions', 'cg-page-architecture', 'd-score-framework', 'organizational-genome'],
    queryText: `Design the complete UI/UX architecture for Ceekul Mission.

Constraints: must work on ₹5000 Android phone on 2G, in 12+ Indian languages, for visual impairments, with voice navigation for semi-literate users. Must also work on desktop for institutional actors.

Deliver in full detail:
1. INFORMATION ARCHITECTURE — complete sitemap per role (Volunteer, Manager, Director, Advisor, Citizen, Global Visitor), navigation grammar, role journey convergence/divergence points.
2. PAGE DESIGN SPECIFICATIONS — complete spec for: Village CG Page (public+member), District CG Page, Volunteer Dashboard, Manager Dashboard, Director Dashboard, Advisor Workspace, CB ID Personal Page, Grievance Thread, Campaign Page, Knowledge Library, Election Interface, D Score Display Page. For each: above-the-fold intent, primary action zones, information hierarchy, role-sensitive content rules, mobile-first adaptation, real-time zones.
3. NAVIGATION SYSTEM — global navigation, role-based switching, CG ID search, deep link architecture.
4. NOTIFICATION ARCHITECTURE — taxonomy, routing by role and scope, push vs. pull, SMS fallback, preference management.
5. REAL-TIME COLLABORATION UI — presence indicators, conflict handling, election real-time results, response indicators.
6. PROGRESSIVE DISCLOSURE — complexity revelation, onboarding flow, contextual AI guidance.
7. DASHBOARD DESIGN — most important number per role, village/district health visualization, emergency surfacing.
8. DESIGN SYSTEM — color language, typography for multilingual context, iconography for low-literacy, animation philosophy, dark/light mode for battery saving.`,
  },

  {
    promptId: 'prompt-08-economy-knowledge',
    title:    'Circular Economy and Ancient Knowledge Architecture',
    specRefs: ['ceekul-mission-dna', 'role-definitions', 'cg-page-architecture'],
    queryText: `Design the Circular Economy Collaboration System and Ancient Knowledge Reinvention Architecture for Ceekul Mission.

PART A — CIRCULAR ECONOMY:
1. LOCAL ECONOMY GRAPH — how the village economy is mapped (entities: producers, consumers, resources, waste streams, value exchanges), graph update logic.
2. CIRCULAR OPPORTUNITY DETECTION — AI identification of circular opportunities, presentation to Manager/Volunteers, Advisor idea linkage.
3. INTER-VILLAGE CIRCULAR NETWORKS — how circular links form between villages, exchange protocol (barter/local token/currency).
4. WOMEN-LED CIRCULAR ENTERPRISES — system features specific to women's SHG circular economy projects.
5. CAMPAIGN-TO-ECONOMY PIPELINE — how fundraising campaigns connect to circular economy implementation, money tracking to outcome.

PART B — ANCIENT KNOWLEDGE REINVENTION:
1. KNOWLEDGE TAXONOMY — classification system, provenance tracking, regional/community attribution.
2. KNOWLEDGE ENTRY PROTOCOL — who can enter, validation process, oral knowledge capture (audio/video/text), intellectual property handling.
3. KNOWLEDGE-TO-APPLICATION PIPELINE — full pipeline from elder's oral tradition to verified village implementation and outcome tracking.
4. AI KNOWLEDGE CROSS-REFERENCING — how AI finds modern scientific validation for ancient practices, how it matches ancient solutions to current CG Page grievances.
5. ADVISOR ROLE — Advisor workspace for knowledge reinvention, pilot proposal mechanism, result tracking.
6. KNOWLEDGE FEDERATION — cross-portal sharing, knowledge sovereignty, growth into national traditional knowledge commons.`,
  },

  {
    promptId: 'prompt-09-federation-scale',
    title:    'Federation, Scalability, and Implementation Roadmap',
    specRefs: ['ceekul-mission-dna', 'cg-page-architecture', 'ucrs-entity-mapping', 'organizational-genome'],
    queryText: `Design the Federation, Scalability, and Implementation Roadmap for Ceekul Mission.

PART A — FEDERATION AND SCALABILITY:
1. FEDERATION PROTOCOL — inter-portal communication protocol, shared vs. local data, new portal registration, rogue portal isolation, existing federation standards evaluation (ActivityPub/Matrix/custom).
2. CG ID FEDERATION — decentralized block registry, root authority design, authority distribution over time, CG ID conflict resolution.
3. SCALABILITY STAGES — for Day 1 (1 portal, 10 villages), Year 1, Year 3, Year 5, Year 10 (600,000+ villages): infrastructure, governance changes, AI capabilities, new features, critical failure risks.
4. OFFLINE-TO-ONLINE — offline-first data model, sync protocol priority queue, conflict resolution, low-bandwidth mode, SMS/USSD fallback.
5. LOCAL PORTAL ARCHITECTURE — minimum setup (can it run on Raspberry Pi?), federation connection, local data sovereignty.
6. NATIONAL INTELLIGENCE LAYER — emergence from federated portals, data aggregation architecture, connection to government open data (UDISE, HMIS).
7. SECURITY ARCHITECTURE — decentralized identity verification, cross-portal SSO, encryption, anti-capture, DDoS resistance, audit immutability.

PART B — IMPLEMENTATION ROADMAP:
Define Phase 0 through Phase 5 with features shipped, DB migrations, AI capabilities, governance features, success metrics.
Recommend full technical stack with justification (framework, database, real-time, AI, search, SMS, offline sync, auth, hosting).
Give the top 10 technical and governance risks with probability, impact, mitigation, and early warning signal.
Address: monolith vs. microservices, event sourcing vs. CRUD, blockchain anchoring for D Score, AI model strategy (fine-tuned/RAG/prompt engineering), India-only data residency.`,
  },

];

// ── Runner ────────────────────────────────────────────────────────────────────

async function run() {
  const args      = process.argv.slice(2);
  const dryRun    = args.includes('--dry-run');
  const singleIdx = args.indexOf('--prompt');
  const onlyIdx   = singleIdx !== -1 ? parseInt(args[singleIdx + 1], 10) : null;

  if (dryRun) {
    console.log('── DRY RUN — Cost Estimate ──────────────────────────────────────\n');
    console.log('Static KB (committed once via seedArchitectureKb.js):');
    console.log('  ~1,800 tokens × $15/M = $0.027 (one-time only)\n');
    console.log('Per prompt (cold — first run):');
    console.log('  Cached KB:       ~1,800 tokens × $15/M × 10% = $0.0027  (cache hit rate)');
    console.log('  Unique query:    ~200 tokens × $15/M          = $0.003');
    console.log('  Output:          ~4,000 tokens × $75/M        = $0.30');
    console.log('  Total per prompt ≈ $0.306\n');
    console.log('10 prompts cold run ≈ $3.06');
    console.log('10 prompts warm run (UCRS dedup) ≈ $0.00 (O(1) from cache)\n');
    console.log('Savings vs. no-optimization (monolithic, no caching):');
    console.log('  Cold: ~$3.30 → $3.06 (7% cheaper via prompt caching)');
    console.log('  Warm: ~$3.30 → $0.00 (100% cheaper via UCRS dedup)\n');
    return;
  }

  await connectToDatabase();
  console.log('');

  const promptsToRun = onlyIdx !== null ? [PROMPTS[onlyIdx]] : PROMPTS;
  let   parentCid    = null;
  const results      = [];

  for (const [i, prompt] of promptsToRun.entries()) {
    console.log(`\n── Prompt ${onlyIdx ?? i}: ${prompt.title} ─────────────────────`);
    const t0 = Date.now();

    try {
      const result = await query({
        promptId:  prompt.promptId,
        title:     prompt.title,
        queryText: prompt.queryText,
        specRefs:  prompt.specRefs,
        parentCid,
        ownerId:   OWNER_ID,
        maxTokens: 8192,
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      if (result.fromCache) {
        console.log(`  ✓ UCRS cache hit — O(1), zero AI cost (${elapsed}s)`);
      } else {
        const { inputTokens, outputTokens, cacheCreatedTokens, cacheReadTokens } = result.usage;
        console.log(`  ✓ Opus response received (${elapsed}s)`);
        console.log(`  Tokens: ${inputTokens} in / ${outputTokens} out`);
        if (cacheCreatedTokens) console.log(`  Cache created: ${cacheCreatedTokens} tokens`);
        if (cacheReadTokens)    console.log(`  Cache read:    ${cacheReadTokens} tokens (billed at 10%)`);
      }

      console.log(`  queryCid:    ${result.queryCid}`);
      console.log(`  responseCid: ${result.responseCid}`);

      // Chain: next prompt's parentCid = this response's queryCid
      parentCid = result.queryCid;

      results.push({ promptId: prompt.promptId, ...result });

      // Print response preview
      const preview = result.response.slice(0, 300).replace(/\n/g, ' ');
      console.log(`\n  Preview: ${preview}...\n`);

    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      results.push({ promptId: prompt.promptId, error: err.message });
    }
  }

  console.log('\n── Summary ──────────────────────────────────────────────────────');
  const hits   = results.filter(r => r.fromCache).length;
  const misses = results.filter(r => !r.fromCache && !r.error).length;
  const errors = results.filter(r => r.error).length;
  console.log(`  Cache hits (O(1) free):  ${hits}`);
  console.log(`  Opus calls (billed):     ${misses}`);
  console.log(`  Errors:                  ${errors}`);
  console.log(`\n  All responses committed to UCRS — next run will be fully cached.\n`);

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
