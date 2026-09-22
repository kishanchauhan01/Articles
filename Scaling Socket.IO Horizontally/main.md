# Scaling Socket.IO Horizontally: Why Your Real-Time Architecture Breaks Beyond a Single Process

## The Illusion of Single-Server Simplicity

WebSockets are the foundation of modern interactive web apps. Whether you are synchronizing live cursor movements in a collaborative canvas, streaming inference progress from a background AI job, pushing real-time order tracking updates, or delivering financial ticks, persistent full-duplex TCP connections make instant client updates trivial.

During early development, building these features with `Socket.IO` in Node.js feels seamless. You initialize an HTTP server, attach a Socket.IO instance, listen for incoming connections, and push updates using io.emit() or room-based targeting:

```js
// A typical single-server broadcast
io.to("project:402").emit("task_updated", { status: "completed" });
```

On a single development server, this works flawlessly. The server receives the update, locates all connected clients listening on project:402, and pushes the payload down their active TCP connections.

However, this architecture relies on a silent, fragile assumption: **every connected client lives in the same process memory.**

### The Bottleneck: Horizontal Scaling and Isolated Memory

A single Node.js process runs on a single thread and is bounded by operating system memory limits (typically 1.4 GB to 2 GB of V8 heap by default). As active concurrent connections grow from hundreds to tens of thousands, a single CPU core becomes a hard throughput bottleneck.

To scale, you do what every production engineer does: scale horizontally. You spin up multiple Node.js worker processes across multiple CPU cores using PM2 or Docker containers, placing them behind a reverse proxy like Nginx or an AWS Application Load Balancer.

The moment you introduce that second server instance, your real-time communication silently breaks.

<image src="image_1.png">

Node.js processes adhere strictly to a shared-nothing architecture. Process A and Process B inhabit isolated virtual memory spaces. They cannot inspect, access, or manipulate each other's data structures.

When Client A and Client B land on different instances:

1. Client A establishes a WebSocket connection routed by the load balancer to Node Instance 1. Instance 1 allocates a socket reference in its local heap memory.

2. Client B connects and is routed to Node Instance 2. Instance 2 records Client B in its own separate heap.

3. When Client A performs an action that triggers `io.emit('event', payload)` inside Instance 1, Instance 1 can only iterate over its own local registry.

4. Instance 1 has no visibility into Instance 2. As a result, the event is dispatched to Client A (and anyone else attached to Instance 1), while Client B never receives the payload.

The exact same breakdown occurs with Socket.IO rooms (`socket.join('room-name')`). If two users join the same logical room on different physical servers, the room exists only as a local key in each server's memory map. Room broadcasts become completely siloed.

To scale real-time applications horizontally, servers cannot rely on local process memory as the source of truth for client communication. They require a centralized, high-throughput message bus that sits outside the application layer.

---

## Reproducing the Breakdown Locally

To see why in-memory WebSocket architectures fail under horizontal scaling, you don't need a complex cloud cluster. You can reproduce the exact failure on localhost by running two instances of a basic Node.js server on different ports.

### 1. Project Setup

Initialize an isolated Node.js environment and configure it to use ES Modules:

```Bash
mkdir socket-scaling-demo
cd socket-scaling-demo
npm init -y
npm pkg set type="module"
npm install express socket.io socket.io-client
```

### 2. The Minimal Server (`server.js`)

Create a `server.js` file that reads a `PORT` environment variable, binds Socket.IO, and listens for a generic `broadcast_event`:

```js
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
```

### 3. Spawning Two Isolated Server Instances

Open two separate terminal tabs and start two distinct instances representing two worker processes behind a load balancer:

- Terminal 1 (Server Instance A):

```Bash
PORT=3001 INSTANCE_NAME="Server-A" node server.js
```

- Terminal 2 (Server Instance B):

```Bash
PORT=3002 INSTANCE_NAME="Server-B" node server.js
```

Both instances are now live on your machine, bound to different network ports, and executing in completely segregated memory spaces.

### 4. Simulating Distributed Clients (`test-clients.js`)

Now create a test runner script (`test-clients.js`) to simulate two separate users.

- Client 1 connects to Server-A (`:3001`).

- Client 2 connects to Server-B (`:3002`).

```js
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
```

- Run the test runner in a third terminal:

```Bash
node test-clients.js
```

### 5. The Result: Silent Event Dropping

Look closely at your terminal output:

```Plaintext
[Client 1] Connected to Server-A (ID: Wk9vA8j_...)
[Client 2] Connected to Server-B (ID: gU4sZ2m_...)

>>> Client 1 emitting: "broadcast_event" -> "Task #402 Finished"

[Client 1] Received notification: {
  origin: 'Server-A',
  sender: 'Wk9vA8j_...',
  payload: { task: 'Task #402 Finished' }
}
```

Client 1 receives its own reflected notification from Server-A, but Client 2 receives absolutely nothing.

- Inspect Terminal 1 (Server-A):

```Plaintext
[Server-A] Client connected: Wk9vA8j_...
[Server-A] Received broadcast request from Wk9vA8j_...: { task: 'Task #402 Finished' }
```

- Inspect Terminal 2 (Server-B):

```Plaintext
[Server-B] Client connected: gU4sZ2m_...
```

(Complete silence.)

`Server-A` did exactly what its code instructed: it queried its internal heap, found all sockets in its local memory pool (`Wk9vA8j_...`), and dispatched the TCP packet. It had no mechanism to notify `Server-B` that a global event occurred.

In a production environment where tens of thousands of users are randomly distributed across 10 container replicas, over **90% of your users will miss every broadcast event.**

