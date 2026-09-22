# Scaling Socket.IO Horizontally: Why Your Real-Time Architecture Breaks Beyond a Single Process

## The Illusion of Single-Server Simplicity

WebSockets are the foundation of modern interactive web apps. Whether you are synchronizing live cursor movements in a collaborative canvas, streaming inference progress from a background AI job, pushing real-time order tracking updates, or delivering financial ticks, persistent full-duplex TCP connections make instant client updates trivial.

During early development, building these features with `Socket.IO` in Node.js feels seamless. You initialize an HTTP server, attach a Socket.IO instance, listen for incoming connections, and push updates using io.emit() or room-based targeting:

```js
// A typical single-server broadcast
io.to('project:402').emit('task_updated', { status: 'completed' });
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

1) Client A establishes a WebSocket connection routed by the load balancer to Node Instance 1. Instance 1 allocates a socket reference in its local heap memory.

2) Client B connects and is routed to Node Instance 2. Instance 2 records Client B in its own separate heap.

3) When Client A performs an action that triggers `io.emit('event', payload)` inside Instance 1, Instance 1 can only iterate over its own local registry.

4) Instance 1 has no visibility into Instance 2. As a result, the event is dispatched to Client A (and anyone else attached to Instance 1), while Client B never receives the payload.

The exact same breakdown occurs with Socket.IO rooms (`socket.join('room-name')`). If two users join the same logical room on different physical servers, the room exists only as a local key in each server's memory map. Room broadcasts become completely siloed.

To scale real-time applications horizontally, servers cannot rely on local process memory as the source of truth for client communication. They require a centralized, high-throughput message bus that sits outside the application layer.