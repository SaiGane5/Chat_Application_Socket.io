const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const socketIO = require('socket.io');
const http = require('http');
const sharedSession = require('express-socket.io-session');
const dotenv = require('dotenv');
const cors = require('cors');
const pgSession = require('connect-pg-simple')(session);



dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Session setup
const sessionMiddleware = session({
  secret: process.env.SESSION_ID,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Use true if HTTPS is enabled
});

// Apply session middleware
app.use(sessionMiddleware);
io.use(sharedSession(sessionMiddleware, { autoSave: true }));

// Database connection setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(session({
  store: new pgSession({
    pool: pool,  // Your Postgres pool
    tableName: 'users'
  }),
  secret: process.env.SESSION_ID,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

let rooms = [];

// Load rooms from the database
async function loadRooms() {
  try {
    const result = await pool.query('SELECT * FROM rooms');
    rooms = result.rows;
  } catch (err) {
    console.error('Error loading rooms:', err);
  }
}
loadRooms(); // Initial room loading

// Middleware to check if the user is authenticated
function checkAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

// Routes
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// User registration logic
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length > 0) return res.redirect('/register');

    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hashedPassword]);
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.redirect('/register');
  }
});

// User login logic
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const validPassword = await bcrypt.compare(password, user.password);
      if (validPassword) {
        req.session.user = { id: user.id, username };
        return res.redirect('/');
      }
    }
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.redirect('/login');
  }
});

// Load main page with rooms
app.get('/', checkAuthenticated, (req, res) => {
  res.render('index', { rooms: rooms, session: req.session });
});

// Create a new room
app.post('/room', async (req, res) => {
  const { room } = req.body;
  const userId = req.session.user.id;

  if (!room) return res.redirect('/');

  try {
    const result = await pool.query('SELECT * FROM rooms WHERE room_name = $1', [room]);
    if (result.rows.length > 0) return res.redirect('/');

    await pool.query('INSERT INTO rooms (room_name, admin_id) VALUES ($1, $2)', [room, userId]);

    // Approve the room creator (admin)
    await pool.query('INSERT INTO room_members (room_id, user_id, is_approved) VALUES ((SELECT id FROM rooms WHERE room_name = $1), $2, TRUE)', [room, userId]);

    await loadRooms(); // Reload rooms after adding a new room
    res.redirect(`/${room}`);
    io.emit('room-created', room);
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

// Enter a room and show the messages
app.get('/:room', checkAuthenticated, async (req, res) => {
  const roomName = req.params.room;
  const userId = req.session.user.id;

  try {
    const roomResult = await pool.query('SELECT * FROM rooms WHERE room_name = $1', [roomName]);
    if (roomResult.rows.length === 0) return res.redirect('/');

    const room = roomResult.rows[0];
    const memberResult = await pool.query('SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2', [room.id, userId]);

    if (memberResult.rows.length === 0 || !memberResult.rows[0].is_approved) {
      return res.status(403).send('You are not approved to join this room.');
    }

    const messageResult = await pool.query('SELECT messages.*, users.username FROM messages JOIN users ON messages.user_id = users.id WHERE room_id = $1 ORDER BY timestamp ASC', [room.id]);
    const messages = messageResult.rows;

    res.render('room', { roomName, admin: room.admin_id === userId, messages });
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

app.post('/delete-room', checkAuthenticated, async (req, res) => {
  const { roomId } = req.body;
  const adminId = req.session.user.id;
  try {
    const room = await pool.query('SELECT * FROM rooms WHERE id = $1 AND admin_id = $2', [roomId, adminId]);
    if (room.rows.length > 0) {
      await pool.query('DELETE FROM messages WHERE room_id = $1', [roomId]);
      await pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
      res.redirect('/');
    } else {
      res.status(403).send('Only admin can delete the room');
    }
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

app.post('/delete-message', checkAuthenticated, async (req, res) => {
  const { messageId, roomId } = req.body;
  const adminId = req.session.user.id;
  try {
    const room = await pool.query('SELECT * FROM rooms WHERE id = $1 AND admin_id = $2', [roomId, adminId]);
    if (room.rows.length > 0) {
      await pool.query('DELETE FROM messages WHERE id = $1', [messageId]);
      res.redirect(`/${roomId}`);
    } else {
      res.status(403).send('Only admin can delete messages');
    }
  } catch (err) {
    console.error(err);
    res.redirect(`/${roomId}`);
  }
});



io.on('connection', (socket) => {
  const session = socket.handshake.session;

  if (session && session.user) {
    socket.emit('session-user', session.user.username);

    socket.on('new-user', async (roomName, name) => {
      const userId = session.user.id;
      try {
        const roomResult = await pool.query('SELECT * FROM rooms WHERE room_name = $1', [roomName]);
        const room = roomResult.rows[0];

        const memberResult = await pool.query('SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2', [room.id, userId]);
        if (memberResult.rows.length === 0) {
          await pool.query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [room.id, userId]);
          socket.emit('request-sent');
        } else if (memberResult.rows[0].is_approved) {
          socket.join(roomName);
          socket.to(roomName).emit('user-connected', name);
        }
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('approve-user', async (roomName, userId) => {
      const adminId = session.user.id;
      try {
        const roomResult = await pool.query('SELECT * FROM rooms WHERE room_name = $1', [roomName]);
        if (roomResult.rows[0].admin_id !== adminId) return;

        await pool.query('UPDATE room_members SET is_approved = TRUE WHERE room_id = $1 AND user_id = $2', [roomResult.rows[0].id, userId]);
        socket.to(roomName).emit('user-approved', userId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('send-chat-message', async (roomName, message) => {
      try {
        const userId = session.user.id;
        const messageResult = await pool.query(
          'INSERT INTO messages (room_id, user_id, message) VALUES ((SELECT id FROM rooms WHERE room_name = $1), $2, $3) RETURNING id',
          [roomName, userId, message]
        );
        const messageId = messageResult.rows[0].id;
        socket.to(roomName).emit('chat-message', {
          message,
          name: session.user.username,
          messageId
        });
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('edit-message', async (data) => {
      const { messageId, newMessage } = data;
      const userId = session.user.id;
      try {
        await pool.query('UPDATE messages SET message = $1 WHERE id = $2 AND user_id = $3', [newMessage, messageId, userId]);
        io.emit('message-updated', { messageId, newMessage });
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('delete-message', async (messageId) => {
      const userId = session.user.id;
      try {
        await pool.query('DELETE FROM messages WHERE id = $1 AND user_id = $2', [messageId, userId]);
        io.emit('message-deleted', messageId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('disconnect', () => {
      // Handle user disconnect logic if needed
    });
  } else {
    console.error('Session or session.user is undefined');
  }
});

// Start server
server.listen(3000, () => {
  console.log('Server is running on port 3000');
});