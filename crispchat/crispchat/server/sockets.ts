import { Server, Socket } from 'socket.io';
import { verifyToken } from './middleware.js';
import { User } from './models/User.js';
import { Message } from './models/Message.js';

interface AuthenticatedSocket extends Socket {
  user?: { id: string; role: string };
}

export const activeUsers = new Map<string, Set<string>>(); // userId -> Set of socketIds

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
    if (!activeUsers.has(userId)) {
      activeUsers.set(userId, new Set());
    }
    activeUsers.get(userId)!.add(socket.id);
    
    // Update last seen and online status
    await User.findByIdAndUpdate(userId, { last_seen: new Date() });
    
    // Broadcast online status
    io.emit('user_online', { userId, last_seen: new Date().toISOString() });

    // Mark undelivered messages as delivered
    try {
      const undeliveredMessages = await Message.find({ receiver_id: userId, status: 'sent' });
      if (undeliveredMessages.length > 0) {
        await Message.updateMany({ receiver_id: userId, status: 'sent' }, { status: 'delivered' });
        
        // Notify senders
        const senderIds = new Set(undeliveredMessages.map(m => m.sender_id.toString()));
        senderIds.forEach(senderId => {
          undeliveredMessages.filter(m => m.sender_id.toString() === senderId).forEach(m => {
            io.to(senderId).emit('message_status', { messageId: m.id, status: 'delivered' });
          });
        });
      }
    } catch (error) {
      console.error('Error updating undelivered messages:', error);
    }

    // Join personal room for private messages
    socket.join(userId);

    socket.on('send_message', async (data: { receiverId: string; message: string; mediaUrl?: string; mediaType?: string; mediaName?: string; replyTo?: string }) => {
      const { receiverId, message, mediaUrl, mediaType, mediaName, replyTo } = data;

      try {
        const newMessage = new Message({
          sender_id: userId,
          receiver_id: receiverId,
          message,
          media_url: mediaUrl || null,
          media_type: mediaType || null,
          media_name: mediaName || null,
          status: 'sent',
          reply_to: replyTo || null
        });

        await newMessage.save();

        const populatedMessage = await newMessage.populate('reply_to', 'message media_type media_name sender_id');
        const messageData = populatedMessage.toJSON();

        // Send to receiver
        io.to(receiverId).emit('receive_message', messageData);
        
        // Acknowledge to sender
        socket.emit('message_sent', messageData);

        // If receiver is online, update status to delivered
        if (activeUsers.has(receiverId) && activeUsers.get(receiverId)!.size > 0) {
          // Only update to delivered if it hasn't been marked as seen already
          const currentMsg = await Message.findById(newMessage._id);
          if (currentMsg && currentMsg.status === 'sent') {
            await Message.findByIdAndUpdate(newMessage._id, { status: 'delivered' });
            io.to(userId).emit('message_status', { messageId: newMessage.id, status: 'delivered' });
          }
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

    socket.on('react_message', async (data: { messageId: string; emoji: string }) => {
      const { messageId, emoji } = data;
      try {
        const message = await Message.findById(messageId);
        if (!message) return;

        // Check if user already reacted with this emoji
        const existingReaction = message.reactions.find(r => r.user_id.toString() === userId && r.emoji === emoji);
        
        if (existingReaction) {
          // Remove reaction
          message.reactions.pull(existingReaction._id);
        } else {
          // Add reaction
          message.reactions.push({ emoji, user_id: userId as any });
        }

        await message.save();

        // Broadcast reaction to both sender and receiver
        io.to(message.sender_id.toString()).emit('message_reaction', { messageId, reactions: message.reactions });
        io.to(message.receiver_id.toString()).emit('message_reaction', { messageId, reactions: message.reactions });
      } catch (error) {
        console.error('Error reacting to message:', error);
      }
    });

    socket.on('typing', (data: { receiverId: string }) => {
      io.to(data.receiverId).emit('typing', { senderId: userId });
    });

    socket.on('stop_typing', (data: { receiverId: string }) => {
      io.to(data.receiverId).emit('stop_typing', { senderId: userId });
    });

    socket.on('disconnect', async () => {
      const userSockets = activeUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          activeUsers.delete(userId);
          await User.findByIdAndUpdate(userId, { last_seen: new Date() });
          io.emit('user_offline', { userId, last_seen: new Date().toISOString() });
        }
      }
    });
  });
}
