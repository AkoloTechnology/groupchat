import { DurableObject } from "cloudflare:workers";

export class GroupchatDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.connectedSockets = this.ctx.getWebSockets() || [];
    this.ctx.blockConcurrencyWhile(async () => {
      try {
        this.messageQueue = await this.ctx.storage.get('messageQueue') || [];
      } catch (error) {
                console.error("Error loading messageQueue from storage:", error);
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/clearchat")) {
      this.messageQueue = [];
      await this.ctx.storage.put('messageQueue', []);
      return new Response("Chat cleared successfully", { status: 200 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    this.ctx.acceptWebSocket(server);

    this.connectedSockets.push(server);
    console.log(`Socket added. Total connections: ${this.connectedSockets.length}`);
    this.updateusercount();   

    this.messageQueue.forEach((message) => {
      server.send(message);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws, message) {
    console.log(`Received message: ${message}`);
    let data = JSON.parse(message);
    if(data.type === "ping") return;
    if(data.type === "join") message = JSON.stringify({name: "Server", message: `${data.name} has joined the chat.`});
    if(data.type === "message" || data.type === "image") {
      this.messageQueue.push(message);
      this.ctx.storage.put('messageQueue', this.messageQueue);
    }
    this.connectedSockets.forEach((socket) => {
      if (socket != ws) 
        socket.send(message);
    });

  }

  async webSocketClose(ws, code, reason, wasClean) {
    console.log(`WebSocket closed: ${code} - ${reason} (Clean: ${wasClean})`);
    this.removeDisconnectedSocket(ws);
    ws.close(code, "Durable Object is closing WebSocket");
  }

  removeDisconnectedSocket(socketToRemove) {
    this.connectedSockets = this.connectedSockets.filter(
      (socket) => socket !== socketToRemove
    );
    this.updateusercount();
    console.log(`Socket removed. Remaining connections: ${this.connectedSockets.length}`);
  }

  updateusercount() {
    this.connectedSockets.forEach((socket) => {
      let connentedCount = this.connectedSockets.length;
      socket.send(JSON.stringify({type: "usercount", count: connentedCount}));
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.url.endsWith("/websocket")) {
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Durable Object expected Upgrade: websocket", {
          status: 426,
        });
      }

      let id = env.GROUPCHAT_DURABLE_OBJECT.idFromName("foo");
      let stub = env.GROUPCHAT_DURABLE_OBJECT.get(id);

      return stub.fetch(request);
    }
    if (request.url.endsWith("/clearchat")) {
      let id = env.GROUPCHAT_DURABLE_OBJECT.idFromName("foo");
      let stub = env.GROUPCHAT_DURABLE_OBJECT.get(id);
      
      return stub.fetch(request);
    }

    return new Response(null, {
      status: 400,
      statusText: "Bad Request",
      headers: {
        "Content-Type": "text/plain",
      },
    });
  },
};