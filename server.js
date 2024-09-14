const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const socketIO = require('socket.io');
const http = require('http');
const sharedSession = require('express-socket.io-session');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const sessionMiddleware = session({
  secret: process.env.SESSION_ID,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS
});

app.use(sessionMiddleware);
io.use(sharedSession(sessionMiddleware, { autoSave: true }));

app.use(cors({
  origin: 'http://localhost:3000', // Adjust the origin to match your client-side URL
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

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

// Initial room loading
loadRooms();

// Authentication middleware
function checkAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// Routes
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (username.length > 100 || password.length > 255) {
    return res.status(400).send('Invalid input.');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length > 0) {
      return res.redirect('/register');
    }

    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hashedPassword]);
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.redirect('/register');
  }
});

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

app.get('/', checkAuthenticated, (req, res) => {
  res.render('index', { rooms: rooms, session: req.session });
});

app.post('/room', async (req, res) => {
  const { room } = req.body;
  const userId = req.session.user.id;

  if (!room) {
    return res.redirect('/');
  }

  try {
    const result = await pool.query('SELECT * FROM rooms WHERE room_name = $1', [room]);
    if (result.rows.length > 0) {
      return res.redirect('/');
    }

    await pool.query('INSERT INTO rooms (room_name, admin_id) VALUES ($1, $2)', [room, userId]);

    const roomResult = await pool.query('SELECT * FROM rooms WHERE room_name = $1', [room]);
    const newRoom = roomResult.rows[0];

    await pool.query('INSERT INTO room_members (room_id, user_id, is_approved) VALUES ($1, $2, $3)', [newRoom.id, userId, true]);

    await loadRooms(); // Reload rooms after adding a new room
    res.redirect(`/${room}`);
    io.emit('room-created', room);
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

app.get('/:room', checkAuthenticated, async (req, res) => {
  const roomName = req.params.room;
  const userId = req.session.user.id;

  try {
    const roomResult = await pool.query('SELECT * FROM rooms WHERE room_name = $1', [roomName]);
    if (roomResult.rows.length === 0) {
      return res.redirect('/');
    }

    const room = roomResult.rows[0];
    const memberResult = await pool.query('SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2', [room.id, userId]);

    if (memberResult.rows.length === 0 || !memberResult.rows[0].is_approved) {
      return res.status(403).send('You are not approved to join this room.');
    }

    res.render('room', { roomName, admin: room.admin_id === userId });
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

io.on('connection', socket => {
  const session = socket.handshake.session;

  if (session && session.user) {
    socket.emit('session-user', session.user.username);

    socket.on('new-user', async (roomName, name) => {
      const userId = session.user.id;

      try {
        const roomResult = await pool.query('SELECT * FROM rooms WHERE room_name = $1', [roomName]);
        if (roomResult.rows.length === 0) {
          return;
        }

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
        if (roomResult.rows.length === 0 || roomResult.rows[0].admin_id !== adminId) {
          return;
        }

        await pool.query('UPDATE room_members SET is_approved = TRUE WHERE room_id = $1 AND user_id = $2', [roomResult.rows[0].id, userId]);
        socket.to(roomName).emit('user-approved', userId);
      } catch (err) {
        console.error(err);
      }
    });

    socket.on('send-chat-message', (roomName, message) => {
      socket.to(roomName).emit('chat-message', {
        message,
        name: session.user.username
      });
    });

    socket.on('disconnect', () => {
      // Handle user disconnect logic if needed
    });
  } else {
    console.error('Session or session.user is undefined');
  }
});

// Helper function to get rooms a user is in
function getUserRooms(socket) {
  return Object.entries(rooms).reduce((names, [name, room]) => {
    if (room.users[socket.id] != null) names.push(name);
    return names;
  }, []);
}

// Start server
server.listen(3000, () => {
  console.log('Server is running on port 3000');
});