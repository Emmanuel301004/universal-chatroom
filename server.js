const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// File path for storing chat history
const CHAT_HISTORY_FILE = path.join(__dirname, 'chat_history.json');

// In-memory storage for chat messages (7 days retention)
let chatHistory = [];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Load chat history from file on server start
async function loadChatHistory() {
  try {
    const data = await fs.readFile(CHAT_HISTORY_FILE, 'utf8');
    const loadedHistory = JSON.parse(data);
    
    // Filter out messages older than 7 days
    const now = Date.now();
    chatHistory = loadedHistory.filter(msg => (now - msg.timestamp) < SEVEN_DAYS_MS);
    
    console.log(`Loaded ${chatHistory.length} messages from chat history`);
    
    // Save cleaned history back to file
    await saveChatHistory();
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing chat history found, starting fresh');
      chatHistory = [];
    } else {
      console.error('Error loading chat history:', error);
      chatHistory = [];
    }
  }
}

// Save chat history to file
async function saveChatHistory() {
  try {
    await fs.writeFile(CHAT_HISTORY_FILE, JSON.stringify(chatHistory, null, 2));
    console.log(`Saved ${chatHistory.length} messages to chat history`);
  } catch (error) {
    console.error('Error saving chat history:', error);
  }
}

// Clean old messages (older than 7 days)
async function cleanOldMessages() {
  const now = Date.now();
  const originalLength = chatHistory.length;
  chatHistory = chatHistory.filter(msg => (now - msg.timestamp) < SEVEN_DAYS_MS);
  
  if (originalLength !== chatHistory.length) {
    console.log(`Cleaned ${originalLength - chatHistory.length} old messages`);
    await saveChatHistory();
  }
}

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Clean old messages every hour
setInterval(cleanOldMessages, 60 * 60 * 1000);

// Socket connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Send chat history to newly connected user
  socket.emit('chat_history', chatHistory);
  
  // Handle new messages
  socket.on('send_message', async (data) => {
    const message = {
      id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      username: data.username || 'Anonymous',
      message: data.message,
      timestamp: Date.now(),
      date: new Date().toISOString()
    };
    
    // Add to chat history
    chatHistory.push(message);
    
    // Save to file immediately
    await saveChatHistory();
    
    // Clean old messages if history gets too long
    if (chatHistory.length > 10000) {
      await cleanOldMessages();
    }
    
    // Broadcast to all connected clients
    io.emit('new_message', message);
  });
  
  // Handle user typing
  socket.on('typing', (data) => {
    socket.broadcast.emit('user_typing', {
      username: data.username,
      isTyping: data.isTyping
    });
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// API endpoint to get chat history
app.get('/api/history', async (req, res) => {
  await cleanOldMessages();
  res.json({
    messages: chatHistory,
    totalMessages: chatHistory.length,
    oldestMessage: chatHistory.length > 0 ? new Date(chatHistory[0].timestamp) : null,
    newestMessage: chatHistory.length > 0 ? new Date(chatHistory[chatHistory.length - 1].timestamp) : null
  });
});

// API endpoint to clear chat history (admin function)
app.post('/api/clear', async (req, res) => {
  chatHistory = [];
  await saveChatHistory();
  io.emit('chat_cleared');
  res.json({ success: true, message: 'Chat history cleared' });
});

// API endpoint to backup chat history
app.get('/api/backup', (req, res) => {
  res.json({
    backup: chatHistory,
    timestamp: new Date().toISOString(),
    totalMessages: chatHistory.length
  });
});

// Initialize server
async function startServer() {
  // Load existing chat history
  await loadChatHistory();
  
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Chat server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to access the chat`);
    console.log(`Chat history will be persisted in: ${CHAT_HISTORY_FILE}`);
  });
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  await saveChatHistory();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down server...');
  await saveChatHistory();
  process.exit(0);
});

// Start the server
startServer().catch(console.error);