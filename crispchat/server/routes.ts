import { Express } from 'express';
import { Server } from 'socket.io';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken, requireAdmin, generateToken, AuthRequest } from './middleware.js';
import { activeUsers } from './sockets.js';
import { User } from './models/User.js';
import { Message } from './models/Message.js';

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './uploads';
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

export function setupRoutes(app: Express, io: Server) {
  // --- Auth Routes ---
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken({ id: user.id, role: user.role });
    
    // Update last seen
    user.last_seen = new Date();
    await user.save();

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  });

  app.get('/api/auth/me', authenticateToken, async (req: AuthRequest, res) => {
    const user = await User.findById(req.user?.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  });

  // --- Admin Routes ---
  app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    const users = await User.find().select('-password').sort({ created_at: -1 });
    res.json(users);
  });

  app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    const { username, email, password, role } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const password_hash = await bcrypt.hash(password, 10);
      
      const newUser = new User({
        username,
        email,
        password: password_hash,
        role: role || 'user'
      });

      await newUser.save();

      res.status(201).json({ message: 'User created successfully', id: newUser.id });
    } catch (error: any) {
      if (error.code === 11000) {
        return res.status(400).json({ error: 'Username or email already exists' });
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.patch('/api/admin/users/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    try {
      await User.findByIdAndUpdate(id, { status });
      res.json({ message: 'User status updated' });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
      await User.findByIdAndDelete(id);
      res.json({ message: 'User deleted' });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Chat Routes ---
  app.get('/api/users', authenticateToken, async (req: AuthRequest, res) => {
    // Get all active users except self
    const users = await User.find({ _id: { $ne: req.user?.id }, status: 'active' }).select('-password');
    const usersWithOnlineStatus = users.map(u => ({
      ...u.toJSON(),
      online: activeUsers.has(u.id)
    }));
    res.json(usersWithOnlineStatus);
  });

  app.get('/api/messages/:userId', authenticateToken, async (req: AuthRequest, res) => {
    const { userId } = req.params;
    const myId = req.user?.id;

    const messages = await Message.find({
      $or: [
        { sender_id: myId, receiver_id: userId },
        { sender_id: userId, receiver_id: myId }
      ]
    }).sort({ timestamp: 1 });

    res.json(messages);
  });

  // --- File Upload Route ---
  app.post('/api/messages/attachment', authenticateToken, upload.single('file'), async (req: AuthRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.json({
      url: fileUrl,
      name: req.file.originalname,
      type: req.file.mimetype.startsWith('image/') ? 'image' : 'document'
    });
  });
  
  // Create default admin if no users exist
  User.countDocuments().then(async (count) => {
    if (count === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      const admin = new User({
        username: 'admin',
        email: 'admin@crispchat.local',
        password: hash,
        role: 'admin'
      });
      await admin.save();
      console.log('Default admin created: admin@crispchat.local / admin123');
    }
  });
}
