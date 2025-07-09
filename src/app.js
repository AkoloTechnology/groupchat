import { DurableObject } from "cloudflare:workers";

export class GroupchatDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.connectedSockets = new Set(this.ctx.getWebSockets());
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

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);

    this.connectedSockets.add(server);
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
    let data = JSON.parse(message);
    if(data.type === "ping") return;

    let broadcastData = {};
    let replyAll = true;
    let replyToSender = false;
    let messageGetsSaved = true;

    console.log(`Message from ${data.username} - Type: ${data.type}`);
    
    broadcastData.type = data.type;
    broadcastData.username = data.username;

    if(data.type === "message") {
      broadcastData.message = data.message;

    } else if (data.type === "join") {

    } else if (data.type === "image") {
      broadcastData.blob = data.blob;
      broadcastData.blobtype = data.blobtype;

    } else if (data.type === "usercount") {
      this.updateusercount();
      return;

    } else {
      console.error(`Unknown message type`);
      return;
    }
    
    let broadcastMessage = JSON.stringify(broadcastData);

    if(messageGetsSaved) {
      this.messageQueue.push(broadcastMessage);
      this.ctx.storage.put('messageQueue', this.messageQueue);
    }

    if (replyAll) {
      this.broadcastToAll(replyToSender ? ws : null, broadcastMessage);
    }
  }

  broadcastToAll(ws = null, broadcastMessage = `{"type":"empty"}`) {
    this.connectedSockets.forEach((socket) => {
      if (socket !== ws && socket.readyState === WebSocket.OPEN) {
        socket.send(broadcastMessage);
      }
    });
  }

  async webSocketClose(ws, code, reason, wasClean) {
    console.log(`WebSocket closed: ${code} - ${reason} (Clean: ${wasClean})`);
    this.connectedSockets.delete(ws)
    this.updateusercount();
    console.log(`Socket removed. Remaining connections: ${this.connectedSockets.size}`);
    ws.close(code, "Durable Object is closing WebSocket");
  }

  updateusercount() {
    let broadcastMessage = `{"type":"usercount","count":${this.connectedSockets.size}}`;
    this.broadcastToAll(null, broadcastMessage);
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