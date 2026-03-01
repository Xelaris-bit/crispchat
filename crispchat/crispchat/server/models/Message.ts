import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, default: '' },
  media_url: { type: String },
  media_type: { type: String }, // 'image', 'pdf', etc.
  media_name: { type: String },
  status: { type: String, enum: ['sent', 'delivered', 'seen'], default: 'sent' },
  timestamp: { type: Date, default: Date.now },
  seen_at: { type: Date },
  reactions: [{
    emoji: { type: String, required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  }],
  reply_to: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' }
});

messageSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
  }
});

export const Message = mongoose.model('Message', messageSchema);
