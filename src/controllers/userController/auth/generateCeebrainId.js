const mongoose = require('mongoose');

const SEQ_KEY   = 'ceebrain_user';
const SEQ_START = 100_000_000_001;

const sequenceSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { collection: 'id_sequences' }
);
const Sequence = mongoose.models.IdSequence ?? mongoose.model('IdSequence', sequenceSchema);

// Returns the next CeeBrain ID that would be assigned on registration,
// without consuming a sequence slot.
const generateCeebrainId = async (req, res) => {
  try {
    const doc = await Sequence.findOne({ _id: SEQ_KEY });
    const currentSeq = doc?.seq ?? 0;
    const ceebrainId = (SEQ_START + currentSeq).toString();
    return res.status(200).json({ status: true, ceebrainId });
  } catch (err) {
    console.error('GenerateCeebrainId Error:', err);
    return res.status(500).json({ status: false, message: 'An error occurred' });
  }
};

module.exports = generateCeebrainId;
