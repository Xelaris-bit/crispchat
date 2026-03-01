import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Search, MoreVertical, Send, Paperclip, Smile, Check, CheckCheck, User as UserIcon, LogOut, Info, Moon, Sun, FileText, X, Loader2, ArrowLeft, Reply, Forward, CornerDownRight, Camera, Edit2, Trash2 } from 'lucide-react';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { format, isToday, isYesterday, differenceInMinutes, differenceInHours, differenceInCalendarDays } from 'date-fns';
import { motion, AnimatePresence, useAnimation, PanInfo } from 'motion/react';
import { useTheme } from '../context/ThemeContext';

interface User {
  id: string;
  username: string;
  email: string;
  status: string;
  last_seen: string;
  online?: boolean;
  unread_count?: number;
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
  reactions?: { emoji: string; user_id: string }[];
  reply_to?: {
    _id: string;
    message: string;
    media_type?: string;
    media_name?: string;
    sender_id: string;
  };
}

const getRelativeTime = (date: string | number | Date) => {
  const d = new Date(date);
  const now = new Date();
  const diffInMins = differenceInMinutes(now, d);
  
  if (diffInMins < 1) return 'Just now';
  if (diffInMins < 60) return `${diffInMins} minute${diffInMins > 1 ? 's' : ''} ago`;
  
  if (isToday(d)) {
    const hours = differenceInHours(now, d);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }
  
  if (isYesterday(d)) return 'Yesterday';
  
  const days = differenceInCalendarDays(now, d);
  return `${days} day${days > 1 ? 's' : ''} ago`;
};

const getExactTime = (date: string | number | Date) => {
  const d = new Date(date);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday(d) || isYesterday(d)) {
    return timeStr;
  }
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  return `${dateStr} • ${timeStr}`;
};

export default function Chat() {
  const { user, token, logout } = useAuth();
  const { socket, connected } = useSocket();
  const { isDarkMode, toggleTheme } = useTheme();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [showMenu, setShowMenu] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingProfile, setIsUploadingProfile] = useState(false);
  const [bioInput, setBioInput] = useState(user?.bio || '');
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string; type: string; name: string } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
      if (chatMenuRef.current && !chatMenuRef.current.contains(event.target as Node)) {
        setShowChatMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [token]);

  useEffect(() => {
    if (selectedUser) {
      setPage(1);
      setHasMore(true);
      fetchMessages(selectedUser.id, 1);
    }
  }, [selectedUser, token]);

  useEffect(() => {
    if (!socket) return;

    socket.on('receive_message', (message: Message) => {
      if (selectedUser && message.sender_id === selectedUser.id) {
        setMessages(prev => [...prev, message]);
        if (document.hasFocus()) {
          socket.emit('message_seen', { messageId: message.id, senderId: message.sender_id });
        } else {
          // If not focused, we should mark it as seen when they focus
          const handleFocus = () => {
            socket.emit('message_seen', { messageId: message.id, senderId: message.sender_id });
            window.removeEventListener('focus', handleFocus);
          };
          window.addEventListener('focus', handleFocus);
        }
      } else {
        // Update unread count
        setUsers(prev => prev.map(u => 
          u.id === message.sender_id 
            ? { ...u, unread_count: (u.unread_count || 0) + 1 } 
            : u
        ));
      }
    });

    socket.on('message_sent', (message: Message) => {
      setMessages(prev => [...prev, message]);
    });

    socket.on('message_status', ({ messageId, status }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, status } : m));
    });

    socket.on('message_reaction', ({ messageId, reactions }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
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
      socket.off('message_reaction');
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

  const fetchMessages = async (userId: string, pageNum: number = 1) => {
    try {
      setIsLoadingMessages(true);
      const res = await fetch(`/api/messages/${userId}?page=${pageNum}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.length < 50) {
          setHasMore(false);
        }
        
        if (pageNum === 1) {
          setMessages(data);
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
          }, 100);
        } else {
          const container = messagesContainerRef.current;
          const scrollHeightBefore = container?.scrollHeight || 0;
          
          setMessages(prev => [...data, ...prev]);
          
          setTimeout(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - scrollHeightBefore;
            }
          }, 0);
        }
        
        // Mark unread messages as seen
        if (document.hasFocus()) {
          data.forEach((m: Message) => {
            if (m.receiver_id === user?.id && m.status !== 'seen') {
              socket?.emit('message_seen', { messageId: m.id, senderId: m.sender_id });
            }
          });
        } else {
          const handleFocus = () => {
            data.forEach((m: Message) => {
              if (m.receiver_id === user?.id && m.status !== 'seen') {
                socket?.emit('message_seen', { messageId: m.id, senderId: m.sender_id });
              }
            });
            window.removeEventListener('focus', handleFocus);
          };
          window.addEventListener('focus', handleFocus);
        }
      }
    } catch (error) {
      console.error('Failed to fetch messages', error);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop } = messagesContainerRef.current;
      if (scrollTop === 0 && hasMore && !isLoadingMessages && selectedUser) {
        setPage(prev => {
          const nextPage = prev + 1;
          fetchMessages(selectedUser.id, nextPage);
          return nextPage;
        });
      }
    }
  };

  const handleSendMessage = (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !attachment) || !selectedUser || !socket) return;

    socket.emit('send_message', {
      receiverId: selectedUser.id,
      message: newMessage.trim(),
      mediaUrl: attachment?.url,
      mediaType: attachment?.type,
      mediaName: attachment?.name,
      replyTo: replyingTo?.id
    });

    setNewMessage('');
    setAttachment(null);
    setReplyingTo(null);
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

  const { updateUser } = useAuth();

  const handleProfileImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingProfile(true);
    const formData = new FormData();
    formData.append('profile_image', file);

    try {
      const res = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        const updatedUser = await res.json();
        updateUser(updatedUser);
      } else {
        alert('Failed to update profile image');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Error updating profile image');
    } finally {
      setIsUploadingProfile(false);
      if (profileImageInputRef.current) profileImageInputRef.current.value = '';
    }
  };

  const handleRemoveProfileImage = async () => {
    try {
      const formData = new FormData();
      formData.append('remove_image', 'true');

      const res = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        const updatedUser = await res.json();
        updateUser(updatedUser);
      } else {
        alert('Failed to remove profile image');
      }
    } catch (error) {
      console.error('Error removing profile image:', error);
      alert('Error removing profile image');
    }
  };

  const handleSaveBio = async () => {
    if (bioInput === user?.bio) {
      setIsEditingBio(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('bio', bioInput);

      const res = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (res.ok) {
        const updatedUser = await res.json();
        updateUser(updatedUser);
        setIsEditingBio(false);
      } else {
        alert('Failed to update bio');
      }
    } catch (error) {
      console.error('Error updating bio:', error);
      alert('Error updating bio');
    }
  };

  const onEmojiSelect = (emojiData: any) => {
    setNewMessage(prev => prev + emojiData.emoji);
    setShowEmoji(false);
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`flex h-[100dvh] ${isDarkMode ? 'bg-[#050505] text-white' : 'bg-gray-50 text-gray-900'} overflow-hidden font-sans selection:bg-emerald-500/30 transition-colors duration-300`}>
      {/* Sidebar */}
      <div className={`${selectedUser ? 'hidden md:flex' : 'flex'} w-full md:w-1/3 md:max-w-sm ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'} backdrop-blur-2xl border-r flex-col relative z-20 transition-colors duration-300`}>
        {showProfile ? (
          <div className="flex flex-col h-full">
            <div className={`p-4 flex items-center space-x-4 border-b ${isDarkMode ? 'border-white/10 bg-[#202c33]' : 'border-gray-200 bg-[#008069] text-white'}`}>
              <button 
                onClick={() => setShowProfile(false)}
                className="p-2 -ml-2 rounded-full transition-colors hover:bg-black/10"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-lg font-semibold">Profile</h1>
            </div>
            <div className={`flex-1 overflow-y-auto ${isDarkMode ? 'bg-[#111b21]' : 'bg-[#f0f2f5]'}`}>
              <div className="flex flex-col items-center py-8">
                <div className="relative group cursor-pointer" onClick={() => profileImageInputRef.current?.click()}>
                  <div className={`w-40 h-40 rounded-full flex items-center justify-center text-4xl font-bold shadow-lg overflow-hidden ${
                    user?.profile_image ? '' : 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white'
                  }`}>
                    {user?.profile_image ? (
                      <img src={user.profile_image} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      user?.username.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white">
                    <Camera className="w-8 h-8 mb-2" />
                    <span className="text-xs text-center px-4 uppercase tracking-wider">Change<br/>Profile Photo</span>
                  </div>
                  {isUploadingProfile && (
                    <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center text-white">
                      <Loader2 className="w-8 h-8 animate-spin" />
                    </div>
                  )}
                </div>
                <input 
                  type="file" 
                  ref={profileImageInputRef} 
                  onChange={handleProfileImageUpload} 
                  className="hidden" 
                  accept="image/*"
                />
                {user?.profile_image && (
                  <button 
                    onClick={handleRemoveProfileImage}
                    className="mt-4 text-red-500 hover:text-red-600 flex items-center space-x-1 text-sm font-medium"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Remove Photo</span>
                  </button>
                )}
              </div>

              <div className={`px-6 py-4 shadow-sm mb-4 ${isDarkMode ? 'bg-[#202c33]' : 'bg-white'}`}>
                <p className={`text-sm mb-2 ${isDarkMode ? 'text-[#00a884]' : 'text-[#008069]'}`}>Your name</p>
                <div className="flex items-center justify-between">
                  <p className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{user?.username}</p>
                </div>
                <p className={`text-xs mt-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  This is not your username or pin. This name will be visible to your contacts.
                </p>
              </div>

              <div className={`px-6 py-4 shadow-sm ${isDarkMode ? 'bg-[#202c33]' : 'bg-white'}`}>
                <p className={`text-sm mb-2 ${isDarkMode ? 'text-[#00a884]' : 'text-[#008069]'}`}>About</p>
                <div className="flex items-center justify-between">
                  {isEditingBio ? (
                    <div className="flex-1 flex items-center border-b-2 border-[#00a884] pb-1">
                      <input 
                        type="text" 
                        value={bioInput}
                        onChange={(e) => setBioInput(e.target.value)}
                        className="flex-1 bg-transparent focus:outline-none"
                        autoFocus
                      />
                      <button onClick={handleSaveBio} className="ml-2 text-[#00a884]">
                        <Check className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{user?.bio || 'Hey there! I am using this app.'}</p>
                      <button onClick={() => setIsEditingBio(true)} className={`p-1 rounded-full ${isDarkMode ? 'text-gray-400 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'}`}>
                        <Edit2 className="w-5 h-5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className={`p-4 flex items-center justify-between border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200'} transition-colors duration-300 relative z-30`}>
              <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setShowProfile(true)}>
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center text-white font-bold shadow-lg shadow-emerald-500/20 overflow-hidden">
                  {user?.profile_image ? (
                    <img src={user.profile_image} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    user?.username.charAt(0).toUpperCase()
                  )}
                </div>
                <span className="font-semibold tracking-wide">{user?.username}</span>
              </div>
              <div className="relative" ref={menuRef}>
                <div className="flex items-center space-x-1">
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
                </div>
                <AnimatePresence>
                  {showMenu && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 10 }}
                      className={`absolute right-0 top-full mt-2 w-48 ${isDarkMode ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-200'} border rounded-xl shadow-2xl overflow-hidden z-50 backdrop-blur-xl`}
                    >
                      <button 
                        onClick={() => {
                          setShowProfile(true);
                          setShowMenu(false);
                        }}
                        className={`w-full text-left px-4 py-3 text-sm flex items-center space-x-2 transition-colors ${isDarkMode ? 'text-gray-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        <UserIcon className="w-4 h-4" />
                        <span>Profile</span>
                      </button>
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
                  onClick={() => {
                    setSelectedUser(u);
                    setUsers(prev => prev.map(user => user.id === u.id ? { ...user, unread_count: 0 } : user));
                  }}
                  className={`flex items-center p-4 cursor-pointer transition-all border-b ${
                    isDarkMode 
                      ? `hover:bg-white/5 border-white/5 ${selectedUser?.id === u.id ? 'bg-white/10 border-l-2 border-l-emerald-500' : 'border-l-2 border-l-transparent'}`
                      : `hover:bg-gray-50 border-gray-100 ${selectedUser?.id === u.id ? 'bg-emerald-50/50 border-l-2 border-l-emerald-500' : 'border-l-2 border-l-transparent'}`
                  }`}
                >
                  <div className="relative">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shadow-inner border overflow-hidden ${
                      isDarkMode 
                        ? 'bg-gradient-to-br from-gray-700 to-gray-800 text-white border-white/10' 
                        : 'bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700 border-emerald-200/50'
                    }`}>
                      {u.profile_image ? (
                        <img src={u.profile_image} alt={u.username} className="w-full h-full object-cover" />
                      ) : (
                        u.username.charAt(0).toUpperCase()
                      )}
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
                    <div className="flex justify-between items-center mt-0.5">
                      <p className="text-sm text-gray-400 truncate">
                        {typingUsers.has(u.id) ? (
                          <span className="text-emerald-400 italic text-xs tracking-wide">typing...</span>
                        ) : (
                          u.bio || "Tap to chat"
                        )}
                      </p>
                      {u.unread_count ? (
                        <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full ml-2">
                          {u.unread_count}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Chat Area */}
      <div className={`${!selectedUser ? 'hidden md:flex' : 'flex'} flex-1 flex-col relative ${
        isDarkMode 
          ? 'bg-[#0b141a]' 
          : 'bg-[#efeae2]'
      } transition-colors duration-300`}>
        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className={`px-4 py-2 flex items-center justify-between z-30 transition-colors duration-300 ${
              isDarkMode ? 'bg-[#202c33] text-white' : 'bg-[#f0f2f5] text-[#111b21]'
            }`}>
              <div className="flex items-center space-x-4">
                <button 
                  onClick={() => setSelectedUser(null)}
                  className={`md:hidden p-2 -ml-2 rounded-full transition-colors ${
                    isDarkMode ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-100 text-gray-600'
                  }`}
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="relative">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold border overflow-hidden ${
                    isDarkMode 
                      ? 'bg-gradient-to-br from-gray-700 to-gray-800 text-white border-white/10' 
                      : 'bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700 border-emerald-200/50'
                  }`}>
                    {selectedUser.profile_image ? (
                      <img src={selectedUser.profile_image} alt={selectedUser.username} className="w-full h-full object-cover" />
                    ) : (
                      selectedUser.username.charAt(0).toUpperCase()
                    )}
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
              <div className="relative" ref={chatMenuRef}>
                <div className={`flex items-center space-x-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  <button 
                    onClick={() => setShowChatSearch(!showChatSearch)}
                    className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
                  >
                    <Search className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => setShowChatMenu(!showChatMenu)}
                    className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'}`}
                  >
                    <MoreVertical className="w-5 h-5" />
                  </button>
                </div>
                <AnimatePresence>
                  {showChatMenu && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 10 }}
                      className={`absolute right-0 top-full mt-2 w-48 border rounded-xl shadow-2xl overflow-hidden z-50 backdrop-blur-xl ${
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

            {/* Chat Search Bar */}
            <AnimatePresence>
              {showChatSearch && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className={`border-b z-20 overflow-hidden ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200'}`}
                >
                  <div className="p-3">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search messages..."
                        value={chatSearchQuery}
                        onChange={(e) => setChatSearchQuery(e.target.value)}
                        className={`w-full border rounded-full pl-10 pr-10 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all placeholder-gray-500 ${
                          isDarkMode 
                            ? 'bg-white/5 border-white/10 focus:bg-white/10 text-white' 
                            : 'bg-gray-100 border-transparent focus:bg-white focus:border-emerald-500/30 text-gray-900'
                        }`}
                      />
                      {chatSearchQuery && (
                        <button 
                          onClick={() => setChatSearchQuery('')}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Messages */}
            <div 
              ref={messagesContainerRef}
              onScroll={handleScroll}
              onClick={() => setActiveMessageId(null)}
              className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 space-y-4 md:space-y-6 z-10 custom-scrollbar"
            >
              {isLoadingMessages && page > 1 && (
                <div className="flex justify-center py-2">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                </div>
              )}
              {(() => {
                const filteredMessages = messages.filter(msg => 
                  !chatSearchQuery || 
                  msg.message?.toLowerCase().includes(chatSearchQuery.toLowerCase()) || 
                  msg.media_name?.toLowerCase().includes(chatSearchQuery.toLowerCase())
                );

                if (chatSearchQuery && filteredMessages.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-60">
                      <Search className="w-12 h-12" />
                      <p>No messages found for "{chatSearchQuery}"</p>
                    </div>
                  );
                }

                return filteredMessages.map((msg, index, filteredArray) => {
                  const isMine = msg.sender_id === user?.id;
                  const showDate = index === 0 || 
                    format(new Date(msg.timestamp), 'yyyy-MM-dd') !== format(new Date(filteredArray[index - 1].timestamp), 'yyyy-MM-dd');

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
                    <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} mb-4`}>
                      <div className="relative group max-w-[85%] md:max-w-[75%]">
                        <motion.div 
                          drag="x"
                          dragConstraints={{ left: 0, right: 0 }}
                          dragElastic={0.1}
                          onDragEnd={(e, info) => {
                            if (isMine && info.offset.x < -50) {
                              setReplyingTo(msg);
                            } else if (!isMine && info.offset.x > 50) {
                              setReplyingTo(msg);
                            }
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMessageId(activeMessageId === msg.id ? null : msg.id);
                          }}
                          className={`rounded-2xl px-2.5 py-1.5 shadow-sm relative cursor-pointer ${
                          isMine 
                            ? isDarkMode 
                              ? 'bg-[#005c4b] rounded-tr-[4px] text-[#e9edef]' 
                              : 'bg-[#d9fdd3] rounded-tr-[4px] text-[#111b21]'
                            : isDarkMode
                              ? 'bg-[#202c33] rounded-tl-[4px] text-[#e9edef]'
                              : 'bg-white rounded-tl-[4px] text-[#111b21]'
                        }`}>
                        {msg.reply_to && (
                          <div className={`mb-2 p-2 rounded-lg text-sm border-l-4 ${
                            isMine 
                              ? isDarkMode ? 'bg-black/20 border-emerald-400' : 'bg-black/5 border-emerald-500'
                              : isDarkMode ? 'bg-black/20 border-gray-400' : 'bg-black/5 border-gray-400'
                          }`}>
                            <p className={`font-semibold text-xs mb-1 ${isMine ? (isDarkMode ? 'text-emerald-400' : 'text-emerald-600') : (isDarkMode ? 'text-gray-300' : 'text-gray-600')}`}>
                              {msg.reply_to.sender_id === user?.id ? 'You' : selectedUser?.username}
                            </p>
                            <p className="truncate opacity-80">{msg.reply_to.message || (msg.reply_to.media_type === 'image' ? 'Photo' : 'Document')}</p>
                          </div>
                        )}
                        {msg.media_url && (
                          <div className={`mb-2 rounded-lg overflow-hidden ${!msg.message ? 'pb-4' : ''}`}>
                            {msg.media_type === 'image' ? (
                              <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="block relative group/img">
                                <img src={msg.media_url} alt="attachment" className="max-w-[260px] max-h-[300px] object-cover rounded-lg" />
                                <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/10 transition-colors rounded-lg" />
                              </a>
                            ) : (
                              <a 
                                href={msg.media_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className={`flex items-center space-x-3 p-3 rounded-lg ${isMine ? 'bg-black/10' : 'bg-black/5'} hover:bg-black/20 transition-colors`}
                              >
                                <div className={`p-2 rounded-lg ${isMine ? 'bg-emerald-500/20 text-emerald-600' : 'bg-blue-500/20 text-blue-600'}`}>
                                  <FileText className="w-6 h-6" />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium truncate max-w-[180px]">{msg.media_name || 'Document'}</span>
                                  <span className="text-[10px] opacity-70 uppercase mt-0.5">
                                    {msg.media_url.split('.').pop()} • Document
                                  </span>
                                </div>
                              </a>
                            )}
                          </div>
                        )}
                        {msg.message && (
                          <p className="text-[15px] leading-relaxed break-words font-light whitespace-pre-wrap">
                            {msg.message}
                            <span className="inline-block w-[65px] h-4"></span>
                          </p>
                        )}
                        <div className="absolute bottom-1 right-2 flex items-center space-x-1">
                          <span className={`text-[10px] ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
                            {getExactTime(msg.timestamp)}
                          </span>
                          {isMine && (
                            <span className={isDarkMode ? 'text-white/60' : 'text-gray-400'}>
                              {msg.status === 'sent' && <Check className="w-3.5 h-3.5" />}
                              {msg.status === 'delivered' && <CheckCheck className="w-3.5 h-3.5" />}
                              {msg.status === 'seen' && <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />}
                            </span>
                          )}
                        </div>
                        
                        {/* Reactions Display */}
                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className={`absolute -bottom-3 ${isMine ? 'right-2' : 'left-2'} flex flex-wrap gap-1 z-10`}>
                            {Array.from(new Set(msg.reactions.map(r => r.emoji))).map(emoji => {
                              const count = msg.reactions!.filter(r => r.emoji === emoji).length;
                              const hasReacted = msg.reactions!.some(r => r.emoji === emoji && r.user_id === user?.id);
                              return (
                                <button
                                  key={emoji}
                                  onClick={() => socket?.emit('react_message', { messageId: msg.id, emoji })}
                                  className={`flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-xs border shadow-sm transition-transform hover:scale-110 ${
                                    hasReacted 
                                      ? isDarkMode ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-100' : 'bg-emerald-100 border-emerald-300 text-emerald-800'
                                      : isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-300' : 'bg-white border-gray-200 text-gray-600'
                                  }`}
                                >
                                  <span>{emoji}</span>
                                  {count > 1 && <span className="text-[10px] font-medium">{count}</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </motion.div>
                      
                      {/* Reaction & Action Menu (Tap only) */}
                      <div className={`absolute transition-all duration-200 flex items-center space-x-1 bg-white dark:bg-[#233138] shadow-xl rounded-full px-2 py-1 z-30 ${
                        activeMessageId === msg.id ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
                      } ${
                        isMine 
                          ? 'right-0 bottom-full mb-1 origin-bottom-right' 
                          : 'left-0 bottom-full mb-1 origin-bottom-left'
                      }`}>
                        {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => {
                              socket?.emit('react_message', { messageId: msg.id, emoji });
                              setActiveMessageId(null);
                            }}
                            className={`p-1.5 rounded-full hover:bg-black/10 transition-transform hover:scale-125 flex-shrink-0 ${
                              isDarkMode ? 'text-gray-300 hover:bg-white/10' : 'text-gray-600 hover:bg-black/5'
                            }`}
                          >
                            <span className="text-lg leading-none block">{emoji}</span>
                          </button>
                        ))}
                        <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1 flex-shrink-0"></div>
                        <button
                          onClick={() => {
                            setReplyingTo(msg);
                            setActiveMessageId(null);
                          }}
                          className={`p-1.5 rounded-full hover:bg-black/10 transition-transform hover:scale-110 flex-shrink-0 ${
                            isDarkMode ? 'text-gray-300 hover:bg-white/10' : 'text-gray-600 hover:bg-black/5'
                          }`}
                          title="Reply"
                        >
                          <Reply className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setForwardingMessage(msg);
                            setActiveMessageId(null);
                          }}
                          className={`p-1.5 rounded-full hover:bg-black/10 transition-transform hover:scale-110 flex-shrink-0 ${
                            isDarkMode ? 'text-gray-300 hover:bg-white/10' : 'text-gray-600 hover:bg-black/5'
                          }`}
                          title="Forward"
                        >
                          <Forward className="w-4 h-4" />
                        </button>
                      </div>
                      </div>
                      
                      {/* Relative Timestamp (Outside Bubble) */}
                      <div className={`flex items-center space-x-1.5 px-1 ${msg.reactions && msg.reactions.length > 0 ? 'mt-4' : 'mt-1'}`}>
                        <span 
                          className={`text-[11px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'} cursor-default`}
                          title={new Date(msg.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        >
                          {getRelativeTime(msg.timestamp)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                );
              })})()}
              <div ref={messagesEndRef} className="h-4" />
            </div>

            {/* Input Area */}
            <div className={`relative p-2 md:p-4 z-20 flex flex-col items-center w-full ${isDarkMode ? 'bg-[#202c33]' : 'bg-[#f0f2f5]'}`}>
              
              {/* Replying To Preview */}
              <AnimatePresence>
                {replyingTo && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className={`mb-2 w-full max-w-3xl p-3 rounded-xl flex items-center justify-between shadow-sm border-l-4 ${
                      isDarkMode ? 'bg-[#2a3942] border-l-[#00a884]' : 'bg-white border-l-[#00a884]'
                    }`}
                  >
                    <div className="flex items-start space-x-3 overflow-hidden">
                      <CornerDownRight className={`w-5 h-5 mt-0.5 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
                      <div className="truncate">
                        <p className={`text-xs font-semibold mb-0.5 ${isDarkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>
                          Replying to {replyingTo.sender_id === user?.id ? 'Yourself' : selectedUser?.username}
                        </p>
                        <p className={`text-sm truncate opacity-80 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          {replyingTo.message || (replyingTo.media_type === 'image' ? 'Photo' : 'Document')}
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setReplyingTo(null)}
                      className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

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

              <div className="relative w-full max-w-3xl flex items-end space-x-2">
                {showEmoji && (
                  <div className={`absolute bottom-full mb-2 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden border ${
                    isDarkMode ? 'border-white/10' : 'border-gray-200'
                  }`}>
                    <EmojiPicker onEmojiClick={onEmojiSelect} theme={isDarkMode ? Theme.DARK : Theme.LIGHT} />
                  </div>
                )}
                
                <form onSubmit={handleSendMessage} className={`flex-1 flex items-end rounded-3xl px-2 py-1.5 ${
                  isDarkMode ? 'bg-[#2a3942]' : 'bg-white'
                }`}>
                  <button 
                    type="button"
                    onClick={() => setShowEmoji(!showEmoji)}
                    className={`p-2.5 rounded-full transition-all flex-shrink-0 ${
                      isDarkMode ? 'text-[#8696a0] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    <Smile className="w-6 h-6" />
                  </button>
                  
                  <input
                    type="text"
                    value={newMessage}
                    onChange={handleTyping}
                    placeholder={attachment ? "Add a caption..." : "Message"}
                    className={`flex-1 bg-transparent py-2.5 px-2 focus:outline-none text-[15px] ${
                      isDarkMode ? 'text-white placeholder-[#8696a0]' : 'text-gray-900 placeholder-gray-500'
                    }`}
                  />
                  
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                    className="hidden" 
                    accept="image/*,.pdf,.doc,.docx"
                  />
                  <button 
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className={`p-2.5 rounded-full transition-all flex-shrink-0 ${
                      isDarkMode ? 'text-[#8696a0] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'
                    } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isUploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Paperclip className="w-6 h-6" />}
                  </button>
                </form>

                <div className="flex-shrink-0 mb-0.5">
                  <button 
                    onClick={handleSendMessage}
                    disabled={!newMessage.trim() && !attachment}
                    className={`p-3.5 rounded-full shadow-md transition-colors flex items-center justify-center ${
                      newMessage.trim() || attachment 
                        ? 'bg-[#00a884] hover:bg-[#008f6f] text-white cursor-pointer' 
                        : 'bg-[#00a884] opacity-50 text-white cursor-not-allowed'
                    }`}
                  >
                    <Send className="w-5 h-5 ml-0.5" />
                  </button>
                </div>
              </div>
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

      {/* Forward Modal */}
      <AnimatePresence>
        {forwardingMessage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className={`w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl border ${
                isDarkMode ? 'bg-gray-900 border-white/10' : 'bg-white border-gray-200'
              }`}
            >
              <div className={`p-4 border-b flex items-center justify-between ${
                isDarkMode ? 'border-white/10' : 'border-gray-200'
              }`}>
                <h3 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Forward to...</h3>
                <button 
                  onClick={() => setForwardingMessage(null)}
                  className={`p-2 rounded-full transition-colors ${
                    isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                {users.filter(u => u.id !== user?.id).map(u => (
                  <button
                    key={u.id}
                    onClick={() => {
                      socket?.emit('send_message', {
                        receiverId: u.id,
                        message: forwardingMessage.message,
                        mediaUrl: forwardingMessage.media_url,
                        mediaType: forwardingMessage.media_type,
                        mediaName: forwardingMessage.media_name
                      });
                      setForwardingMessage(null);
                      setSelectedUser(u);
                    }}
                    className={`w-full flex items-center p-4 transition-colors border-b last:border-0 ${
                      isDarkMode 
                        ? 'hover:bg-white/5 border-white/5' 
                        : 'hover:bg-gray-50 border-gray-100'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-inner border ${
                      isDarkMode 
                        ? 'bg-gradient-to-br from-gray-700 to-gray-800 text-white border-white/10' 
                        : 'bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700 border-emerald-200/50'
                    }`}>
                      {u.username.charAt(0).toUpperCase()}
                    </div>
                    <span className={`ml-3 font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                      {u.username}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
