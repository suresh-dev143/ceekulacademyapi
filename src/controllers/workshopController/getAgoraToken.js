const { RtcTokenBuilder, RtcRole, RtmTokenBuilder, RtmRole } = require('agora-access-token');
const Workshop = require('../../models/workshopModel');
const Enrollment = require('../../models/enrollmentModel');

/**
 * GET /api/v1/workshops/:workshopId/schedules/:scheduleId/agora-token
 *
 * Role resolution:
 *   - Workshop creator             → host
 *   - Enrolled as Expert/Instructor → host
 *   - Enrolled as Student:
 *       live_broadcast             → audience
 *       interactive_class          → host  (full-duplex, ≤30 users)
 *
 * Returns a short-lived Agora RTC token plus channel metadata.
 */
const getAgoraToken = async (req, res) => {
  try {
    const { workshopId, scheduleId } = req.params;
    const userId = req.user._id;

    // ── 1. Env config ─────────────────────────────────────────────────────────
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
      return res.status(500).json({
        status: false,
        message: 'Live streaming is not configured on this server.'
      });
    }

    // ── 2. Load workshop ──────────────────────────────────────────────────────
    const workshop = await Workshop.findById(workshopId);
    if (!workshop) {
      return res.status(404).json({ status: false, message: 'Workshop not found.' });
    }

    // ── 3. Locate the schedule subdocument ────────────────────────────────────
    const schedule = workshop.schedules.id(scheduleId);
    if (!schedule) {
      return res.status(404).json({ status: false, message: 'Schedule not found in this workshop.' });
    }

    if (schedule.mode !== 'online') {
      return res.status(400).json({
        status: false,
        message: 'Agora is only available for online sessions.'
      });
    }

    // ── 4. Resolve participant role ───────────────────────────────────────────
    const isCreator = workshop.createdBy.toString() === userId.toString();
    let participantRole;

    if (isCreator) {
      participantRole = 'host';
    } else {
      const enrollment = await Enrollment.findOne({
        workshopId,
        userId,
        status: 'active'
      });

      if (!enrollment) {
        return res.status(403).json({
          status: false,
          message: 'You must be enrolled in this workshop to join the live session.'
        });
      }

      if (enrollment.role === 'Expert' || enrollment.role === 'Instructor') {
        participantRole = 'host';
      } else {
        // Student: audience in broadcast, host (full-duplex) in interactive class
        const streamMode = schedule.streamMode || 'interactive_class';
        participantRole = streamMode === 'live_broadcast' ? 'audience' : 'host';
      }
    }

    // ── 5. Build Agora RTC token ──────────────────────────────────────────────
    const channelName = scheduleId; // One channel per schedule — globally unique via MongoDB ObjectId
    const uid = 0;                  // uid=0 lets Agora assign a unique numeric UID per join
    const TOKEN_TTL_SECONDS = 24 * 3600; // 24 hours
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;

    const agoraRole = participantRole === 'host' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      agoraRole,
      expiresAt
    );

    // ── 6. Build Agora RTM token (for live chat) ──────────────────────────────
    const rtmUid = String(userId);
    const rtmToken = RtmTokenBuilder.buildToken(
      appId,
      appCertificate,
      rtmUid,
      RtmRole.Rtm_User,
      expiresAt
    );

    return res.status(200).json({
      status: true,
      message: 'Token generated successfully.',
      data: {
        token,
        channelName,
        uid,
        appId,
        role: participantRole,
        mode: schedule.streamMode || 'interactive_class',
        rtmToken,
        rtmUid
      }
    });

  } catch (error) {
    console.error('[getAgoraToken]', error);
    return res.status(500).json({
      status: false,
      message: error.message || 'Failed to generate live session token.'
    });
  }
};

module.exports = getAgoraToken;
