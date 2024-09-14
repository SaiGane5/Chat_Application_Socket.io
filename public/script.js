const socket = io('http://localhost:3000');

const messageContainer = document.getElementById('message-container');
const messageForm = document.getElementById('send-container');
const messageInput = document.getElementById('message-input');

socket.on('session-user', (name) => {
  if (name) {
    appendMessage('You joined as ' + name);
    socket.emit('new-user', roomName, name);
  } else {
    const userName = prompt('What is your name?');
    appendMessage('You joined as ' + userName);
    socket.emit('new-user', roomName, userName);
  }
});

socket.on('request-sent', () => {
  appendMessage('Request to join room sent. Waiting for admin approval.');
});

socket.on('user-approved', (userId) => {
  if (userId === currentUserId) {
    appendMessage('You have been approved to join the room.');
    socket.emit('new-user', roomName, currentUserName);
  }
});

messageForm.addEventListener('submit', e => {
  e.preventDefault();
  const message = messageInput.value;
  appendMessage(`You: ${message}`);
  socket.emit('send-chat-message', roomName, message);
  messageInput.value = '';
});

socket.on('chat-message', data => {
  appendMessage(`${data.name}: ${data.message}`);
});

socket.on('user-connected', name => {
  appendMessage(`${name} connected`);
});

socket.on('user-disconnected', name => {
  appendMessage(`${name} disconnected`);
});

function appendMessage(message) {
  const messageElement = document.createElement('div');
  messageElement.innerText = message;
  messageContainer.append(messageElement);
}