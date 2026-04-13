'use strict';

const svc = require('../services/innovationService');

// POST /api/innovations
async function createIdea(req, res) {
  const { title, description, tags, isPublic } = req.body;
  if (!title || !description) {
    return res.status(400).json({ status: false, message: 'title and description required' });
  }
  const idea = await svc.submitIdea(req.user._id, { title, description, tags, isPublic });
  res.status(201).json({ status: true, data: idea });
}

// GET /api/innovations/mine
async function getMyIdeas(req, res) {
  const ideas = await svc.getMyIdeas(req.user._id);
  res.json({ status: true, data: ideas });
}

// GET /api/innovations/public
async function getPublicIdeas(req, res) {
  const { stage, tag, sort, page, limit } = req.query;
  const result = await svc.getPublicIdeas({
    stage,
    tag,
    sort,
    page:  parseInt(page,  10) || 1,
    limit: parseInt(limit, 10) || 20
  });
  res.json({ status: true, data: result });
}

// POST /api/innovations/:id/coach
async function getCoaching(req, res) {
  const coaching = await svc.getCoaching(req.params.id, req.user._id);
  res.json({ status: true, data: coaching });
}

// POST /api/innovations/:id/advance
async function advanceStage(req, res) {
  const result = await svc.advanceStage(req.params.id, req.user._id);
  res.json({ status: true, data: result });
}

// POST /api/innovations/:id/artifacts
async function addArtifact(req, res) {
  const { type, url, title, notes } = req.body;
  if (!type || !url) {
    return res.status(400).json({ status: false, message: 'type and url required' });
  }
  await svc.addArtifact(req.params.id, req.user._id, { type, url, title, notes });
  res.json({ status: true });
}

// POST /api/innovations/:id/team
async function addTeamMember(req, res) {
  const { memberId } = req.body;
  if (!memberId) return res.status(400).json({ status: false, message: 'memberId required' });
  await svc.addTeamMember(req.params.id, req.user._id, memberId);
  res.json({ status: true });
}

// POST /api/innovations/:id/upvote
async function upvoteIdea(req, res) {
  const result = await svc.upvoteIdea(req.params.id);
  res.json({ status: true, data: result });
}

module.exports = { createIdea, getMyIdeas, getPublicIdeas, getCoaching, advanceStage, addArtifact, addTeamMember, upvoteIdea };
