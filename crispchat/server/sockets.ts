import { Server, Socket } from 'socket.io';
import { verifyToken } from './middleware.js';
import { User } from './models/User.js';
import { Message } from './models/Message.js';

interface AuthenticatedSocket extends Socket {
  user?: { id: string; role: string };
}

export const activeUsers = new Map<string, string>(); // userId -> socketId

export function setupSockets(io: Server) {
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error'));
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return next(new Error('Authentication error'));
    }

    socket.user = decoded;
    next();
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    const userId = socket.user!.id;
    
    // Update active users
    activeUsers.set(userId, socket.id);
    
    // Update last seen and online status
    await User.findByIdAndUpdate(userId, { last_seen: new Date() });
    
    // Broadcast online status
    io.emit('user_online', { userId, last_seen: new Date().toISOString() });

    // Join personal room for private messages
    socket.join(userId);

    socket.on('send_message', async (data: { receiverId: string; message: string; mediaUrl?: string; mediaType?: string; mediaName?: string }) => {
      const { receiverId, message, mediaUrl, mediaType, mediaName } = data;

      try {
        const newMessage = new Message({
          sender_id: userId,
          receiver_id: receiverId,
          message,
          media_url: mediaUrl || null,
          media_type: mediaType || null,
          media_name: mediaName || null,
          status: 'sent'
        });

        await newMessage.save();

        const messageData = newMessage.toJSON();

        // Send to receiver
        io.to(receiverId).emit('receive_message', messageData);
        
        // Acknowledge to sender
        socket.emit('message_sent', messageData);

        // If receiver is online, update status to delivered
        if (activeUsers.has(receiverId)) {
          await Message.findByIdAndUpdate(newMessage._id, { status: 'delivered' });
          io.to(userId).emit('message_status', { messageId: newMessage.id, status: 'delivered' });
        }
      } catch (error) {
        console.error('Error saving message:', error);
      }
    });

    socket.on('message_seen', async (data: { messageId: string; senderId: string }) => {
      const { messageId, senderId } = data;
      try {
        await Message.findByIdAndUpdate(messageId, { status: 'seen', seen_at: new Date() });
        io.to(senderId).emit('message_status', { messageId, status: 'seen' });
      } catch (error) {
        console.error('Error updating message status:', error);
      }
    });

    socket.on('typing', (data: { receiverId: string }) => {
      io.to(data.receiverId).emit('typing', { senderId: userId });
    });

    socket.on('stop_typing', (data: { receiverId: string }) => {
      io.to(data.receiverId).emit('stop_typing', { senderId: userId });
    });

    socket.on('disconnect', async () => {
      activeUsers.delete(userId);
      await User.findByIdAndUpdate(userId, { last_seen: new Date() });
      io.emit('user_offline', { userId, last_seen: new Date().toISOString() });
    });
  });
}
