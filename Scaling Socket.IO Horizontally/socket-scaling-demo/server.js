import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";

const app = express();
const server = http.createServer(app);

// 1. Establish Redis Publisher and Subscriber connections
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const pubClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// A subscribed connection cannot execute other commands, so duplicate it
const subClient = pubClient.duplicate();

// 2. Attach Socket.IO and bind the Redis Adapter
const io = new Server(server, {
  cors: { origin: "*" },
  adapter: createAdapter(pubClient, subClient)
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

    // io.emit() is now intercepted by the Redis adapter and published to the Redis bus
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
