'use strict';

const Innovation = require('../models/innovationModel');
const DigitalTwin = require('../models/digitalTwinModel');
const { runInnovationCoach } = require('./claudeService');

const STAGES = ['idea', 'validation', 'research', 'simulation', 'prototype', 'deployed'];

// ── Submit a new idea ─────────────────────────────────────────────────────────

async function submitIdea(userId, { title, description, tags = [], isPublic = false }) {
  const innovation = await Innovation.create({
    title,
    description,
    submittedBy: userId,
    tags,
    isPublic,
    stage: 'idea',
    stageHistory: [{
      stage:     'idea',
      enteredAt: new Date()
    }]
  });

  // Increment twin idea counter
  await DigitalTwin.findOneAndUpdate(
    { userId },
    { $inc: { ideasSubmitted: 1 } },
    { upsert: true }
  );

  return innovation;
}

// ── Get coaching for current stage ───────────────────────────────────────────

async function getCoaching(innovationId, userId) {
  const idea = await Innovation.findById(innovationId).lean();
  if (!idea) throw new Error('Innovation not found');
  if (idea.submittedBy.toString() !== userId.toString()) throw new Error('Forbidden');

  const coaching = await runInnovationCoach({
    userId,
    idea,
    currentStage: idea.stage,
    stageHistory: idea.stageHistory
  });

  // Persist agent output in the current stage entry
  await Innovation.findOneAndUpdate(
    { _id: innovationId, 'stageHistory.stage': idea.stage },
    { $set: { 'stageHistory.$.agentOutput': JSON.stringify(coaching) } }
  );

  // If this is the validation stage, also update validation scores
  if (idea.stage === 'validation' && coaching.feasibility != null) {
    await Innovation.findByIdAndUpdate(innovationId, {
      $set: {
        'validation.feasibility':  coaching.feasibility,
        'validation.novelty':      coaching.novelty,
        'validation.impact':       coaching.impact,
        'validation.validatedAt':  new Date()
      }
    });
  }

  return coaching;
}

// ── Advance to next stage ─────────────────────────────────────────────────────

async function advanceStage(innovationId, userId) {
  const idea = await Innovation.findById(innovationId).lean();
  if (!idea) throw new Error('Innovation not found');
  if (idea.submittedBy.toString() !== userId.toString()) throw new Error('Forbidden');

  const currentIndex = STAGES.indexOf(idea.stage);
  if (currentIndex === -1 || currentIndex === STAGES.length - 1) {
    throw new Error('Already at final stage');
  }

  const nextStage = STAGES[currentIndex + 1];
  const now = new Date();

  // Close current stage
  await Innovation.findOneAndUpdate(
    { _id: innovationId, 'stageHistory.stage': idea.stage },
    { $set: { 'stageHistory.$.exitedAt': now } }
  );

  // Open next stage
  await Innovation.findByIdAndUpdate(innovationId, {
    $set:  { stage: nextStage },
    $push: { stageHistory: { stage: nextStage, enteredAt: now } }
  });

  // If advancing to deployed, bump twin prototype counter
  if (nextStage === 'deployed') {
    await DigitalTwin.findOneAndUpdate(
      { userId },
      { $inc: { prototypesBuilt: 1 } },
      { upsert: true }
    );
  }

  return { stage: nextStage };
}

// ── Add artifact ──────────────────────────────────────────────────────────────

async function addArtifact(innovationId, userId, { type, url, title, notes }) {
  const idea = await Innovation.findById(innovationId).lean();
  if (!idea) throw new Error('Innovation not found');

  const isOwner  = idea.submittedBy.toString() === userId.toString();
  const isMember = (idea.teamMembers || []).some(m => m.toString() === userId.toString());
  if (!isOwner && !isMember) throw new Error('Forbidden');

  await Innovation.findByIdAndUpdate(innovationId, {
    $push: { artifacts: { type, url, title, notes, addedAt: new Date() } }
  });

  return { ok: true };
}

// ── Add team member ───────────────────────────────────────────────────────────

async function addTeamMember(innovationId, userId, memberId) {
  const idea = await Innovation.findById(innovationId).lean();
  if (!idea) throw new Error('Innovation not found');
  if (idea.submittedBy.toString() !== userId.toString()) throw new Error('Forbidden');

  await Innovation.findByIdAndUpdate(innovationId, {
    $addToSet: { teamMembers: memberId }
  });

  return { ok: true };
}

// ── Browse public ideas ───────────────────────────────────────────────────────

async function getPublicIdeas({ stage, tag, sort = 'recent', page = 1, limit = 20 }) {
  const filter = { isPublic: true };
  if (stage) filter.stage = stage;
  if (tag)   filter.tags  = tag;

  const sortMap = {
    recent:  { createdAt: -1 },
    popular: { upvotes: -1 },
    stage:   { stage: 1, createdAt: -1 }
  };

  const skip = (page - 1) * limit;

  const [ideas, total] = await Promise.all([
    Innovation.find(filter)
      .sort(sortMap[sort] ?? sortMap.recent)
      .skip(skip)
      .limit(limit)
      .populate('submittedBy', 'name avatar')
      .lean(),
    Innovation.countDocuments(filter)
  ]);

  return { ideas, total, page, pages: Math.ceil(total / limit) };
}

// ── Get my ideas ──────────────────────────────────────────────────────────────

async function getMyIdeas(userId) {
  return Innovation.find({ submittedBy: userId })
    .sort({ createdAt: -1 })
    .lean();
}

// ── Upvote ────────────────────────────────────────────────────────────────────

async function upvoteIdea(innovationId) {
  const idea = await Innovation.findByIdAndUpdate(
    innovationId,
    { $inc: { upvotes: 1 } },
    { new: true }
  ).lean();
  if (!idea) throw new Error('Innovation not found');
  return { upvotes: idea.upvotes };
}

module.exports = {
  submitIdea,
  getCoaching,
  advanceStage,
  addArtifact,
  addTeamMember,
  getPublicIdeas,
  getMyIdeas,
  upvoteIdea
};
