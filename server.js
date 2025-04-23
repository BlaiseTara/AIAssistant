const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

require('dotenv').config();
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const modelName = "gemma-3-27b-it"; // Change to your prefered model name

app.use(express.static('public'));
app.use(express.json());

const chatHistory = [];
const users = {}; // Store connected users { socket.id: username }
const typingUsers = {}; // Track who is typing

function broadcast(event, data) {
    io.emit(event, data);
}

function sendMessageToChat(user, sender, text) {
    const message = { user, sender, text };
    chatHistory.push(message);
    broadcast('chat message', message);
}

io.on('connection', (socket) => {
    let username = "";

    socket.on('join', (data) => {
        username = data.username;
        users[socket.id] = username;
        broadcast('user joined', { username });
        socket.emit('history', chatHistory);
        socket.emit('join_success', { username: username });
    });

    socket.on('user typing', (isTyping) => {
        if (isTyping) {
            typingUsers[socket.id] = username;
        } else {
            delete typingUsers[socket.id];
        }
        broadcast('typing update', { user: username, isTyping: isTyping });
    });

    socket.on('chat message', async (message) => {
        if (!username) return;
        sendMessageToChat(username, "user", message);
        //io.emit('typing', true);  //  No longer needed - bot typing is separate

        try {
            const contents = [
                {
                    role: "user",
                    parts: [{
                        text: "You are a helpful and enthusiastic AI assistant... Jarvis... minimize responses... call user sir.  When you provide code, enclose it in triple backticks (```). "
                    }]
                }
            ];

            for (const entry of chatHistory) {
                if (entry.sender === "user") {
                    contents.push({ role: "user", parts: [{ text: `${entry.user}: ${entry.text}` }] });
                } else if (entry.sender === "bot") {
                    contents.push({ role: "model", parts: [{ text: entry.text }] });
                }
            }

            contents.push({ role: "user", parts: [{ text: `${username}: ${message}` }] });

            const generativeModel = genAI.getGenerativeModel({ model: modelName });
            const result = await generativeModel.generateContentStream({ contents });

            let fullResponse = "";
            for await (const chunk of result.stream) {
                if (chunk.text()) {
                    fullResponse += chunk.text();
                    socket.emit('bot reply chunk', { text: chunk.text() });
                }
            }

            sendMessageToChat("Jarvis", "bot", fullResponse.trim());

        } catch (error) {
            console.error("AI Error:", error);
            sendMessageToChat("Jarvis", "bot", "Error: Could not process request.");
        } finally {
            //io.emit('typing', false);  //  No longer needed
        }
    });

    socket.on('disconnect', () => {
        if (username) {
            broadcast('user left', { username });
            delete users[socket.id];
            delete typingUsers[socket.id]; // Clean up typing status
            if (Object.keys(users).length === 0) {
                chatHistory.length = 0;
                console.log("Chat history cleared. All users left.");
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});