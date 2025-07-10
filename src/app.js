import { DurableObject } from "cloudflare:workers";
import * as crypto from 'node:crypto';

export class GroupchatDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.connectedSockets = new Set(this.ctx.getWebSockets());

    this.sql = ctx.storage.sql;
    
    const clearalltables = false;
    this.sql.exec("SELECT name FROM sqlite_master WHERE type='table';").toArray().forEach((table) => {
      console.log(`Table found: ${table.name}`);
      if (table.name == "_cf_KV") return;
      if (clearalltables) {
        this.sql.exec(`DROP TABLE "${table.name}";`);
        console.log(`Dropped table: ${table.name}`);
      }
    });
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chatrooms(
      id TEXT PRIMARY KEY,
      description TEXT,
      tablename TEXT,
      data TEXT
    );`);
    if(this.sql.exec("SELECT * FROM chatrooms WHERE tablename = 'General';").toArray().length === 0)
        this.creategeneralchatroom();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/clearchat")) {
      this.clearchatroom("General");
      return new Response("Chat cleared successfully", { status: 200 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);

    this.connectedSockets.add(server);
    console.log(`Socket added. Total connections: ${this.connectedSockets.size}`);

    this.updateusercount();   

    const generaluuid = this.sql.exec("SELECT id FROM chatrooms WHERE tablename = 'General';").one().id;
    this.sql.exec(`SELECT * FROM ${generaluuid}`).toArray().forEach((row) => {
      server.send(row.message);
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
      const generaluuid = this.sql.exec("SELECT id FROM chatrooms WHERE tablename = 'General';").one().id;
      this.sql.exec(`INSERT INTO ${generaluuid} (id, message) VALUES (?, ?);`, 
        `message_${crypto.randomUUID().replace(/-/g, '_')}`, broadcastMessage);
    }

    if (replyAll) {
      this.broadcastToAll(replyToSender ? null : ws, broadcastMessage);
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

  createnewchatroom(name) {
    if(name == "General") return 0;
    const tableuuid = `chatroom_${crypto.randomUUID().replace(/-/g, '_')}`;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${tableuuid} (id TEXT PRIMARY KEY, message TEXT);`);
    this.sql.exec(`INSERT OR IGNORE INTO chatrooms (id, description, tablename, data) 
      VALUES (?, ?, ?, ?);`, 
      tableuuid, `A chat room named ${name}`, name, '{}');
    return tableuuid;
  }

  creategeneralchatroom() {
    const tableuuid = `chatroom_${crypto.randomUUID().replace(/-/g, '_')}`;
    console.log(`Creating general chat room with table UUID: ${tableuuid}`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ${tableuuid} (id TEXT PRIMARY KEY, message TEXT);`);
    console.log(`Inserting general chat room into chatrooms table with UUID: ${tableuuid}`);
    this.sql.exec(`INSERT OR IGNORE INTO chatrooms (id, description, tablename, data) 
      VALUES (?, ?, ?, ?);`, 
      tableuuid, 'A chat room named General', 'General', '{}');
    console.log(`General chat room created with table UUID: ${tableuuid}`);
  }

  clearchatroom(tableuuid) {
    this.sql.exec(`DELETE FROM ${tableuuid};`);
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