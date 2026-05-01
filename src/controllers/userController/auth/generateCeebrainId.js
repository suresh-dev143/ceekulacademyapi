const mongoose = require('mongoose');

const SEQ_KEY   = 'ceebrain_user';
const SEQ_START = 100_000_000_001;

const sequenceSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { collection: 'id_sequences' }
);
const Sequence = mongoose.models.IdSequence ?? mongoose.model('IdSequence', sequenceSchema);

const generateCeebrainId = async (req, res) => {
  try {
    const doc = await Sequence.findOneAndUpdate(
      { _id: SEQ_KEY },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const ceebrainId = (SEQ_START - 1 + doc.seq).toString();
    return res.status(200).json({ status: true, ceebrainId });
  } catch (err) {
    console.error('GenerateCeebrainId Error:', err);
    return res.status(500).json({ status: false, message: 'An error occurred' });
  }
};

module.exports = generateCeebrainId;
