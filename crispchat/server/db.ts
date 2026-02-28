import mongoose from 'mongoose';

const MONGODB_URI = 'mongodb+srv://sushantsahoo378_db_user:4VHw9srT1fnypBUM@crispchatv2.4tjkw8c.mongodb.net/?appName=crispchatv2';

export const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
};
