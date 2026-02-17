export class SimsWebSocket {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.reconnectDelay = 2000;
    this.maxReconnectDelay = 30000;
    this.reconnectAttempts = 0;
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/v1/sims/world/live`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('Sims WebSocket connected');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 2000;
        this._emit('open');

        // Subscribe to all channels
        this.send({ type: 'subscribe', channel: 'world' });
        this.send({ type: 'subscribe', channel: 'events' });
        this.send({ type: 'subscribe', channel: 'chat' });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._emit(msg.type, msg.data);
        } catch (e) {
          console.warn('Invalid WS message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('Sims WebSocket disconnected');
        this._emit('close');
        this._reconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('Sims WebSocket error');
        this.ws.close();
      };
    } catch (e) {
      console.warn('WebSocket connect failed:', e);
      this._reconnect();
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  _emit(event, data) {
    const handlers = this.handlers[event];
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (e) {
          console.error('WS handler error:', e);
        }
      }
    }
  }

  _reconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
    console.log(`Reconnecting in ${Math.round(delay / 1000)}s...`);
    setTimeout(() => this.connect(), delay);
  }
}
