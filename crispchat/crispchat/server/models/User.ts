import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  profile_image: { type: String, default: '' },
  bio: { type: String, default: 'Hey there! I am using this app.' },
  last_seen: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now }
});

userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    delete ret._id;
    delete ret.password;
  }
});

export const User = mongoose.model('User', userSchema);
