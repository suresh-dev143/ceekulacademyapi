'use strict';

/**
 * Architecture Knowledge Base Seeder
 *
 * Run ONCE to commit all static Ceekul Mission architecture specs into UCRS.
 * Each spec gets a deterministic CID. Future architecture.query payloads
 * reference these CIDs via specRefs[] instead of embedding the full text —
 * the dedup gate returns O(1) on any repeat, with zero AI cost.
 *
 * Usage:
 *   node src/scripts/seedArchitectureKb.js
 *
 * Output: prints a JSON map of specId → CID for use in architectureQueryService.js
 */

require('dotenv').config();
const { connectToDatabase } = require('../../connection');
const { commit } = require('../services/universalCommitService');

const SYSTEM_OWNER_ID = process.env.SYSTEM_OWNER_ID || 'system';

// ── Static Knowledge Base ─────────────────────────────────────────────────────
// Each entry becomes one architecture.spec commit with trusted:true.
// The body is the exact reusable context block — not a prompt, just the spec.

const SPECS = [

  {
    specId:   'ceekul-mission-dna',
    title:    'Ceekul Mission — Core Identity and Design Philosophy',
    version:  '1.0.0',
    domain:   'governance',
    keywords: ['ceekul', 'mission', 'philosophy', 'civilization', 'grassroots'],
    body: `
Ceekul Mission is a Section 8 platform evolving into a decentralized civilizational
operating system. It is NOT an NGO website, grievance portal, social media platform,
or government scheme tracker.

It IS:
- A distributed civilizational OS seeded at village level
- A human-coordination infrastructure that scales from one family to one billion people
  using the same underlying logic
- A system where every small act of a volunteer in a remote village feeds into a
  global transformation intelligence layer
- An architecture where ancient wisdom and AI governance coexist

Design principles:
- Humane, decentralized, intelligent, non-bureaucratic, highly scalable
- Decentralized participation, centralized accountability
- AI-assisted intelligence, democratic representation
- Scalable interoperability, future federation between local portals
- Grassroots-first, AI-native, evolutionary, distributed, civilizational scale

Platform must support: upliftment of the lowest strata, women empowerment,
circular local economies, reinventing ancient knowledge systems, AI-enabled
welfare systems, futuristic Ceekul infrastructure, and decentralized
village-to-global coordination.
    `.trim(),
  },

  {
    specId:   'organizational-genome',
    title:    'Ceekul Mission — Organizational Layer Genome',
    version:  '1.0.0',
    domain:   'governance',
    keywords: ['organization', 'layers', 'founders', 'advisors', 'directors', 'managers', 'volunteers'],
    body: `
THE ORGANIZATIONAL GENOME:
Layer 0 → Goals & Objectives (civilizational DNA)
Layer 1 → Founders & Advisors (strategic intelligence layer)
Layer 2 → Leaders & Coordinators (district transformation layer)
Layer 3 → Mission Executives → Directors (one per district, elected)
Layer 4 → Advisors (multiple per district, elected, future-possibility designers)
Layer 5 → Managers (one per village/ward, elected, accountability node)
Layer 6 → Volunteers (self-selected, grassroots action agents, NO governance authority)
Layer 7 → Citizens / Villagers (primary beneficiaries and participators)
    `.trim(),
  },

  {
    specId:   'role-definitions',
    title:    'Ceekul Mission — Complete Role Definitions',
    version:  '1.0.0',
    domain:   'governance',
    keywords: ['roles', 'advisor', 'director', 'manager', 'volunteer', 'citizen', 'permissions'],
    body: `
ADVISORS:
- Multiple elected Advisors per district
- Future possibility designers, ancient knowledge reinvention architects
- Circular economy strategists, futuristic infrastructure thinkers
- Women empowerment innovators, AI-assisted welfare designers
- Intellectual authority, not operational authority

DIRECTOR:
- Exactly ONE elected Director per district
- District mission integrator, human development facilitator
- Cross-village coordinator, institutional connector
- Public communication leader
- Operational authority at district scope

MANAGER:
- Exactly ONE officially elected Manager per village/ward
- Official village accountability node
- Welfare coordinator, local-to-global support connector
- Village issue escalation authority
- Village-scope authority only

VOLUNTEERS:
- NOT elected — self-selected by any registered Ceebrain member
- NO official governance authority
- NO district or global managerial access
- Grassroots support agents, community communicators, local issue solvers
- Volunteer activities appear under the corresponding Manager Page
- Build D Score through verified activities

CITIZENS / VILLAGERS:
- Primary beneficiaries and participators
- Post grievances, vote on solutions, discuss issues on CG Pages
- No governance authority
    `.trim(),
  },

  {
    specId:   'cg-page-architecture',
    title:    'Ceekul Mission — CG Page and CG ID System',
    version:  '1.0.0',
    domain:   'governance',
    keywords: ['cg-page', 'cg-id', 'village', 'district', 'governance-page'],
    body: `
CG PAGE TYPES:

TYPE 1 — VILLAGE/WARD CG PAGE
- Atomic unit: every village or ward has exactly one
- Primary roles: Manager (1, elected) + Volunteers (many, self-selected)
- Primary users: Citizens/Villagers
- Functions: grievance posting, solution discussion, activity logging,
  welfare coordination, local economy, knowledge sharing
- CG prefix in UCRS: CG (governance entity type)

TYPE 2 — DISTRICT CG PAGE
- Aggregation unit: every district has exactly one
- Primary roles: Director (1, elected) + Advisors (many, elected)
- Primary users: District leaders, institutional actors, global partners
- Functions: cross-village intelligence, strategic coordination,
  innovation ecosystem, institutional connections, future design

CG ID ARCHITECTURE:
- 12-digit identifier: CG + 6-digit portal prefix + 6-digit local ID
- Example: CG100000100001
- Each Ceekul local portal receives exactly 100,000 CG IDs in a block
- Example block: CG100000100001 → CG100000200000
- Must support: distributed allocation, decentralized registration,
  independent portal operation, future synchronization, massive scalability

UCRS ENTITY MAPPING:
- CG prefix in UCRS constants = 'governance' entity type
- Every CG Page is a UCRS governance entity
- Lifecycle follows UCRS_LIFECYCLE_STATES: PENDING → ACTIVE → ARCHIVED
    `.trim(),
  },

  {
    specId:   'd-score-framework',
    title:    'Ceekul Mission — Dignity Score (D Score) Framework',
    version:  '1.0.0',
    domain:   'governance',
    keywords: ['d-score', 'dignity', 'transformation', 'scoring', 'reputation'],
    body: `
D SCORE (DIGNITY SCORE):
Universal reputation currency of the Ceekul Mission platform.
Computed from 5 weighted transformation dimensions.

Uses:
- Win elections within Ceekul
- Seek positions inside the Ceekul ecosystem
- Influence people and partner networks
- Credentials for political positions
- Access higher-trust platform features
- Compulsory computation at semester end; on-demand computation also available
- Appears in My Activities inside CB ID of personal page

THE 5 DIMENSIONS:
1. Individual Transformation (weight ~15%)
   Personal growth, skills, health, learning, self-improvement
2. Family Transformation (weight ~15%)
   Family welfare, education, livelihoods
3. Social Transformation (weight ~35%)
   Community volunteering, grievance resolution, collective welfare
4. System Transformation (weight ~20%)
   Government interface, policy advocacy, institutional reform
5. External Transformation (weight ~15%)
   Global connections, partnerships, knowledge import/export

Formula: D = Σ(dimension_score × dimension_weight)
All activities auto-logged and mentioned in CB ID personal page My Activities section.
    `.trim(),
  },

  {
    specId:   'ucrs-entity-mapping',
    title:    'Ceekul Mission — UCRS Entity Prefix Mapping',
    version:  '1.0.0',
    domain:   'governance',
    keywords: ['ucrs', 'entity', 'prefix', 'cb', 'cg', 'cr', 'mapping'],
    body: `
UCRS ENTITY PREFIX REGISTRY (from ucrsConstants.js):
CB → citizen       (Ceebrain member / registered human)
CC → community     (Community group or collective)
CG → governance    (Governance body — maps to CG Pages)
CA → agent         (AI Agent)
CR → resource      (Content, material, asset)
CP → process       (Pipeline, workflow instance)
CD → device        (Physical or virtual device)
CS → service       (Service or system module)
CW → workflow      (Automated workflow)

UCRS ACTIONS VOCABULARY (closed list):
read, write, allocate, deallocate, delegate, invoke, observe, audit, admin

UCRS RELATION → ACTION MAP:
owner    → all actions (full control + delegation)
admin    → all actions except delegate
editor   → read, write, invoke, observe
member   → read, observe, allocate
viewer   → read, observe
auditor  → read, audit

UCRS LIFECYCLE STATES:
PENDING → ACTIVE → SUSPENDED / REVOKED → ARCHIVED (terminal)

UCRS LIFE SERVICE DOMAINS:
education, digital, create, health, housing, nutrition,
justice, security, governance, community, economy, environment
    `.trim(),
  },

];

// ── Seed Runner ───────────────────────────────────────────────────────────────

async function seed() {
  await connectToDatabase();
  console.log('');

  const results = {};

  for (const spec of SPECS) {
    try {
      const result = await commit({
        source:      'system.architecture-kb',
        contentType: 'architecture.spec',
        payload:     spec,
        ownerId:     SYSTEM_OWNER_ID,
        trusted:     true,            // skips Haiku evaluation — internal system content
      });

      results[spec.specId] = result.cid;

      const status = result.fromDedupe ? '(already existed — dedup hit)' : '(new)';
      console.log(`✓ ${spec.specId}`);
      console.log(`  CID: ${result.cid} ${status}\n`);

    } catch (err) {
      console.error(`✗ ${spec.specId}: ${err.message}`);
    }
  }

  console.log('\n── CID Map (paste into architectureQueryService.js) ──────────────\n');
  console.log(JSON.stringify(results, null, 2));

  const mongoose = require('mongoose');
  await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
