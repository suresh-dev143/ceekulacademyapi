'use strict';

/**
 * ResearchItem — ingested research artefact from external sources.
 *
 * Pipeline: fetch → extract (Claude) → map to ContentAtoms → enrich atoms.
 * Supports arxiv, pubmed, semantic-scholar, and manual entry.
 */

const mongoose = require('mongoose');

const researchItemSchema = new mongoose.Schema({
  source:       { type: String, enum: ['arxiv', 'pubmed', 'semantic-scholar', 'crossref', 'manual'], default: 'arxiv' },
  externalId:   String,       // arXiv id, PubMed PMID, DOI, etc.
  title:        { type: String, required: true },
  abstract:     String,
  authors:      { type: [String], default: [] },
  publishedDate: Date,
  doi:          String,
  url:          String,
  pdfUrl:       String,

  // AI-extracted content
  topicTags:            { type: [String], default: [] },
  aiSummary:            String,
  extractedQuestions:   { type: [String], default: [] },
  extractedHypotheses:  { type: [String], default: [] },
  futureDirections:     { type: [String], default: [] },
  relevanceScore:       { type: Number, min: 0, max: 100, default: 0 },

  // Atom mapping
  mappedAtoms:          { type: [String], default: [] },  // atomIds

  // Processing pipeline state
  processingStatus: {
    type:    String,
    enum:    ['pending', 'extracting', 'mapping', 'enriching', 'done', 'failed'],
    default: 'pending'
  },
  processingError:  String,
  processedAt:      Date,
  enrichedAtoms:    { type: Number, default: 0 }  // count of atoms updated
}, { timestamps: true });

researchItemSchema.index({ externalId: 1, source: 1 }, { unique: true, sparse: true });
researchItemSchema.index({ topicTags: 1 });
researchItemSchema.index({ processingStatus: 1, createdAt: -1 });
researchItemSchema.index({ mappedAtoms: 1 });

module.exports = mongoose.model('ResearchItem', researchItemSchema);
