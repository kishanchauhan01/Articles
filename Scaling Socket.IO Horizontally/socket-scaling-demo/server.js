import http from "node:http";
import express from "express";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 3001;
const INSTANCE_NAME = process.env.INSTANCE_NAME || `Instance-${PORT}`;

io.on("connection", (socket) => {
  console.log(`[${INSTANCE_NAME}] Client connected: ${socket.id}`);

  // When a client sends a message, attempt to broadcast it to all connected sockets
  socket.on("broadcast_event", (data) => {
    console.log(
      `[${INSTANCE_NAME}] Received broadcast request from ${socket.id}:`,
      data,
    );

    // io.emit() should theoretically reach everyone
    io.emit("notification", {
      origin: INSTANCE_NAME,
      sender: socket.id,
      payload: data,
    });
  });
  socket.on("disconnect", () => {
    console.log(`[${INSTANCE_NAME}] Client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`>>> ${INSTANCE_NAME} listening on http://localhost:${PORT}`);
});