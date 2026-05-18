'use strict';

const claudeSvc = require('../services/claudeService');

exports.assist = async (req, res) => {
  try {
    const { message, context, panelContents } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });

    const result = await claudeSvc.workspace_assistant({
      message,
      context:      context || 'home',
      panelContents: panelContents || [],
      userId:       req.user._id,
    });

    res.json({ reply: result, ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
