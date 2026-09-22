import { io } from "socket.io-client";

// Client 1 lands on Server A
const client1 = io("http://localhost:3001", { transports: ["websocket"] });

// Client 2 lands on Server B
const client2 = io("http://localhost:3002", { transports: ["websocket"] });

client1.on("connect", () => {
  console.log(`[Client 1] Connected to Server-A (ID: ${client1.id})`);
});

client2.on("connect", () => {
  console.log(`[Client 2] Connected to Server-B (ID: ${client2.id})`);
});

// Listen for incoming notifications on both clients
client1.on("notification", (msg) => {
  console.log(`[Client 1] Received notification:`, msg);
});

client2.on("notification", (msg) => {
  console.log(`[Client 2] Received notification:`, msg);
});

// Wait 1 second for handshakes to settle, then emit an event from Client 1
setTimeout(() => {
  console.log(
    '\n>>> Client 1 emitting: "broadcast_event" -> "Task #402 Finished"\n',
  );
  client1.emit("broadcast_event", { task: "Task #402 Finished" });
}, 1000);
