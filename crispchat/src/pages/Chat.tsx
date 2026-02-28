import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Search, MoreVertical, Send, Paperclip, Smile, Check, CheckCheck, User as UserIcon, LogOut, Info, Moon, Sun, FileText, X, Loader2 } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '../context/ThemeContext';

interface User {
  id: string;
  username: string;
  email: string;
  status: string;
  last_seen: string;
  online?: boolean;
}

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  media_url?: string;
  media_type?: string;
  media_name?: string;
  status: 'sent' | 'delivered' | 'seen';
  timestamp: string;
}

export default function Chat() {
  const { user, token, logout } = useAuth();
  const { socket, connected } = useSocket();
  const { isDarkMode, toggleTheme } = useTheme();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [showMenu, setShowMenu] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string; type: string; name: string } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchUsers();
  }, [token]);

  useEffect(() => {
    if (selectedUser) {
      fetchMessages(selectedUser.id);
    }
  }, [selectedUser, token]);

  useEffect(() => {
    if (!socket) return;

    socket.on('receive_message', (message: Message) => {
      if (selectedUser && message.sender_id === selectedUser.id) {
        setMessages(prev => [...prev, message]);
        socket.emit('message_seen', { messageId: message.id, senderId: message.sender_id });
      } else {
        // Show notification or update unread count
      }
    });

    socket.on('message_sent', (message: Message) => {
      setMessages(prev => [...prev, message]);
    });

    socket.on('message_status', ({ messageId, status }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status } : m));
    });

    socket.on('user_online', ({ userId, last_seen }) => {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, online: true, last_seen } : u));
      if (selectedUser?.id === userId) {
        setSelectedUser(prev => prev ? { ...prev, online: true, last_seen } : null);
      }
    });

    socket.on('user_offline', ({ userId, last_seen }) => {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, online: false, last_seen } : u));
      if (selectedUser?.id === userId) {
        setSelectedUser(prev => prev ? { ...prev, online: false, last_seen } : null);
      }
    });

    socket.on('typing', ({ senderId }) => {
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        newSet.add(senderId);
        return newSet;
      });
    });

    socket.on('stop_typing', ({ senderId }) => {
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(senderId);
        return newSet;
      });
    });

    return () => {
      socket.off('receive_message');
      socket.off('message_sent');
      socket.off('message_status');
      socket.off('user_online');
      socket.off('user_offline');
      socket.off('typing');
      socket.off('stop_typing');
    };
  }, [socket, selectedUser]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (error) {
      console.error('Failed to fetch users', error);
    }
  };

  const fetchMessages = async (userId: string) => {
    try {
      const res = await fetch(`/api/messages/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
        
        // Mark unread messages as seen
        data.forEach((m: Message) => {
          if (m.receiver_id === user?.id && m.status !== 'seen') {
            socket?.emit('message_seen', { messageId: m.id, senderId: m.sender_id });
          }
        });
      }
    } catch (error) {
      console.error('Failed to fetch messages', error);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !attachment) || !selectedUser || !socket) return;

    socket.emit('send_message', {
      receiverId: selectedUser.id,
      message: newMessage.trim(),
      mediaUrl: attachment?.url,
      mediaType: attachment?.type,
      mediaName: attachment?.name
    });

    setNewMessage('');
    setAttachment(null);
    socket.emit('stop_typing', { receiverId: selectedUser.id });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/messages/attachment', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        setAttachment(data);
      } else {
        alert('Failed to upload file');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Error uploading file');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    if (!selectedUser || !socket) return;

    socket.emit('typing', { receiverId: selectedUser.id });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stop_typing', { receiverId: selectedUser.id });
    }, 2000);
  };

  const onEmojiSelect = (emojiData: any) => {
    setNewMessage(prev => prev + emojiData.emoji);
    setShowEmoji(false);
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`flex h-screen ${isDarkMode ? 'bg-[#050505] text-white' : 'bg-gray-50 text-gray-900'} overflow-hidden font-sans selection:bg-emerald-500/30 transition-colors duration-300`}>
      {/* Sidebar */}
      <div className={`w-1/3 max-w-sm ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'} backdrop-blur-2xl border-r flex flex-col relative z-20 transition-colors duration-300`}>
        {/* Header */}
        <div className={`p-4 flex items-center justify-between border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200'} transition-colors duration-300 relative z-30`}>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center text-white font-bold shadow-lg shadow-emerald-500/20">
              {user?.username.charAt(0).toUpperCase()}
            </div>
            <span className="font-semibold tracking-wide">{user?.username}</span>
          </div>
          <div className="relative flex items-center space-x-1">
            <button 
              onClick={toggleTheme} 
              className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}
              title="Toggle Dark Mode"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button 
              onClick={() => setShowMenu(!showMenu)} 
              className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            <AnimatePresence>
              {showMenu && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  className={`absolute right-0 mt-2 w-48 ${isDarkMode ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'} border rounded-xl shadow-2xl overflow-hidden z-50 backdrop-blur-xl`}
                >
                  <button 
                    onClick={logout}
                    className={`w-full text-left px-4 py-3 text-sm flex items-center space-x-2 transition-colors ${isDarkMode ? 'text-red-400 hover:bg-white/5' : 'text-red-600 hover:bg-gray-50'}`}
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Logout</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Search */}
        <div className={`p-4 border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200'} transition-colors duration-300`}>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full border rounded-full pl-11 pr-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder-gray-500 ${
                isDarkMode 
                  ? 'bg-white/5 border-white/10 focus:bg-white/10 text-white' 
                  : 'bg-gray-100 border-transparent focus:bg-white focus:border-emerald-500/30 text-gray-900'
              }`}
            />
          </div>
        </div>

        {/* Contact List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredUsers.map(u => (
            <div
              key={u.id}
              onClick={() => setSelectedUser(u)}
              className={`flex items-center p-4 cursor-pointer transition-all border-b ${
                isDarkMode 
                  ? `hover:bg-white/5 border-white/5 ${selectedUser?.id === u.id ? 'bg-white/10 border-l-2 border-l-emerald-500' : 'border-l-2 border-l-transparent'}`
                  : `hover:bg-gray-50 border-gray-100 ${selectedUser?.id === u.id ? 'bg-emerald-50/50 border-l-2 border-l-emerald-500' : 'border-l-2 border-l-transparent'}`
              }`}
            >
              <div className="relative">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shadow-inner border ${
                  isDarkMode 
                    ? 'bg-gradient-to-br from-gray-700 to-gray-800 text-white border-white/10' 
                    : 'bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700 border-emerald-200/50'
                }`}>
                  {u.username.charAt(0).toUpperCase()}
                </div>
                {u.online && (
                  <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.6)] ${isDarkMode ? 'border-[#111]' : 'border-white'}`}></div>
                )}
              </div>
              <div className="ml-4 flex-1 overflow-hidden">
                <div className="flex justify-between items-baseline">
                  <h3 className={`font-medium truncate ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>{u.username}</h3>
                  <span className="text-[11px] text-gray-500 whitespace-nowrap ml-2">
                    {u.online ? (
                      <span className="text-emerald-400">Online</span>
                    ) : (
                      format(new Date(u.last_seen), 'HH:mm')
                    )}
                  </span>
                </div>
                <p className="text-sm text-gray-400 truncate mt-0.5">
                  {typingUsers.has(u.id) ? (
                    <span className="text-emerald-400 italic text-xs tracking-wide">typing...</span>
                  ) : (
                    u.email
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`flex-1 flex flex-col relative bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] ${
        isDarkMode 
          ? 'from-gray-900 via-[#050505] to-black' 
          : 'from-emerald-50/50 via-gray-50 to-white'
      } transition-colors duration-300`}>
        {/* Decorative background elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className={`absolute top-[-10%] right-[-5%] w-96 h-96 rounded-full blur-3xl ${isDarkMode ? 'bg-emerald-500/10' : 'bg-emerald-500/5'}`}></div>
          <div className={`absolute bottom-[-10%] left-[-5%] w-96 h-96 rounded-full blur-3xl ${isDarkMode ? 'bg-blue-500/5' : 'bg-blue-500/5'}`}></div>
        </div>

        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className={`backdrop-blur-xl p-4 flex items-center justify-between border-b z-30 transition-colors duration-300 ${
              isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'
            }`}>
              <div className="flex items-center space-x-4">
                <div className="relative">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold border ${
                    isDarkMode 
                      ? 'bg-gradient-to-br from-gray-700 to-gray-800 text-white border-white/10' 
                      : 'bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700 border-emerald-200/50'
                  }`}>
                    {selectedUser.username.charAt(0).toUpperCase()}
                  </div>
                  {selectedUser.online && (
                    <div className={`absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.6)] ${isDarkMode ? 'border-[#111]' : 'border-white'}`}></div>
                  )}
                </div>
                <div>
                  <h2 className={`font-semibold tracking-wide ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>{selectedUser.username}</h2>
                  <p className="text-xs text-gray-500">
                    {typingUsers.has(selectedUser.id) 
                      ? <span className="text-emerald-400 italic">typing...</span>
                      : selectedUser.online 
                        ? <span className="text-emerald-400">Online</span>
                        : `Last seen ${format(new Date(selectedUser.last_seen), 'MMM d, HH:mm')}`}
                  </p>
                </div>
              </div>
              <div className={`flex items-center space-x-2 relative ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <button className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}>
                  <Search className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setShowChatMenu(!showChatMenu)}
                  className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
                <AnimatePresence>
                  {showChatMenu && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 10 }}
                      className={`absolute right-0 top-12 w-48 border rounded-xl shadow-2xl overflow-hidden z-50 backdrop-blur-xl ${
                        isDarkMode ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'
                      }`}
                    >
                      <button 
                        onClick={() => {
                          setSelectedUser(null);
                          setShowChatMenu(false);
                        }}
                        className={`w-full text-left px-4 py-3 text-sm flex items-center space-x-2 transition-colors ${
                          isDarkMode ? 'text-gray-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Info className="w-4 h-4" />
                        <span>Close Chat</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 z-10 custom-scrollbar">
              {messages.map((msg, index) => {
                const isMine = msg.sender_id === user?.id;
                const showDate = index === 0 || 
                  format(new Date(msg.timestamp), 'yyyy-MM-dd') !== format(new Date(messages[index - 1].timestamp), 'yyyy-MM-dd');

                return (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={msg.id}
                  >
                    {showDate && (
                      <div className="flex justify-center my-6">
                        <span className={`backdrop-blur-md border px-4 py-1.5 rounded-full text-xs shadow-sm ${
                          isDarkMode 
                            ? 'bg-white/5 border-white/10 text-gray-400' 
                            : 'bg-white/80 border-gray-200 text-gray-500'
                        }`}>
                          {format(new Date(msg.timestamp), 'MMMM d, yyyy')}
                        </span>
                      </div>
                    )}
                    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl p-3.5 shadow-sm relative backdrop-blur-md border ${
                        isMine 
                          ? isDarkMode 
                            ? 'bg-emerald-600/20 border-emerald-500/30 rounded-tr-sm text-emerald-50' 
                            : 'bg-[#d9fdd3] border-[#d9fdd3] rounded-tr-sm text-gray-900'
                          : isDarkMode
                            ? 'bg-white/10 border-white/10 rounded-tl-sm text-gray-100'
                            : 'bg-white border-gray-100 rounded-tl-sm text-gray-900'
                      }`}>
                        {msg.media_url && (
                          <div className="mb-2 rounded-lg overflow-hidden">
                            {msg.media_type === 'image' ? (
                              <img src={msg.media_url} alt="attachment" className="max-w-full max-h-64 object-cover rounded-lg" />
                            ) : (
                              <a 
                                href={msg.media_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className={`flex items-center space-x-2 p-3 rounded-lg ${isMine ? 'bg-black/10' : 'bg-black/5'} hover:bg-black/20 transition-colors`}
                              >
                                <FileText className="w-8 h-8 opacity-80" />
                                <span className="text-sm truncate max-w-[200px]">{msg.media_name || 'Document'}</span>
                              </a>
                            )}
                          </div>
                        )}
                        {msg.message && (
                          <p className="text-[15px] leading-relaxed break-words pr-14 font-light">
                            {msg.message}
                          </p>
                        )}
                        <div className="absolute bottom-1.5 right-2.5 flex items-center space-x-1.5">
                          <span className={`text-[10px] font-mono ${isDarkMode ? 'text-gray-400/80' : 'text-gray-500'}`}>
                            {format(new Date(msg.timestamp), 'HH:mm')}
                          </span>
                          {isMine && (
                            <span className={isDarkMode ? 'text-gray-400/80' : 'text-gray-400'}>
                              {msg.status === 'sent' && <Check className="w-3.5 h-3.5" />}
                              {msg.status === 'delivered' && <CheckCheck className="w-3.5 h-3.5" />}
                              {msg.status === 'seen' && <CheckCheck className={`w-3.5 h-3.5 ${isDarkMode ? 'text-emerald-400' : 'text-blue-500'}`} />}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              <div ref={messagesEndRef} className="h-20" /> {/* Extra padding for floating input */}
            </div>

            {/* Floating Input Area */}
            <div className="absolute bottom-6 left-0 right-0 px-6 z-20 flex flex-col items-center">
              
              {/* Attachment Preview */}
              <AnimatePresence>
                {attachment && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className={`mb-3 w-full max-w-3xl p-3 rounded-2xl flex items-center justify-between border backdrop-blur-xl shadow-lg ${
                      isDarkMode ? 'bg-white/10 border-white/20' : 'bg-white/90 border-gray-200'
                    }`}
                  >
                    <div className="flex items-center space-x-3 overflow-hidden">
                      {attachment.type === 'image' ? (
                        <div className="w-12 h-12 rounded-lg bg-black/20 overflow-hidden flex-shrink-0">
                          <img src={attachment.url} alt="preview" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-6 h-6 text-emerald-500" />
                        </div>
                      )}
                      <div className="truncate">
                        <p className={`text-sm font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{attachment.name}</p>
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Ready to send</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setAttachment(null)}
                      className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className={`w-full max-w-3xl backdrop-blur-xl border p-2 rounded-full flex items-end space-x-2 shadow-2xl ${
                  isDarkMode 
                    ? 'bg-white/10 border-white/20 shadow-black/50' 
                    : 'bg-white/90 border-gray-200 shadow-gray-200/50'
                }`}
              >
                {showEmoji && (
                  <div className={`absolute bottom-20 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden border ${
                    isDarkMode ? 'border-white/10' : 'border-gray-200'
                  }`}>
                    <EmojiPicker onEmojiClick={onEmojiSelect} theme={isDarkMode ? "dark" : "light"} />
                  </div>
                )}
                
                <button 
                  onClick={() => setShowEmoji(!showEmoji)}
                  className={`p-3 rounded-full transition-all ${
                    isDarkMode ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Smile className="w-5 h-5" />
                </button>
                
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  className="hidden" 
                  accept="image/*,.pdf,.doc,.docx"
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className={`p-3 rounded-full transition-all ${
                    isDarkMode ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
                </button>
                
                <form onSubmit={handleSendMessage} className={`flex-1 flex items-center rounded-full px-4 py-1 border ${
                  isDarkMode ? 'bg-black/20 border-white/5' : 'bg-gray-100 border-transparent'
                }`}>
                  <input
                    type="text"
                    value={newMessage}
                    onChange={handleTyping}
                    placeholder={attachment ? "Add a caption..." : "Message..."}
                    className={`flex-1 bg-transparent py-2.5 focus:outline-none text-[15px] font-light ${
                      isDarkMode ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-500'
                    }`}
                  />
                  <AnimatePresence>
                    {(newMessage.trim() || attachment) && (
                      <motion.button 
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        type="submit"
                        className="p-2 ml-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full shadow-md transition-colors"
                      >
                        <Send className="w-4 h-4 ml-0.5" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </form>
              </motion.div>
            </div>
            
            {/* Real-time typing indicator above input */}
            <AnimatePresence>
              {typingUsers.has(selectedUser.id) && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className={`absolute bottom-24 left-10 z-10 backdrop-blur-md border px-4 py-2 rounded-full shadow-lg flex items-center space-x-2 ${
                    isDarkMode ? 'bg-white/10 border-white/10' : 'bg-white/80 border-gray-200'
                  }`}
                >
                  <div className="flex space-x-1">
                    <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                    <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                    <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  </div>
                  <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>{selectedUser.username} is typing</span>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 z-10">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5 }}
              className={`w-32 h-32 backdrop-blur-xl border rounded-full flex items-center justify-center mb-8 shadow-2xl ${
                isDarkMode 
                  ? 'bg-gradient-to-br from-white/5 to-white/10 border-white/10' 
                  : 'bg-gradient-to-br from-white/50 to-white/80 border-gray-200'
              }`}
            >
              <UserIcon className={`w-12 h-12 ${isDarkMode ? 'text-gray-400' : 'text-emerald-600/50'}`} />
            </motion.div>
            <h2 className={`text-3xl font-light mb-4 tracking-wide ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>Crispchat</h2>
            <p className={`max-w-md font-light leading-relaxed ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Select a contact from the sidebar to start a secure, end-to-end encrypted conversation.
            </p>
            <div className={`mt-12 flex items-center space-x-2 text-xs px-4 py-2 rounded-full border ${
              isDarkMode 
                ? 'text-gray-500 bg-white/5 border-white/5' 
                : 'text-gray-500 bg-white/50 border-gray-200'
            }`}>
              <Check className="w-3.5 h-3.5" />
              <span>Private Internal Network</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
