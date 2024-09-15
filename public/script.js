const socket = io('http://localhost:3000', { withCredentials: true });
const roomName = document.getElementById('room-name').textContent;
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
  appendMessage('You have been approved to join the room.');
  socket.emit('new-user', roomName, userId);
});

messageForm.addEventListener('submit', e => {
  e.preventDefault();
  const message = messageInput.value;
  appendMessage(`You: ${message}`, true);
  socket.emit('send-chat-message', roomName, message);
  messageInput.value = '';
});

socket.on('chat-message', (data) => {
  appendMessage(`${data.name}: ${data.message}`, false, data.messageId);
});

socket.on('user-connected', (name) => {
  appendMessage(`${name} connected`);
});

socket.on('user-disconnected', (name) => {
  appendMessage(`${name} disconnected`);
});

socket.on('message-updated', (data) => {
  const messageElement = document.getElementById(`message-${data.messageId}`);
  if (messageElement) {
    messageElement.querySelector('.message-text').innerText = data.newMessage;
  }
});

socket.on('message-deleted', (messageId) => {
  const messageElement = document.getElementById(`message-${messageId}`);
  if (messageElement) {
    messageElement.remove();
  }
});

function appendMessage(message, isOwnMessage = false, messageId = null) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message');
  if (messageId) {
    messageElement.id = `message-${messageId}`;
  }

  const messageText = document.createElement('span');
  messageText.classList.add('message-text');
  messageText.innerText = message;
  messageElement.append(messageText);

  if (isOwnMessage) {
    const editButton = document.createElement('button');
    editButton.innerText = 'Edit';
    editButton.addEventListener('click', () => editMessage(messageId));
    messageElement.append(editButton);

    const deleteButton = document.createElement('button');
    deleteButton.innerText = 'Delete';
    deleteButton.addEventListener('click', () => deleteMessage(messageId));
    messageElement.append(deleteButton);
  }

  messageContainer.append(messageElement);
}

function editMessage(messageId) {
  const newMessage = prompt('Edit your message:');
  if (newMessage) {
    socket.emit('edit-message', { messageId, newMessage });
  }
}

function deleteMessage(messageId) {
  if (confirm('Are you sure you want to delete this message?')) {
    socket.emit('delete-message', messageId);
  }
}